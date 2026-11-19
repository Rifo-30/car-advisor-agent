// ============================================================
// 执行模式路由：规则快路径 + LLM 模糊兜底
// LLM 只决定 direct / tool_loop / clarify，不直接执行工具
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Candidate, Constraints } from "../types";
import { isMultiStepResearch } from "./intent";

export type ExecutionMode = "direct" | "tool_loop" | "clarify";
export type RouteSource = "rule" | "model" | "fallback";

export interface ExecutionRouteInput {
  text: string;
  intent: string;
  constraints: Constraints;
  candidates: Candidate[];
  contextSummary?: string;
  /** 上一轮是否处于持续研究任务 */
  activeTask?: string;
}

export interface ExecutionRouteResult {
  mode: ExecutionMode;
  source: RouteSource;
  confidence: number;
  reason: string;
}

export type ExecutionRouteInvoke = (system: string, human: string) => Promise<string>;

const HIGH_RISK = /预约|试驾|提交|手机号|确认预约|下单|支付/;
const RESEARCH_HINT = /研究|综合|分析|值得买|挑一挑|帮我看看|帮我比较|怎么选/;
const RELATIVE_BUDGET_QUERY = /更便宜|便宜点|再便宜|贵一点|预算.*(?:低|高|增加|减少)|降低预算|提高预算/;
const CONTINUATION_ACTION = /推荐|找|筛选|对比|比较|看看|查看|多少钱|价格|预约|试驾|研究|分析/;

function isResearchContinuation(input: ExecutionRouteInput): boolean {
  if (input.activeTask !== "research" || input.intent !== "recommend") return false;
  const hasConstraint = Object.keys(input.constraints).length > 0;
  return hasConstraint && !CONTINUATION_ACTION.test(input.text);
}
const TOOL_SIGNALS = [
  /参数|详情|配置/,
  /口碑|评价|缺点|优点/,
  /落地|价格|报价|多少钱/,
  /对比|比较/,
];

function ruleRoute(input: ExecutionRouteInput): ExecutionRouteResult {
  if (input.intent === "research" || isMultiStepResearch(input.text)) {
    return { mode: "tool_loop", source: "rule", confidence: 1, reason: "命中明确多步任务规则" };
  }
  if (isResearchContinuation(input)) {
    return { mode: "tool_loop", source: "rule", confidence: 0.9, reason: "延续上一轮研究任务并追加约束" };
  }
  if (HIGH_RISK.test(input.text)) {
    return { mode: "direct", source: "rule", confidence: 1, reason: "高风险或写操作强制走确定性流程" };
  }
  if (input.intent === "unknown" && !input.candidates.length) {
    return { mode: "clarify", source: "rule", confidence: 0.5, reason: "意图不明确且没有候选上下文" };
  }
  if (input.candidates.length && RELATIVE_BUDGET_QUERY.test(input.text)) {
    return { mode: "clarify", source: "rule", confidence: 0.75, reason: "需要确认预算调整幅度" };
  }
  return { mode: "direct", source: "rule", confidence: 0.9, reason: "使用确定性工作流" };
}

function parseModelRoute(raw: string): { mode: ExecutionMode; confidence: number; reason: string } | null {
  try {
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const obj = JSON.parse(text) as Record<string, unknown>;
    const mode = String(obj.mode ?? "") as ExecutionMode;
    const confidence = Number(obj.confidence ?? 0);
    const reason = String(obj.reason ?? "").trim();
    if (!["direct", "tool_loop", "clarify"].includes(mode)) return null;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !reason) return null;
    return { mode, confidence, reason: reason.slice(0, 300) };
  } catch {
    return null;
  }
}

function shouldAskModel(input: ExecutionRouteInput): boolean {
  if (HIGH_RISK.test(input.text)) return false;
  if (input.intent === "research" || isMultiStepResearch(input.text) || isResearchContinuation(input)) return false;
  if (input.intent === "unknown") return true;
  const toolSignalCount = TOOL_SIGNALS.filter((pattern) => pattern.test(input.text)).length;
  return RESEARCH_HINT.test(input.text) || toolSignalCount >= 2;
}

/**
 * 规则优先决定明显场景，只有模糊路由才调用模型。
 * 模型失败、低置信度或非法输出时回退到 direct/rule。
 */
export async function routeExecutionMode(
  input: ExecutionRouteInput,
  options: { invokeModel?: ExecutionRouteInvoke; enabled?: boolean } = {}
): Promise<ExecutionRouteResult> {
  const ruleResult = ruleRoute(input);
  if (!shouldAskModel(input)) return ruleResult;

  const enabled = options.enabled ?? (process.env.EXECUTION_ROUTER_ENABLED !== "false" && Boolean(process.env.OPENAI_API_KEY));
  if (!enabled && !options.invokeModel) return ruleResult;

  const invokeModel = options.invokeModel ?? (async (system: string, human: string) => {
    const model = new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      temperature: 0,
      maxRetries: 0,
      timeout: 4000,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
    } as any);
    const result = await model.invoke([new SystemMessage(system), new HumanMessage(human)]);
    return typeof result.content === "string" ? result.content : "";
  });

  try {
    const raw = await invokeModel(
      "你是汽车 Agent 的执行路由器。只输出 JSON：{\"mode\":\"direct|tool_loop|clarify\",\"confidence\":0到1,\"reason\":\"简短理由\"}。tool_loop 只用于确实需要多个工具、且后续动作依赖前一步结果的任务；direct 用于单一筛选、对比、报价、口碑或预约；clarify 用于信息严重不足。预约、试驾、提交、支付等写操作永远不能用 tool_loop。",
      [
        `用户输入：${input.text}`,
        `当前意图：${input.intent}`,
        `当前约束：${JSON.stringify(input.constraints)}`,
        `当前候选：${input.candidates.map((car) => `${car.brand} ${car.series}`).join("、") || "无"}`,
        `历史摘要：${input.contextSummary || "无"}`,
        "只输出路由 JSON。",
      ].join("\n")
    );
    const parsed = parseModelRoute(raw);
    if (!parsed || parsed.confidence < 0.7) return { ...ruleResult, source: "fallback" };
    if (parsed.mode === "tool_loop" && HIGH_RISK.test(input.text)) {
      return { mode: "direct", source: "model", confidence: parsed.confidence, reason: "写操作策略覆盖模型路由" };
    }
    return { ...parsed, source: "model" };
  } catch (err) {
    console.warn("[router] 执行模式模型判断失败，使用规则回退:", (err as Error).message);
    return { ...ruleResult, source: "fallback" };
  }
}
