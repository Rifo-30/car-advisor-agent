// ============================================================
// 一次对话回合的执行器
// 职责：调用 LangGraph、处理 interrupt/resume、返回结构化结果
// ============================================================
import { Command } from "@langchain/langgraph";
import { getAdvisorGraph } from "./graph";
import { hasLLM } from "./llm";
import { startTrace } from "../observability/trace";
import { applyOutputGuardrails } from "../guardrails/guard";
import { getSessionState, saveSessionState } from "../db/repo";
import type { Candidate, Citation, Comparison, ToolEvent } from "../types";

export interface TurnInput {
  sessionId: string;
  userId?: string;
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
  /** 自我介绍等固定文案不走 LLM 润色，避免被改写 */
  skipPolish?: boolean;
}

export async function runAdvisorTurn(input: TurnInput): Promise<TurnResult> {
  const graph = await getAdvisorGraph();
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
        userId: input.userId ?? "anonymous",
        messages: [{ role: "user" as const, content: input.message ?? "" }],
      };

  // 说明：Command 的泛型与 StateGraph 推导存在类型摩擦，这里显式放宽类型
  let result: any;
  try {
    result = await graph.invoke(graphInput as any, config as any);
  } catch (err) {
    // ⭐ 异常也要闭环：否则 span/trace 永远停在"未结束"状态
    const message = (err as Error).message;
    span.end({ error: message });
    trace.end({ error: message });
    throw err;
  }
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

    // 中断也要记录对话（否则刷新后看不到"我预约了但还没确认"）
    const prev = (await getSessionState(input.sessionId)) ?? {};
    const prevMsgs = Array.isArray(prev.messages) ? prev.messages : [];
    const at = new Date().toISOString();
    const newMsgs = [
      ...(input.message ? [{ role: "user", content: input.message, at }] : []),
      ...(input.resume ? [{ role: "user", content: input.resume, at }] : []),
      { role: "assistant", content: String(payload.question ?? ""), at, interrupt: true },
    ];
    await saveSessionState(input.sessionId, {
      ...prev,
      userId: input.userId ?? prev.userId ?? "anonymous",
      stage: result.stage ?? "confirm",
      messages: [...prevMsgs, ...newMsgs],
      updatedAt: at,
    });
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

  // ⭐ 持久化完整对话：刷新页面后可按 sessionId 恢复
  const prev = (await getSessionState(input.sessionId)) ?? {};
  const prevMsgs = Array.isArray(prev.messages) ? prev.messages : [];
  const at = new Date().toISOString();
  const newMsgs = [
    ...(input.message ? [{ role: "user", content: input.message, at }] : []),
    ...(input.resume ? [{ role: "user", content: input.resume, at }] : []),
    ...(guarded.text ? [{ role: "assistant", content: guarded.text, at }] : []),
  ];
  await saveSessionState(input.sessionId, {
    ...prev,
    userId: input.userId ?? prev.userId ?? "anonymous",
    stage: result.stage,
    constraints: result.constraints,
    candidates: result.candidates?.map((c: Candidate) => c.modelId),
    messages: [...prevMsgs, ...newMsgs],
    updatedAt: at,
  });

  trace.end({
    stage: result.stage,
    answerLength: guarded.text.length,
    guardrailWarnings: guarded.warnings,
  });

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
    skipPolish: result.intent === "smalltalk",
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
