// ============================================================
// 对话主接口：POST /api/chat（SSE 流式）
// 事件协议：session / trace / tool / card / comparison / citation /
//          stage / delta / interrupt / quickReplies / done / error
// ============================================================
import type { NextRequest } from "next/server";
import { runAdvisorTurn, buildFactSheet } from "@/src/agent/runner";
import { streamAnswer } from "@/src/agent/llm";
import { detectInjection, sanitizeInput } from "@/src/guardrails/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body.sessionId || crypto.randomUUID());
  const message = body.message ? sanitizeInput(String(body.message)) : undefined;
  const resume = body.resume ? String(body.resume) : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端可能中途断开（用户点停止 / 关页面），此时 enqueue 会抛错
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* 连接已关闭，忽略即可 */
        }
      };

      try {
        send("session", { sessionId });

        // 输入侧护栏：注入检测
        if (message && detectInjection(message)) {
          send("delta", { text: "抱歉，我不能执行或讨论系统指令相关的请求。我们可以继续聊选车。" });
          send("done", { blocked: true });
          return;
        }

        const result = await runAdvisorTurn({ sessionId, message, resume });
        send("trace", { traceId: result.traceId });

        // 人机协同：图在 interrupt 处暂停
        if (result.interrupted) {
          send("interrupt", result.interrupted);
          send("done", { interrupted: true });
          return;
        }

        // 过程可视化：工具调用 → 卡片 → 对比表 → 引用 → 阶段
        for (const ev of result.toolEvents) send("tool", ev);
        for (const card of result.candidates) send("card", card);
        if (result.comparison) send("comparison", result.comparison);
        for (const citation of result.citations) send("citation", citation);
        send("stage", { stage: result.stage });

        // 答案流式输出（有 Key 走 LLM 润色，无 Key 走模板打字机）
        const factSheet = buildFactSheet(result);
        send("stage", { stage: "generating" });
        for await (const chunk of streamAnswer(result.answer, factSheet, (reason) => {
          // LLM 调用失败时明确告知前端，并用模板结果兜底
          send("notice", { message: "LLM 调用失败，已自动切换模板回答", detail: reason });
        })) {
          send("delta", { text: chunk });
        }

        send("quickReplies", { options: ["看对比", "估算落地价", "聊聊口碑", "预约试驾"] });
        send("done", { mode: result.mode, stage: result.stage });
      } catch (err) {
        console.error("[api/chat]", err);
        send("error", { message: (err as Error).message });
        send("done", { error: true });
      } finally {
        // 流可能已被运行时关闭（断连），close 需要容错
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
