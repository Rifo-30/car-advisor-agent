// ============================================================
// 一次对话回合的执行器
// 职责：调用 LangGraph、处理 interrupt/resume、返回结构化结果
// ============================================================
import { Command } from "@langchain/langgraph";
import { getAdvisorGraph } from "./graph";
import { hasLLM } from "./llm";
import { startTrace } from "../observability/trace";
import { applyOutputGuardrails } from "../guardrails/guard";
import { saveSessionState } from "../db/repo";
import type { Candidate, Citation, Comparison, ToolEvent } from "../types";

export interface TurnInput {
  sessionId: string;
  message?: string;
  resume?: string;
}

export interface TurnResult {
  sessionId: string;
  traceId: string;
  interrupted?: { type: string; question: string };
  answer: string;
  candidates: Candidate[];
  comparison?: Comparison | null;
  citations: Citation[];
  toolEvents: ToolEvent[];
  stage: string;
  mode: "live" | "mock";
}

export async function runAdvisorTurn(input: TurnInput): Promise<TurnResult> {
  const graph = getAdvisorGraph();
  const config = { configurable: { thread_id: input.sessionId } };
  const trace = startTrace("agent.turn", input.sessionId, {
    message: input.message,
    resume: input.resume,
  });
  const span = trace.span("graph.invoke", {
    mode: input.resume ? "resume" : "message",
  });

  // ⭐ 人机协同的关键：
  // 用户确认后，用 Command({ resume }) 从 checkpoint 断点继续，而不是重跑整个流程。
  const graphInput = input.resume
    ? new Command({ resume: input.resume })
    : {
        sessionId: input.sessionId,
        messages: [{ role: "user" as const, content: input.message ?? "" }],
      };

  // 说明：Command 的泛型与 StateGraph 推导存在类型摩擦，这里显式放宽类型
  const result: any = await graph.invoke(graphInput as any, config as any);
  span.end({ stage: result.stage, interrupted: Boolean(result.__interrupt__) });

  // 本轮产生的工具事件（状态里的 toolEvents 是累积的，需要按 turnId 过滤）
  const turnEvents = (result.toolEvents ?? []).filter(
    (e: ToolEvent) => !e.turnId || e.turnId === result.turnId
  );

  // ⭐ 把每次工具调用补记为独立 span，trace 面板就能看到「每一步」
  for (const ev of turnEvents) {
    trace.addSpan(
      `tool:${ev.name}`,
      ev.args ?? null,
      { summary: ev.summary, ok: ev.ok },
      ev.ms ?? 0
    );
  }

  // 图在 interrupt 处暂停：把问题返回给前端
  if (result.__interrupt__?.length) {
    const payload = result.__interrupt__[0]?.value ?? {};
    trace.end({ interrupted: true, question: payload.question });
    return {
      sessionId: input.sessionId,
      traceId: trace.id,
      interrupted: {
        type: String(payload.type ?? "confirm"),
        question: String(payload.question ?? "请确认"),
      },
      answer: "",
      candidates: result.candidates ?? [],
      comparison: result.comparison ?? null,
      citations: result.citations ?? [],
      // 只返回本轮产生的工具事件（状态里的 toolEvents 是累积的）
      toolEvents: turnEvents,
      stage: result.stage ?? "confirm",
      mode: hasLLM() ? "live" : "mock",
    };
  }

  // 输出侧护栏：绝对化用语替换 + 价格免责声明
  const guarded = applyOutputGuardrails(String(result.answer ?? ""));

  // 会话状态落库（异步，失败不影响主流程）
  void saveSessionState(input.sessionId, {
    stage: result.stage,
    constraints: result.constraints,
    candidates: result.candidates?.map((c: Candidate) => c.modelId),
    updatedAt: new Date().toISOString(),
  });

  trace.end({ stage: result.stage, answerLength: guarded.text.length });

  return {
    sessionId: input.sessionId,
    traceId: trace.id,
    answer: guarded.text,
    candidates: result.candidates ?? [],
    comparison: result.comparison ?? null,
    citations: result.citations ?? [],
    toolEvents: turnEvents,
    stage: result.stage ?? "recommend",
    mode: hasLLM() ? "live" : "mock",
  };
}

/** 给 LLM 润色用的「事实底稿」：LLM 只能基于它组织语言 */
export function buildFactSheet(result: TurnResult): string {
  const parts: string[] = [];
  if (result.answer) parts.push(result.answer);

  if (result.candidates.length) {
    parts.push(
      "候选车型数据：\n" +
      result.candidates
        .map(
          (c) =>
            `- ${c.brand} ${c.series} ${c.variantName}：${c.price.toFixed(2)} 万，${c.energyType}，${c.seats} 座，${c.level}。` +
            `优点：${c.why.join("、")}。注意：${c.tradeoffs.join("、")}。`
        )
        .join("\n")
    );
  }

  if (result.comparison) {
    parts.push(
      "对比数据：\n" +
      result.comparison.rows
        .map((r) => `- ${r.label}：${r.values.join(" / ")}`)
        .join("\n")
    );
  }

  if (result.citations.length) {
    parts.push("来源：\n" + result.citations.map((c) => `- [${c.type}] ${c.title}：${c.detail}`).join("\n"));
  }

  return parts.join("\n\n");
}
