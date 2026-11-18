// ============================================================
// 全局上下文解析：把多轮指代转换成节点可直接使用的结构化目标
// ============================================================
import type { Candidate, CarModel, Constraints } from "../types";

export interface ResolveTurnContextInput {
  intent: string;
  text: string;
  candidates: Candidate[];
  cars: CarModel[];
  explicitModelIds: string[];
  ordinal?: number[];
}

export interface ResolvedTurnContext {
  targetModelId?: string;
  targetModelIds: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function ordinalModelIds(candidates: Candidate[], ordinal?: number[]): string[] {
  return unique((ordinal ?? []).map((i) => candidates[i]?.modelId ?? ""));
}

export function resolveTurnContext(input: ResolveTurnContextInput): ResolvedTurnContext {
  const { intent, text, candidates, cars, explicitModelIds, ordinal } = input;
  const explicit = unique(explicitModelIds.filter((id) => cars.some((c) => c.id === id)));
  const ordinalIds = ordinalModelIds(candidates, ordinal);
  const firstCandidate = candidates[0]?.modelId;

  const pairRef = /这两|这俩|这两款|这两台|前两款|前2款|二者|两者/.test(text);
  const allRef = /这三款|三款都|全部对比|全都对比/.test(text);
  const singleRef = /这车|这款|这辆|这台|那车|那款|那辆|那台|它|该车/.test(text);

  let targetModelIds: string[] = [];
  if (intent === "compare") {
    if (pairRef && candidates.length >= 2) targetModelIds = candidates.slice(0, 2).map((c) => c.modelId);
    else if (allRef && candidates.length > 0) targetModelIds = candidates.slice(0, 3).map((c) => c.modelId);
    else if (ordinalIds.length >= 2) targetModelIds = ordinalIds;
    else if (explicit.length >= 2) targetModelIds = explicit;
    else if (candidates.length >= 2) targetModelIds = candidates.slice(0, 3).map((c) => c.modelId);
  } else if (ordinalIds.length) {
    targetModelIds = ordinalIds;
  } else if (explicit.length) {
    targetModelIds = explicit;
  } else if (singleRef || candidates.length) {
    targetModelIds = firstCandidate ? [firstCandidate] : [];
  }

  const targetModelId = ordinalIds[0] ?? explicit[0] ?? (singleRef || intent !== "compare" ? firstCandidate : undefined);
  return { targetModelId, targetModelIds: unique(targetModelIds) };
}

export interface BudgetApplyResult {
  constraints: Constraints;
  applied: boolean;
  reason?: "NO_DELTA" | "MISSING_BASE" | "INVALID_RESULT";
}

/** 将相对预算增量应用到当前完整预算区间，金额计算只在这里发生 */
export function applyBudgetDelta(current: Constraints, delta?: number): BudgetApplyResult {
  if (delta == null) return { constraints: { ...current }, applied: false, reason: "NO_DELTA" };
  if (!Number.isFinite(delta) || delta === 0) {
    return { constraints: { ...current }, applied: false, reason: "INVALID_RESULT" };
  }
  if (current.budgetMin == null || current.budgetMax == null) {
    return { constraints: { ...current }, applied: false, reason: "MISSING_BASE" };
  }

  const budgetMin = Math.round((current.budgetMin + delta) * 10) / 10;
  const budgetMax = Math.round((current.budgetMax + delta) * 10) / 10;
  if (budgetMin < 0 || budgetMax < budgetMin || budgetMax > 1000) {
    return { constraints: { ...current }, applied: false, reason: "INVALID_RESULT" };
  }

  return {
    constraints: { ...current, budgetMin, budgetMax },
    applied: true,
  };
}
