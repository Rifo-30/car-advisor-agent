import test from "node:test";
import assert from "node:assert/strict";
import { applyBudgetDelta, resolveTurnContext } from "../src/agent/context";
import { CARS } from "../src/data/cars";
import type { Candidate } from "../src/types";

const candidates = [
  { modelId: "yt-x1" },
  { modelId: "xh-m1" },
  { modelId: "xh-a5" },
] as unknown as Candidate[];

test("这车/它 指代当前第一个候选车型", () => {
  const r = resolveTurnContext({
    intent: "reviews",
    text: "这车高速噪音大吗",
    candidates,
    cars: CARS,
    explicitModelIds: [],
  });
  assert.equal(r.targetModelId, "yt-x1");
  assert.deepEqual(r.targetModelIds, ["yt-x1"]);
});

test("这两款只解析前两个候选，不会带上第三款", () => {
  const r = resolveTurnContext({
    intent: "compare",
    text: "对比这两款",
    candidates,
    cars: CARS,
    explicitModelIds: [],
  });
  assert.deepEqual(r.targetModelIds, ["yt-x1", "xh-m1"]);
});

test("明确车型和序数引用优先于默认候选", () => {
  const explicit = resolveTurnContext({
    intent: "reviews",
    text: "启航 A5 口碑怎么样",
    candidates,
    cars: CARS,
    explicitModelIds: ["xh-a5"],
  });
  assert.equal(explicit.targetModelId, "xh-a5");

  const ordinal = resolveTurnContext({
    intent: "quote",
    text: "第二款落地多少",
    candidates,
    cars: CARS,
    explicitModelIds: [],
    ordinal: [1],
  });
  assert.equal(ordinal.targetModelId, "xh-m1");
});

test("相对预算基于当前完整区间计算", () => {
  const r = applyBudgetDelta({ budgetMin: 4.5, budgetMax: 5.5, energy: ["燃油"] }, 2);
  assert.equal(r.applied, true);
  assert.equal(r.constraints.budgetMin, 6.5);
  assert.equal(r.constraints.budgetMax, 7.5);
  assert.deepEqual(r.constraints.energy, ["燃油"]);
});

test("没有基础预算或结果越界时不应用增量", () => {
  assert.equal(applyBudgetDelta({}, 2).reason, "MISSING_BASE");
  assert.equal(applyBudgetDelta({ budgetMin: 1, budgetMax: 2 }, -5).reason, "INVALID_RESULT");
});
