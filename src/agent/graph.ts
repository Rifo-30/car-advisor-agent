// ============================================================
// Agent 编排层：LangGraph 状态机
//
// 面试可以这样讲：
// 1) State（状态）：会话中所有需要跨步骤共享的数据，比如约束、候选、答案；
// 2) Node（节点）：每一步动作（分类、检索、对比、报价、预约）；
// 3) Edge（边）：步骤之间的流转，条件边 = 根据状态动态选择下一站；
// 4) Checkpointer：按 thread_id 持久化每一步状态，支持多轮和人工中断；
// 5) interrupt()：在节点内暂停，把控制权交还用户，恢复后从断点继续。
// ============================================================
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Candidate, ChatMessage, Citation, Comparison, Constraints, Stage, ToolEvent } from "../types";
import { randomUUID } from "node:crypto";
import { parseMessage, matchModelIds, needsModelFallback } from "./intent";
import { extractIntentWithModel } from "./intentModel";
import { mergeIntent } from "./mergeIntent";
import { parseConfirmDecision } from "./confirm";
import { isValidPhone } from "../guardrails/guard";
import { searchCars, compareCars, estimatePrice, searchReviews, createTestDriveLead } from "../tools/index";
import { getAllCars } from "../db/repo";
import { applyBudgetDelta, resolveTurnContext } from "./context";
import { rewriteReviewQuery } from "../rag/queryRewrite";
import { runResearchAgent } from "./toolAgent";
import { buildReviewFocus } from "./reviewAnswer";
import { compressContext } from "./contextCompression";
import { routeExecutionMode } from "./executionRouter";
import { appendSpan } from "../observability/trace";

// ---------- 1. 定义状态 ----------
/**
 * _a 是旧值，下划线前缀表示"故意不用"（ESLint 约定，避免"未使用变量"警告）
 */
const AdvisorState = Annotation.Root({
  sessionId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  traceId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  userId: Annotation<string>({ reducer: (_a, b) => b, default: () => "anonymous" }),
  ordinal: Annotation<number[]>({ reducer: (_a, b) => b, default: () => [] }), // "第几款"的下标数组，用于精确指定候选
  turnId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }), // 该轮唯一ID、用户展示这一轮的信息，比如筛选出这一轮的工具展示
  messages: Annotation<ChatMessage[]>({
    reducer: (a, b) => [...a, ...b],          // 消息只追加，不覆盖
    default: () => [],
  }),
  contextSummary: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  contextWindowMessages: Annotation<ChatMessage[]>({ reducer: (_a, b) => b, default: () => [] }),
  contextSummarizedCount: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  contextEstimatedTokens: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  contextCompressed: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  executionMode: Annotation<string>({ reducer: (_a, b) => b, default: () => "direct" }),
  executionRouteSource: Annotation<string>({ reducer: (_a, b) => b, default: () => "rule" }),
  constraints: Annotation<Constraints>({
    reducer: (a, b) => ({ ...a, ...b }),     // 约束合并：后到的覆盖先前的
    default: () => ({}),
  }),
  intent: Annotation<string>({ reducer: (_a, b) => b, default: () => "unknown" }),
  /** 意图来源：rule / hybrid（规则 + 模型补充） */
  intentSource: Annotation<string>({ reducer: (_a, b) => b, default: () => "rule" }),
  stage: Annotation<Stage>({ reducer: (_a, b) => b, default: () => "clarify" }),
  routingStage: Annotation<string>({ reducer: (_a, b) => b, default: () => "idle" }),
  activeTask: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  activeTaskGoals: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  candidates: Annotation<Candidate[]>({ reducer: (_a, b) => b, default: () => [] }),
  targetModelId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  targetModelIds: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  budgetDelta: Annotation<number | null>({ reducer: (_a, b) => b, default: () => null }),
  budgetDeltaError: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  retrievalQuery: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  agentSteps: Annotation<number | null>({ reducer: (_a, b) => b, default: () => null }),
  comparison: Annotation<Comparison | null>({ reducer: (_a, b) => b, default: () => null }),
  citations: Annotation<Citation[]>({ reducer: (_a, b) => b, default: () => [] }), // 本轮答案的来源（参数/口碑），用于溯源和防幻觉
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  toolEvents: Annotation<ToolEvent[]>({
    reducer: (a, b) => [...a, ...b],          // 工具调用记录累积，便于前端展示
    default: () => [],
  }),
});

type State = typeof AdvisorState.State;

// ---------- 2. 节点：上下文预算与压缩 ----------
async function prepareContextNode(state: State) {
  const compressed = await compressContext(
    state.messages,
    {
      maxTokens: Number(process.env.CONTEXT_MAX_TOKENS ?? 3000),
      keepRecentMessages: Number(process.env.CONTEXT_KEEP_RECENT_MESSAGES ?? 8),
      summaryMaxTokens: Number(process.env.CONTEXT_SUMMARY_MAX_TOKENS ?? 600),
      summarizedCount: state.contextSummarizedCount,
    },
    state.contextSummary
  );

  if (compressed.compressed) {
    console.log("[context] 上下文已压缩:", {
      originalMessages: state.messages.length,
      windowMessages: compressed.messages.length,
      estimatedTokens: compressed.estimatedTokens,
    });
  }

  return {
    contextSummary: compressed.summary,
    contextWindowMessages: compressed.messages,
    contextSummarizedCount: compressed.summarizedCount,
    contextEstimatedTokens: compressed.estimatedTokens,
    contextCompressed: compressed.compressed,
  };
}

function contextHistory(state: State): ChatMessage[] {
  return state.contextWindowMessages.length ? state.contextWindowMessages : state.messages;
}

// ---------- 3. 节点：分类 ----------
async function classifyNode(state: State) {
  const history = contextHistory(state);
  const last = history[history.length - 1];
  const text = last?.content ?? "";
  // ⭐ 用数据库里的车型做名称匹配，避免静态数据与库不一致
  const cars = await getAllCars();
  const parsed = parseMessage(text, state.candidates, cars);

  // ⭐ 规则 + 模型混合：
  //   规则能确定 → 直接用（0 额外成本）
  //   规则不确定 → 调模型做结构化抽取 → 校验 → 规则优先合并
  let intent: string = parsed.intent;
  let constraints = parsed.constraints;
  let budgetDelta = parsed.budgetDelta;
  let intentSource = "rule";

  if (needsModelFallback(parsed)) {
    const modelResult = await extractIntentWithModel(text, {
      intent: parsed.intent,
      constraints: parsed.constraints,
      previousConstraints: state.constraints,
      contextSummary: state.contextSummary,
    });

    if (modelResult) {
      const merged = mergeIntent(
        { intent: parsed.intent, constraints: parsed.constraints, weakIntent: parsed.weakIntent },
        modelResult
      );
      intent = merged.intent;
      constraints = merged.constraints;
      budgetDelta = merged.budgetDelta;
      intentSource = merged.adopted ? "hybrid" : "rule";

      if (merged.conflicts.length) {
        console.warn("[intent] 规则与模型冲突（已按规则优先）:", merged.conflicts.join("; "));
      }
    }
  }

  let nextConstraints: Constraints = { ...state.constraints, ...constraints };
  let budgetDeltaError = "";
  let resolvedBudgetDelta: number | null = budgetDelta ?? null;

  if (budgetDelta != null) {
    const adjusted = applyBudgetDelta(nextConstraints, budgetDelta);
    if (adjusted.applied) {
      nextConstraints = adjusted.constraints;
    } else if (adjusted.reason === "MISSING_BASE") {
      budgetDeltaError = "当前会话还没有基础预算，不能直接做相对预算调整。";
      console.warn("[intent] 相对预算缺少基础区间:", { budgetDelta, previousConstraints: state.constraints });
    } else {
      budgetDeltaError = "预算调整后的区间无效，请确认调整金额。";
      resolvedBudgetDelta = null;
      console.warn("[intent] 相对预算计算结果无效:", { budgetDelta, previousConstraints: state.constraints });
    }
  }

  const resolved = resolveTurnContext({
    intent,
    text,
    candidates: state.candidates,
    cars,
    explicitModelIds: parsed.modelIds,
    ordinal: parsed.ordinal,
  });

  const targetCar = resolved.targetModelId
    ? cars.find((car) => car.id === resolved.targetModelId)
    : undefined;
  const retrievalQuery = intent === "reviews" && targetCar
    ? await rewriteReviewQuery({
        question: text,
        car: targetCar,
        contextSummary: state.contextSummary,
        previousUserMessages: contextHistory(state)
          .filter((message) => message.role === "user")
          .slice(-3, -1)
          .map((message) => message.content),
      }).catch(() => "")
    : "";
  const routeStarted = Date.now();
  const executionRoute = await routeExecutionMode({
    text,
    intent,
    constraints: nextConstraints,
    candidates: state.candidates,
    contextSummary: state.contextSummary,
    activeTask: state.activeTask,
  });
  appendSpan(
    state.traceId,
    "router:execution",
    { intent, text: text.slice(0, 200) },
    {
      mode: executionRoute.mode,
      source: executionRoute.source,
      confidence: executionRoute.confidence,
      reason: executionRoute.reason,
    },
    Date.now() - routeStarted
  );

  return {
    turnId: randomUUID(),   // 每轮唯一 ID：前端只展示本轮工具事件
    intent,
    constraints: nextConstraints,
    ordinal: parsed.ordinal ?? [],
    targetModelId: resolved.targetModelId ?? "",
    targetModelIds: resolved.targetModelIds,
    budgetDelta: resolvedBudgetDelta,
    budgetDeltaError,
    retrievalQuery,
    executionMode: executionRoute.mode,
    executionRouteSource: executionRoute.source,
    activeTask: executionRoute.mode === "tool_loop" ? "research" : state.activeTask,
    intentSource,
    routingStage: "classifying",
  };
}

// ---------- 4. 路由：根据意图选择下一站（条件边） ----------
function needMoreInfo(state: State): boolean {
  if (state.budgetDeltaError) return true;
  const c = state.constraints;
  const noBudget = c.budgetMode !== "any" && c.budgetMin == null && c.budgetMax == null;
  const noContext = !c.usage?.length && !c.energy?.length && !c.bodyType?.length;
  return noBudget || noContext;
}

function routeFromClassify(state: State): string {
  const hasCandidates = state.candidates.length > 0;

  if (state.executionMode === "clarify") return "clarify";
  if (state.executionMode === "tool_loop") {
    return needMoreInfo(state) ? "clarify" : "research";
  }

  switch (state.intent) {
    case "smalltalk":
      return "smalltalk";
    case "book":
      return Boolean(state.targetModelId) || hasCandidates
        ? "confirm"
        : "clarify";
    case "compare": {
      // 用户直接点名两款车（如「对比启航A5和远山X3」）时，不需要先推荐
      if (state.targetModelIds.length >= 2) return "compare";
      return hasCandidates ? "compare" : needMoreInfo(state) ? "clarify" : "retrieve";
    }
    case "price":
      return state.targetModelId || hasCandidates ? "quote" : needMoreInfo(state) ? "clarify" : "retrieve";
    case "reviews":
      return state.targetModelId || hasCandidates ? "reviews" : needMoreInfo(state) ? "clarify" : "retrieve";
    case "research":
      return needMoreInfo(state) ? "clarify" : "research";
    case "recommend":
      return needMoreInfo(state) ? "clarify" : "retrieve";
    default:
      // 不属于任何选车意图时，做自我介绍并引导用户，而不是生硬地要求澄清
      return hasCandidates ? "reviews" : "smalltalk";
  }
}

// ---------- 5. 节点：澄清 ----------
async function clarifyNode(state: State) {
  const c = state.constraints;
  const needs: string[] = [];
  const missingBaseForDelta = state.budgetDelta != null && c.budgetMin == null;

  if (missingBaseForDelta) {
    const direction = state.budgetDelta! > 0 ? "增加" : "减少";
    needs.unshift(`你想把预算${direction} ${Math.abs(state.budgetDelta!)} 万，但我还不知道当前基础预算，请先告诉我现在的预算。`);
  } else {
    if (state.budgetDeltaError) needs.push(state.budgetDeltaError);
    if (c.budgetMode !== "any" && c.budgetMin == null && c.budgetMax == null) needs.push("预算大概多少（比如「15 万左右」或「10-15 万」）");
  }
  if (!c.usage?.length && !c.energy?.length) needs.push("主要用途（通勤 / 家用 / 长途 / 代步），以及有没有固定充电条件");

  const answer =
    needs.length === 0
      ? "我还需要更多信息才能给出准确推荐，能再说说你的用车场景吗？"
      : `为了给你更准的推荐，先确认一下：\n${needs.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;

  return { answer, stage: "clarify" as Stage };
}

// ---------- 6. 节点：检索候选 ----------
function describeConstraints(c: Constraints): string {
  const parts: string[] = [];
  if (c.budgetMode === "any") parts.push("不限预算");
  else if (c.budgetMode === "max" && c.budgetMax != null) parts.push(`预算 ${c.budgetMax} 万以内`);
  else if (c.budgetMode === "min" && c.budgetMin != null) parts.push(`预算 ${c.budgetMin} 万以上`);
  else if (c.budgetMin != null && c.budgetMax != null) parts.push(`预算 ${c.budgetMin}~${c.budgetMax} 万`);
  if (c.energy?.length) parts.push(`能源 ${c.energy.join("/")}`);
  if (c.seats) parts.push(`${c.seats} 座`);
  if (c.bodyType?.length) parts.push(c.bodyType.join("/"));
  if (c.usage?.length) parts.push(`用途 ${c.usage.join("/")}`);
  if (c.charging) parts.push("有充电条件");
  return parts.join("，") || "你的需求";
}

function buildRecommendation(candidates: Candidate[], c: Constraints): string {
  if (!candidates.length) {
    return "按当前条件没有找到合适车型。可以把预算放宽一点，或者减少一个硬性条件（比如能源类型）再试试。";
  }

  const lines = [`按${describeConstraints(c)}，我筛出 ${candidates.length} 款比较合适的：`];
  candidates.forEach((car, i) => {
    lines.push(
      `${i + 1}. **${car.brand} ${car.series}**（${car.variantName}，${car.price.toFixed(2)} 万，${car.level} / ${car.energyType} / ${car.seats} 座）\n` +
      `   - 推荐理由：${car.why.join("；")}\n` +
      `   - 需要注意：${car.tradeoffs.join("；")}`
    );
  });
  lines.push("想进一步看**多车对比**、**估算落地价**，还是**预约试驾**？");
  return lines.join("\n");
}

async function retrieveNode(state: State) {
  const started = Date.now();
  const c = state.constraints;

  const res = await searchCars({
    budgetMin: c.budgetMin,
    budgetMax: c.budgetMax,
    budgetMode: c.budgetMode,
    energy: c.energy,
    seats: c.seats,
    bodyType: c.bodyType,
    usage: c.usage,
    charging: c.charging,
    limit: 3,
  });

  const candidates = res.data ?? [];
  const citations: Citation[] = candidates.map((car) => ({
    type: "spec",
    title: `${car.brand} ${car.series}`,
    detail: `指导价 ${car.price.toFixed(2)} 万 / ${car.energyType} / ${car.seats} 座 / ${car.level}`,
  }));

  return {
    candidates,
    citations,
    answer: buildRecommendation(candidates, c),
    stage: "recommend" as Stage,
    toolEvents: [{
      turnId: state.turnId,
      name: "search_cars",
      args: {
        budgetMin: c.budgetMin,
        budgetMax: c.budgetMax,
        energy: c.energy,
        seats: c.seats,
        bodyType: c.bodyType,
        usage: c.usage,
        charging: c.charging,
      },
      summary: res.summary,
      ok: res.ok,
      ms: Date.now() - started,
    }],
  };
}

// ---------- 7. 节点：对比 ----------
async function compareNode(state: State) {
  const started = Date.now();
  const last = state.messages.at(-1)?.content ?? "";
  const cars = await getAllCars();
  const named = matchModelIds(last, cars);
  // ⭐ 支持"第一款/前两款/第三款"这类序数引用
  const ordinalIds = (state.ordinal ?? [])
    .map((i) => state.candidates[i]?.modelId)
    .filter((v): v is string => Boolean(v));
  const ids = state.targetModelIds.length >= 2
    ? state.targetModelIds
    : named.length >= 2
    ? named
    : ordinalIds.length >= 2
      ? ordinalIds
      : state.candidates.slice(0, 3).map((c) => c.modelId);

  const res = await compareCars(ids);
  if (!res.ok || !res.data) {
    return { answer: res.summary, stage: "compare" as Stage, toolEvents: [{ turnId: state.turnId, name: "compare_cars", summary: res.summary, ok: false }] };
  }

  const { columns, rows } = res.data;
  const lines = [
    `**${columns.map((c) => c.title).join(" vs ")}** 的核心参数对比如下：`,
    "",
    `| 项目 | ${columns.map((c) => c.title).join(" | ")} |`,
    `| --- | ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.label} | ${r.values.join(" | ")} |`),
    "",
    "**怎么选**：先看你的硬约束（预算、座位、能源），再在满足约束的车里比空间、续航和用车成本；参数之外建议一定去试驾。",
  ];

  return {
    comparison: res.data,
    answer: lines.join("\n"),
    stage: "compare" as Stage,
    toolEvents: [{ turnId: state.turnId, name: "compare_cars", args: { modelIds: ids }, summary: res.summary, ok: true, ms: Date.now() - started }],
  };
}

// ---------- 8. 节点：落地价 ----------
async function quoteNode(state: State) {
  const started = Date.now();
  const cars = await getAllCars();
  const targetId = state.targetModelId || state.candidates[0]?.modelId || "";
  const targetCar = cars.find((car) => car.id === targetId);
  if (!targetId || !targetCar) return { answer: "还没有候选车型，先告诉我预算和用途吧。", stage: "quote" as Stage };
  const candidate = state.candidates.find((item) => item.modelId === targetId);
  const variantId = candidate?.variantId ?? targetCar.variants[0]?.id;

  const res = await estimatePrice(targetId, variantId, state.constraints.city);
  const d = res.data;
  const answer = d
    ? [
        `**${d.car} ${d.variant}** 在${d.city}的落地价估算：`,
        `- 裸车价：${d.guidePrice} 万`,
        `- 购置税：${d.purchaseTax} 万`,
        `- 保险：约 ${d.insurance} 万`,
        `- 上牌：约 ${d.plate} 万`,
        `- **合计约 ${d.total} 万**`,
        "",
        "> 以上为估算值，实际以经销商报价、当地政策和保险方案为准。",
      ].join("\n")
    : res.summary;

  return {
    answer,
    stage: "quote" as Stage,
    toolEvents: [{ turnId: state.turnId, name: "estimate_price", args: { modelId: targetId, city: state.constraints.city }, summary: res.summary, ok: res.ok, ms: Date.now() - started }],
  };
}

// ---------- 9. 节点：评测/口碑（RAG） ----------
async function reviewsNode(state: State) {
  const started = Date.now();
  const cars = await getAllCars();
  const targetId = state.targetModelId || state.candidates[0]?.modelId || "";
  const targetCar = cars.find((car) => car.id === targetId);
  if (!targetId || !targetCar) return { answer: "还没有候选车型，先告诉我预算和用途吧。", stage: "recommend" as Stage };

  const query = state.retrievalQuery || state.messages.at(-1)?.content || "优缺点";
  const question = state.messages.at(-1)?.content ?? "优缺点";
  const res = await searchReviews(targetId, query);
  const reviews = res.data ?? [];
  const focus = buildReviewFocus(question, reviews);
  const asksNegative = /缺点|不足|问题|槽点|吐槽/.test(question);

  const citations: Citation[] = reviews.map((r) => ({
    type: "review",
    title: `${r.source}：${r.title}`,
    detail: `${r.content.slice(0, 60)}…（评分 ${r.rating}）`,
  }));

  const positives = asksNegative
    ? []
    : reviews.filter((r) => r.sentiment === "positive").map((r) => `- ${r.title}：${r.content}`);
  const negatives = asksNegative
    ? []
    : reviews.filter((r) => r.sentiment !== "positive").map((r) => `- ${r.title}：${r.content}`);

  const answer = [
    `关于 **${targetCar.brand} ${targetCar.series}** 的评测与车主口碑：`,
    focus,
    positives.length ? `\n**优点/正面**\n${positives.slice(0, 2).join("\n")}` : "",
    negatives.length ? `\n**需要注意**\n${negatives.slice(0, 2).join("\n")}` : "",
    "\n以上内容来自检索到的评测与口碑摘要，建议结合试驾体验判断。",
  ].filter(Boolean).join("\n");

  return {
    answer,
    citations,
    stage: "reviews" as Stage,
    toolEvents: [{ turnId: state.turnId, name: "search_reviews", args: { modelId: targetId, query }, summary: res.summary, ok: res.ok, ms: Date.now() - started }],
  };
}

// ---------- 9.5 节点：受控 Tool Calling 研究循环 ----------
async function researchAgentNode(state: State) {
  const query = state.messages.at(-1)?.content ?? "";
  const inferredGoals: string[] = [];
  if (/推荐|找|筛选|选车|看看|查看|万|预算/.test(query)) inferredGoals.push("search");
  if (/对比|比较/.test(query)) inferredGoals.push("compare");
  if (/口碑|评价|缺点|优点/.test(query)) inferredGoals.push("reviews");
  if (/落地|多少钱|报价/.test(query)) inferredGoals.push("price");
  if (/预约|试驾/.test(query)) inferredGoals.push("booking");
  const taskGoals = [...new Set([...state.activeTaskGoals, ...inferredGoals])];
  const result = await runResearchAgent({
    query,
    contextSummary: state.contextSummary,
    history: contextHistory(state),
    turnId: state.turnId,
    constraints: state.constraints,
    candidates: state.candidates,
    targetModelId: state.targetModelId,
    targetModelIds: state.targetModelIds,
    bookingRequested: /预约|试驾/.test(query),
    taskGoals,
  });

  return {
    answer: result.answer,
    candidates: result.candidates,
    comparison: result.comparison ?? null,
    citations: result.citations,
    toolEvents: result.toolEvents,
    agentSteps: result.steps,
    activeTaskGoals: taskGoals,
    stage: "recommend" as Stage,
  };
}

// ---------- 10. 节点：预约（Human-in-the-loop） ----------
async function confirmNode(state: State) {
  const cars = await getAllCars();
  const last = state.messages.at(-1)?.content ?? "";
  const named = matchModelIds(last, cars);
  const ordinalPick = state.ordinal?.length ? state.candidates[state.ordinal[0]] : undefined;
  const modelId = state.targetModelId || named[0] || ordinalPick?.modelId || state.candidates[0]?.modelId || "";
  if (!modelId) return { answer: "还没有候选车型，先让我帮你选几款吧。", stage: "done" as Stage };

  const car = cars.find((c) => c.id === modelId);
  const city = state.constraints.city || "北京";
  const carName = `${car?.brand ?? ""} ${car?.series ?? ""}`.trim();

  // ⭐ 确认阶段：最多问 2 次，模棱两可绝不默认执行
  let decision: "confirm" | "cancel" | "ambiguous" = "ambiguous";
  for (let attempt = 0; attempt < 2; attempt++) {
    const question =
      attempt === 0
        ? `确认预约「${carName}」在${city}的试驾吗？请回复「确认」或「取消」。`
        : `我没有识别到明确意图。请回复「确认」预约「${carName}」试驾，或回复「取消」。`;
    const reply = interrupt({ type: "confirm", question });
    decision = parseConfirmDecision(reply);
    if (decision !== "ambiguous") break;
  }

  if (decision !== "confirm") {
    return {
      answer: decision === "cancel" ? "已取消预约。" : "没有收到明确确认，已取消本次预约。",
      stage: "done" as Stage,
    };
  }

  // ⭐ 手机号阶段：最多问 2 次，格式不对就重问
  let phone = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = interrupt({
      type: "phone",
      question:
        attempt === 0
          ? "请提供手机号（仅用于本次预约；演示环境可输入任意 11 位手机号）。"
          : "手机号格式不正确，请重新输入 11 位手机号。",
    });
    const digits = String(reply ?? "").replace(/\D/g, "");
    if (isValidPhone(digits)) {
      phone = digits;
      break;
    }
  }

  if (!phone) {
    return { answer: "手机号无效，已取消预约。", stage: "done" as Stage };
  }

  const res = await createTestDriveLead({
    sessionId: state.sessionId,
    userId: state.userId,
    modelId,
    city,
    phone,
    confirmed: true, // 服务端强制校验
  });

  return {
    answer: res.ok
      ? `✅ ${res.summary}\n\n（手机号 ${res.data?.maskedPhone} 已脱敏展示）`
      : `预约失败：${res.summary}`,
    stage: "done" as Stage,
    toolEvents: [{ turnId: state.turnId, name: "create_test_drive_lead", summary: res.summary, ok: res.ok }],
  };
}

// ---------- 10.5 节点：自我介绍 / 闲聊 ----------
async function smalltalkNode() {
  const answer = [
    "我是 **懂车顾问**，一个专注选车决策的 AI 助手。",
    "",
    "我可以帮你：",
    "1. 按预算和用途筛选车型",
    "2. 解释推荐理由和每款车的短板",
    "3. 做多车参数对比",
    "4. 估算落地价",
    "5. 查评测与车主口碑",
    "6. 预约试驾（需要你确认）",
    "",
    "告诉我你的**预算**和**主要用途**（通勤/家用/长途），我们就可以开始。",
  ].join("\n");

  return { answer, stage: "smalltalk" as Stage };
}

// ---------- 11. 编译图（单例） ----------
// ⭐ Checkpointer 选择策略：
//   有 DATABASE_URL → PostgresSaver（跨重启/多实例持久化）
//   无 DATABASE_URL → MemorySaver（本地开发，状态只在内存）
//   PostgresSaver 初始化失败 → 自动降级 MemorySaver，不影响主流程
let compiledPromise: Promise<any> | null = null;

async function createCheckpointer(): Promise<any> {
  if (!process.env.DATABASE_URL) {
    console.log("[graph] 未配置 DATABASE_URL → 使用 MemorySaver（状态不持久化）");
    return new MemorySaver();
  }

  try {
    const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL);
    await saver.setup(); // 首次运行自动创建 checkpoint_* 表（幂等）
    console.log("[graph] 使用 PostgresSaver（状态持久化）");
    return saver;
  } catch (err) {
    console.warn(
      "[graph] PostgresSaver 初始化失败，降级为 MemorySaver:",
      (err as Error).message
    );
    return new MemorySaver();
  }
}

function buildGraph(checkpointer: any) {
  return new StateGraph(AdvisorState)
    .addNode("prepare_context", prepareContextNode)
    .addNode("classify", classifyNode)
    .addNode("clarify", clarifyNode)
    .addNode("retrieve", retrieveNode)
    .addNode("compare", compareNode)
    .addNode("quote", quoteNode)
    .addNode("reviews", reviewsNode)
    .addNode("research", researchAgentNode)
    .addNode("confirm", confirmNode)
    .addNode("smalltalk", smalltalkNode)
    .addEdge(START, "prepare_context")
    .addEdge("prepare_context", "classify")
    .addConditionalEdges("classify", routeFromClassify, {
      smalltalk: "smalltalk",
      clarify: "clarify",
      retrieve: "retrieve",
      compare: "compare",
      quote: "quote",
      reviews: "reviews",
      research: "research",
      confirm: "confirm",
    })
    .addEdge("clarify", END)
    .addEdge("retrieve", END)
    .addEdge("compare", END)
    .addEdge("quote", END)
    .addEdge("reviews", END)
    .addEdge("research", END)
    .addEdge("confirm", END)
    .addEdge("smalltalk", END)
    .compile({ checkpointer });
}

export async function getAdvisorGraph() {
  if (!compiledPromise) {
    compiledPromise = (async () => {
      const checkpointer = await createCheckpointer();
      return buildGraph(checkpointer);
    })();
  }
  return compiledPromise;
}

export type { State as AdvisorGraphState };
