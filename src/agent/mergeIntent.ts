// ============================================================
// 规则结果 + 模型结果的合并策略
//
// 核心原则：规则优先，模型只补缺
// - intent：规则有明确值就用规则；规则 unknown 才用模型
// - constraints：同名常量 / 数组字段以规则为准，模型只补规则没有的字段
// - 冲突（两边都有值但不同）：以规则为准，同时记录冲突用于后续优化
// ============================================================
import type { Constraints } from "../types";
import type { ModelIntentResult } from "./intentModel";

export interface RuleIntent {
  intent: string;
  constraints: Constraints;
  /** 规则意图是否"证据不足"（弱匹配），为 true 时允许模型覆盖 intent */
  weakIntent?: boolean;
}

export interface MergeResult {
  intent: string;
  constraints: Constraints;
  /** 是否实际采纳了模型的某部分结果 */
  adopted: boolean;
  /** 规则与模型冲突的字段（已按"规则优先"处理） */
  conflicts: string[];
}

const SCALAR_KEYS: Array<keyof Constraints> = ["budgetMin", "budgetMax", "seats", "charging", "city"];
const ARRAY_KEYS: Array<keyof Constraints> = ["energy", "usage", "bodyType"];

export function mergeIntent(rule: RuleIntent, model: ModelIntentResult | null): MergeResult {
  const conflicts: string[] = [];

  if (!model) {
    return { intent: rule.intent, constraints: { ...rule.constraints }, adopted: false, conflicts };
  }

  // ---------- 1. intent ----------
  let intent = rule.intent;
  const ruleIntentWeak = rule.intent === "unknown" || Boolean(rule.weakIntent);

  if (ruleIntentWeak && model.intent !== "unknown") {
    // 规则意图不可靠（未知 / 弱匹配）→ 采用模型判断
    if (model.intent !== rule.intent) {
      conflicts.push(`intent: 弱匹配被模型覆盖 规则=${rule.intent} 模型=${model.intent}`);
    }
    intent = model.intent;
  } else if (model.intent !== rule.intent && model.intent !== "clarify") {
    // 规则意图明确 → 以规则为准，记录冲突
    conflicts.push(`intent: 规则=${rule.intent} 模型=${model.intent}`);
  }

  // ---------- 2. constraints：规则覆盖模型 ----------
  const constraints: Constraints = { ...model.constraints, ...rule.constraints };

  // ---------- 3. 冲突检测（规则优先，但记录下来） ----------
  for (const key of SCALAR_KEYS) {
    const r = rule.constraints[key];
    const m = model.constraints[key];
    if (r != null && m != null && r !== m) {
      conflicts.push(`${key}: 规则=${String(r)} 模型=${String(m)}`);
    }
  }
  for (const key of ARRAY_KEYS) {
    const r = rule.constraints[key] as string[] | undefined;
    const m = model.constraints[key] as string[] | undefined;
    if (r?.length && m?.length && JSON.stringify(r) !== JSON.stringify(m)) {
      conflicts.push(`${key}: 规则=${r.join("/")} 模型=${m.join("/")}`);
    }
  }

  // ---------- 4. 是否采纳了模型 ----------
  const intentChanged = intent !== rule.intent;
  const modelFilledSomething = Object.keys(model.constraints).some(
    (k) => (rule.constraints as Record<string, unknown>)[k] == null
  );
  const adopted = intentChanged || modelFilledSomething;

  return { intent, constraints, adopted, conflicts };
}
