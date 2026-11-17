import test from "node:test";
import assert from "node:assert/strict";
import { mergeIntent } from "../src/agent/mergeIntent";
import { validateModelIntent } from "../src/agent/intentModel";
import { parseMessage, needsModelFallback } from "../src/agent/intent";
import { CARS } from "../src/data/cars";

// ---------------- mergeIntent ----------------

test("规则 unknown 时采纳模型意图", () => {
  const r = mergeIntent(
    { intent: "unknown", constraints: {} },
    { intent: "recommend", constraints: { usage: ["家用"] }, confidence: 0.9 }
  );
  assert.equal(r.intent, "recommend");
  assert.deepEqual(r.constraints.usage, ["家用"]);
  assert.equal(r.adopted, true);
});

test("规则有意图时以规则为准，并记录冲突", () => {
  const r = mergeIntent(
    { intent: "price", constraints: {} },
    { intent: "compare", constraints: {}, confidence: 0.9 }
  );
  assert.equal(r.intent, "price");
  assert.ok(r.conflicts.some((c) => c.startsWith("intent:")));
});

test("模型只补缺，不覆盖规则已解析的约束", () => {
  const r = mergeIntent(
    { intent: "recommend", constraints: { budgetMin: 13.5, budgetMax: 16.5 } },
    { intent: "recommend", constraints: { budgetMin: 18, budgetMax: 22, usage: ["家用"] }, confidence: 0.9 }
  );
  assert.equal(r.constraints.budgetMin, 13.5);
  assert.equal(r.constraints.budgetMax, 16.5);
  assert.deepEqual(r.constraints.usage, ["家用"]);
  assert.ok(r.conflicts.some((c) => c.startsWith("budgetMin:")));
});

test("模型为空时原样返回规则结果", () => {
  const r = mergeIntent({ intent: "recommend", constraints: { usage: ["通勤"] } }, null);
  assert.equal(r.intent, "recommend");
  assert.deepEqual(r.constraints.usage, ["通勤"]);
  assert.equal(r.adopted, false);
  assert.equal(r.conflicts.length, 0);
});

// ---------------- validateModelIntent ----------------

test("validateModelIntent 拒绝非法 intent", () => {
  assert.equal(validateModelIntent({ intent: "hack", confidence: 0.9 }), null);
});

test("validateModelIntent 拒绝低置信度", () => {
  assert.equal(validateModelIntent({ intent: "recommend", confidence: 0.3 }), null);
});

test("validateModelIntent 过滤非法枚举，保留合法字段", () => {
  const r = validateModelIntent({
    intent: "recommend",
    confidence: 0.9,
    energy: ["纯电", "柴油"],
    usage: ["家用", "听不懂"],
    seats: 5,
  });
  assert.deepEqual(r?.constraints.energy, ["纯电"]);
  assert.deepEqual(r?.constraints.usage, ["家用"]);
  assert.equal(r?.constraints.seats, 5);
});

test("validateModelIntent 丢弃反向预算区间", () => {
  const r = validateModelIntent({ intent: "recommend", confidence: 0.9, budgetMin: 30, budgetMax: 10 });
  assert.equal(r?.constraints.budgetMin, undefined);
  assert.equal(r?.constraints.budgetMax, undefined);
});

// ---------------- needsModelFallback ----------------

test("带娃这类口语化表达应触发模型补充", () => {
  const parsed = parseMessage("带娃推荐什么车", [], CARS);
  assert.equal(parsed.intent, "recommend");
  assert.equal(needsModelFallback(parsed), true);   // 规则没识别出 usage
});

test("规则已识别上下文时不触发模型", () => {
  const parsed = parseMessage("15万左右，家用，有充电桩", [], CARS);
  assert.equal(needsModelFallback(parsed), false);
});

test("闲聊不触发模型", () => {
  const parsed = parseMessage("你好", [], CARS);
  assert.equal(needsModelFallback(parsed), false);
});
