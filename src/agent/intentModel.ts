// ============================================================
// 意图抽取的「模型补充层」
//
// 设计原则：
// 1) 只在规则层"不确定"时才调用（由 intent.ts 的 needsModelFallback 判断）
// 2) 模型只做「结构化抽取」，不生成自然语言、不做决策
// 3) 输出必须过白名单校验（intent/energy 等枚举、数值范围）
// 4) 超时/格式错/置信度低 → 返回 null，调用方继续用规则结果
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Constraints, EnergyType } from "../types";

export interface ModelIntentResult {
  intent: string;
  constraints: Constraints;
  /** 相对预算变化，单位万元；正数增加，负数减少 */
  budgetDelta?: number;
  confidence: number;
}

export const ALLOWED_INTENTS = [
  "recommend",
  "compare",
  "price",
  "reviews",
  "research",
  "book",
  "smalltalk",
  "clarify",
] as const;

export const ALLOWED_ENERGIES: EnergyType[] = ["燃油", "混动", "纯电"];
export const ALLOWED_BODY_TYPES = ["SUV", "轿车", "MPV", "两厢车"];
export const ALLOWED_USAGE = ["家用", "通勤", "长途", "通过性", "省油", "空间"];

const MIN_CONFIDENCE = 0.6;

/** 是否启用模型补充：有 Key 且没被显式关闭 */
export function isIntentModelEnabled(): boolean {
  if (process.env.INTENT_MODEL_ENABLED === "false") return false;
  return Boolean(process.env.OPENAI_API_KEY);
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function toStringArray(value: unknown, limit: number, maxLen = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && v.length <= maxLen)
    .slice(0, limit);
}

/**
 * 校验并收窄模型输出（纯函数，可单测）
 * - intent 必须在白名单内
 * - confidence < 0.6 视为"不确定"，返回 null
 * - energy / bodyType / usage 只保留合法枚举
 * - 预算 / 座位做范围校验，预算区间反了则丢弃
 */
export function validateModelIntent(raw: unknown): ModelIntentResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const intent = String(obj.intent ?? "").trim();
  if (!ALLOWED_INTENTS.includes(intent as (typeof ALLOWED_INTENTS)[number])) return null;

  const confidence = Number(obj.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) return null;

  const constraints: Constraints = {};

  const usage = toStringArray(obj.usage, 5).filter((u) => ALLOWED_USAGE.includes(u));
  if (usage.length) constraints.usage = usage;

  const energy = toStringArray(obj.energy, 3).filter((e): e is EnergyType =>
    ALLOWED_ENERGIES.includes(e as EnergyType)
  );
  if (energy.length) constraints.energy = energy;

  const bodyType = toStringArray(obj.bodyType, 3).filter((b) => ALLOWED_BODY_TYPES.includes(b));
  if (bodyType.length) constraints.bodyType = bodyType;

  if (typeof obj.seats === "number" && Number.isInteger(obj.seats) && obj.seats >= 2 && obj.seats <= 7) {
    constraints.seats = obj.seats;
  }

  if (typeof obj.charging === "boolean") constraints.charging = obj.charging;

  const city = typeof obj.city === "string" ? obj.city.trim() : "";
  if (city && city.length <= 10) constraints.city = city;

  const budgetMin = Number(obj.budgetMin);
  const budgetMax = Number(obj.budgetMax);
  if (Number.isFinite(budgetMin) && budgetMin >= 0 && budgetMin <= 1000) constraints.budgetMin = budgetMin;
  if (Number.isFinite(budgetMax) && budgetMax >= 0 && budgetMax <= 1000) constraints.budgetMax = budgetMax;
  if (constraints.budgetMin != null && constraints.budgetMax != null && constraints.budgetMin > constraints.budgetMax) {
    delete constraints.budgetMin;
    delete constraints.budgetMax;
  }

  let budgetDelta: number | undefined;
  if (obj.budgetDelta != null) {
    const n = Number(obj.budgetDelta);
    if (Number.isFinite(n) && n !== 0 && Math.abs(n) <= 100) budgetDelta = n;
  }

  // 同一轮不能既给绝对预算又给相对增量，避免静默做出错误金额
  if (budgetDelta != null && (constraints.budgetMin != null || constraints.budgetMax != null)) {
    return null;
  }

  return { intent, constraints, budgetDelta, confidence };
}

const SYSTEM_PROMPT = `你是选车助手的意图抽取器。只输出 JSON，不要输出任何解释、不要输出 Markdown。

输出字段：
- intent：只能是 recommend | compare | price | reviews | research | book | smalltalk | clarify
- usage：用途数组，只能从 [家用, 通勤, 长途, 通过性, 省油, 空间] 中选
- energy：能源数组，只能从 [燃油, 混动, 纯电] 中选
- seats：整数 2~7
- bodyType：车身类型数组，只能从 [SUV, 轿车, MPV, 两厢车] 中选
- charging：布尔值（有固定充电条件为 true）
- city：城市名
- budgetMin / budgetMax：数字，单位万元
- budgetDelta：相对预算变化，单位万元；增加为正数，减少为负数
- confidence：0~1，表示你对整体判断的把握

抽取规则：
1. 只抽取文本中明确或强烈暗示的信息，不要编造。
2. "带娃 / 遛娃 / 孩子 / 宝宝 / 二胎 / 接娃" 暗示 usage 包含 家用、空间。
3. "跑长途 / 回老家 / 自驾" 暗示 usage 包含 长途。
4. "去比较远的地方 / 出远门" 暗示 usage 包含 长途；这里的"比较"是程度副词，不是对比车型。
5. 没提到的字段不要输出。
6. 完全无法判断意图时，intent 用 "clarify"。
7. 如果文本里给了"十几万""二十以内"这类模糊预算，给出你理解的区间并降低 confidence。
8. "再加两万"只输出 budgetDelta: 2，不要计算最终预算。
9. "便宜一万"只输出 budgetDelta: -1，不要计算最终预算。
10. 明确的新预算如"改成7万"用 budgetMin/budgetMax；同一轮不要同时输出绝对预算和 budgetDelta。
11. "先筛选，再对比，然后看口碑/算价格"这类多目标链式任务，intent 用 "research"。`;

function buildHumanMessage(
  text: string,
  current: { intent: string; constraints: Constraints; previousConstraints?: Constraints; contextSummary?: string }
): string {
  return [
    `用户输入：${text}`,
    `规则层已识别：${JSON.stringify({ intent: current.intent, constraints: current.constraints })}`,
    `上一轮已确认约束：${JSON.stringify(current.previousConstraints ?? {})}`,
    `历史对话摘要：${current.contextSummary || "无"}`,
    "请只补充规则层没识别到的信息，输出 JSON。",
  ].join("\n");
}

/**
 * 调模型做意图抽取。失败（无 Key / 超时 / 非 JSON / 校验不过）一律返回 null。
 */
export async function extractIntentWithModel(
  text: string,
  current: { intent: string; constraints: Constraints; previousConstraints?: Constraints; contextSummary?: string },
  timeoutMs = 4000
): Promise<ModelIntentResult | null> {
  if (!isIntentModelEnabled()) return null;

  try {
    const model = new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      temperature: 0,
      maxRetries: 0,
      timeout: timeoutMs,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
    } as any);

    const invokePromise = model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildHumanMessage(text, current)),
    ]);

    const result = await Promise.race([
      invokePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`intent model timeout ${timeoutMs}ms`)), timeoutMs + 500)
      ),
    ]);

    const content = typeof result.content === "string" ? result.content : "";
    if (!content) return null;

    const parsed = JSON.parse(stripCodeFence(content));
    return validateModelIntent(parsed);
  } catch (err) {
    console.warn("[intent] 模型补充失败，使用规则结果:", (err as Error).message);
    return null;
  }
}
