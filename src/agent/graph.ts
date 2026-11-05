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
import { parseMessage, matchModelIds } from "./intent";
import { searchCars, compareCars, estimatePrice, searchReviews, createTestDriveLead } from "../tools/index";
import { getAllCars } from "../db/repo";

// ---------- 1. 定义状态 ----------
const AdvisorState = Annotation.Root({
  sessionId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  turnId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  messages: Annotation<ChatMessage[]>({
    reducer: (a, b) => [...a, ...b],          // 消息只追加，不覆盖
    default: () => [],
  }),
  constraints: Annotation<Constraints>({
    reducer: (a, b) => ({ ...a, ...b }),     // 约束合并：后到的覆盖先前的
    default: () => ({}),
  }),
  intent: Annotation<string>({ reducer: (_a, b) => b, default: () => "unknown" }),
  stage: Annotation<Stage>({ reducer: (_a, b) => b, default: () => "clarify" }),
  candidates: Annotation<Candidate[]>({ reducer: (_a, b) => b, default: () => [] }),
  comparison: Annotation<Comparison | null>({ reducer: (_a, b) => b, default: () => null }),
  citations: Annotation<Citation[]>({ reducer: (_a, b) => b, default: () => [] }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  toolEvents: Annotation<ToolEvent[]>({
    reducer: (a, b) => [...a, ...b],          // 工具调用记录累积，便于前端展示
    default: () => [],
  }),
});

type State = typeof AdvisorState.State;

// ---------- 2. 节点：分类 ----------
async function classifyNode(state: State) {
  const last = state.messages[state.messages.length - 1];
  const parsed = parseMessage(last?.content ?? "", state.candidates);

  return {
    turnId: randomUUID(),   // 每轮唯一 ID：前端只展示本轮工具事件
    intent: parsed.intent,
    constraints: { ...state.constraints, ...parsed.constraints },
    stage: "clarify" as Stage,
  };
}

// ---------- 3. 路由：根据意图选择下一站（条件边） ----------
function needMoreInfo(state: State): boolean {
  const c = state.constraints;
  const noBudget = c.budgetMin == null;
  const noContext = !c.usage?.length && !c.energy?.length && !c.bodyType?.length;
  return noBudget || noContext;
}

function routeFromClassify(state: State): string {
  const hasCandidates = state.candidates.length > 0;

  switch (state.intent) {
    case "smalltalk":
      return "smalltalk";
    case "book":
      return hasCandidates || matchModelIds(state.messages.at(-1)?.content ?? "").length
        ? "confirm"
        : "clarify";
    case "compare": {
      // 用户直接点名两款车（如「对比启航A5和远山X3」）时，不需要先推荐
      const named = matchModelIds(state.messages.at(-1)?.content ?? "");
      if (named.length >= 2) return "compare";
      return hasCandidates ? "compare" : needMoreInfo(state) ? "clarify" : "retrieve";
    }
    case "price":
      return hasCandidates ? "quote" : needMoreInfo(state) ? "clarify" : "retrieve";
    case "reviews":
      return hasCandidates ? "reviews" : needMoreInfo(state) ? "clarify" : "retrieve";
    case "recommend":
      return needMoreInfo(state) ? "clarify" : "retrieve";
    default:
      // 不属于任何选车意图时，做自我介绍并引导用户，而不是生硬地要求澄清
      return hasCandidates ? "reviews" : "smalltalk";
  }
}

// ---------- 4. 节点：澄清 ----------
async function clarifyNode(state: State) {
  const c = state.constraints;
  const needs: string[] = [];
  if (c.budgetMin == null) needs.push("预算大概多少（比如「15 万左右」或「10-15 万」）");
  if (!c.usage?.length && !c.energy?.length) needs.push("主要用途（通勤 / 家用 / 长途 / 代步），以及有没有固定充电条件");

  const answer =
    needs.length === 0
      ? "我还需要更多信息才能给出准确推荐，能再说说你的用车场景吗？"
      : `为了给你更准的推荐，先确认一下：\n${needs.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;

  return { answer, stage: "clarify" as Stage };
}

// ---------- 5. 节点：检索候选 ----------
function describeConstraints(c: Constraints): string {
  const parts: string[] = [];
  if (c.budgetMin != null && c.budgetMax != null) parts.push(`预算 ${c.budgetMin}~${c.budgetMax} 万`);
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
      args: { budgetMin: c.budgetMin, budgetMax: c.budgetMax, energy: c.energy, seats: c.seats, usage: c.usage },
      summary: res.summary,
      ok: res.ok,
      ms: Date.now() - started,
    }],
  };
}

// ---------- 6. 节点：对比 ----------
async function compareNode(state: State) {
  const started = Date.now();
  const last = state.messages.at(-1)?.content ?? "";
  const named = matchModelIds(last);
  const ids = named.length >= 2 ? named : state.candidates.slice(0, 3).map((c) => c.modelId);

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

// ---------- 7. 节点：落地价 ----------
async function quoteNode(state: State) {
  const started = Date.now();
  const top = state.candidates[0];
  if (!top) return { answer: "还没有候选车型，先告诉我预算和用途吧。", stage: "quote" as Stage };

  const res = await estimatePrice(top.modelId, top.variantId, state.constraints.city);
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
    toolEvents: [{ turnId: state.turnId, name: "estimate_price", args: { modelId: top.modelId, city: state.constraints.city }, summary: res.summary, ok: res.ok, ms: Date.now() - started }],
  };
}

// ---------- 8. 节点：评测/口碑（RAG） ----------
async function reviewsNode(state: State) {
  const started = Date.now();
  const top = state.candidates[0];
  if (!top) return { answer: "还没有候选车型，先告诉我预算和用途吧。", stage: "recommend" as Stage };

  const topic = state.messages.at(-1)?.content ?? "优缺点";
  const res = await searchReviews(top.modelId, topic);
  const reviews = res.data ?? [];

  const citations: Citation[] = reviews.map((r) => ({
    type: "review",
    title: `${r.source}：${r.title}`,
    detail: `${r.content.slice(0, 60)}…（评分 ${r.rating}）`,
  }));

  const positives = reviews.filter((r) => r.sentiment === "positive").map((r) => `- ${r.title}：${r.content}`);
  const negatives = reviews.filter((r) => r.sentiment !== "positive").map((r) => `- ${r.title}：${r.content}`);

  const answer = [
    `关于 **${top.brand} ${top.series}** 的评测与车主口碑：`,
    positives.length ? `\n**优点/正面**\n${positives.slice(0, 2).join("\n")}` : "",
    negatives.length ? `\n**需要注意**\n${negatives.slice(0, 2).join("\n")}` : "",
    "\n以上内容来自检索到的评测与口碑摘要，建议结合试驾体验判断。",
  ].filter(Boolean).join("\n");

  return {
    answer,
    citations,
    stage: "recommend" as Stage,
    toolEvents: [{ turnId: state.turnId, name: "search_reviews", args: { modelId: top.modelId, topic }, summary: res.summary, ok: res.ok, ms: Date.now() - started }],
  };
}

// ---------- 9. 节点：预约（Human-in-the-loop） ----------
async function confirmNode(state: State) {
  const last = state.messages.at(-1)?.content ?? "";
  const named = matchModelIds(last);
  const modelId = named[0] ?? state.candidates[0]?.modelId ?? "";
  if (!modelId) return { answer: "还没有候选车型，先让我帮你选几款吧。", stage: "done" as Stage };

  const cars = await getAllCars();
  const car = cars.find((c) => c.id === modelId);
  const city = state.constraints.city || "北京";

  // ⭐ 关键：interrupt 会暂停图执行，把问题返回给前端；
  // 用户回复后，用 Command({ resume }) 从断点继续（状态由 checkpointer 保存）。
  const confirmReply = interrupt({
    type: "confirm",
    question: `确认预约「${car?.brand ?? ""} ${car?.series ?? ""}」在${city}的试驾吗？回复「确认」继续，回复其他内容取消。`,
  });

  if (!/确认|是|好|可以|行/.test(String(confirmReply))) {
    return { answer: "已取消预约。", stage: "done" as Stage };
  }

  const phoneReply = interrupt({
    type: "phone",
    question: "请提供手机号（仅用于本次预约；演示环境可输入任意 11 位手机号）。",
  });

  const phone = String(phoneReply).replace(/\D/g, "");
  const res = await createTestDriveLead({
    sessionId: state.sessionId,
    modelId,
    city,
    phone,
    confirmed: true, // 服务端强制校验，不信任前端
  });

  return {
    answer: res.ok
      ? `✅ ${res.summary}\n\n（手机号 ${res.data?.maskedPhone} 已脱敏展示）`
      : `预约失败：${res.summary}`,
    stage: "done" as Stage,
    toolEvents: [{ turnId: state.turnId, name: "create_test_drive_lead", summary: res.summary, ok: res.ok }],
  };
}

// ---------- 9.5 节点：自我介绍 / 闲聊 ----------
async function smalltalkNode(_state: State) {
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

  return { answer, stage: "clarify" as Stage };
}

// ---------- 10. 编译图（单例） ----------
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
    .addNode("classify", classifyNode)
    .addNode("clarify", clarifyNode)
    .addNode("retrieve", retrieveNode)
    .addNode("compare", compareNode)
    .addNode("quote", quoteNode)
    .addNode("reviews", reviewsNode)
    .addNode("confirm", confirmNode)
    .addNode("smalltalk", smalltalkNode)
    .addEdge(START, "classify")
    .addConditionalEdges("classify", routeFromClassify, {
      smalltalk: "smalltalk",
      clarify: "clarify",
      retrieve: "retrieve",
      compare: "compare",
      quote: "quote",
      reviews: "reviews",
      confirm: "confirm",
    })
    .addEdge("clarify", END)
    .addEdge("retrieve", END)
    .addEdge("compare", END)
    .addEdge("quote", END)
    .addEdge("reviews", END)
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
