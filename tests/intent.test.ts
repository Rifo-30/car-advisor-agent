import test from "node:test";
import assert from "node:assert/strict";
import { parseMessage } from "../src/agent/intent";
import { CARS } from "../src/data/cars";

test("解析预算区间", () => {
  const r = parseMessage("15万左右，家用，有充电桩", [], CARS);
  assert.equal(r.constraints.budgetMin, 13.5);
  assert.equal(r.constraints.budgetMax, 16.5);
  assert.deepEqual(r.constraints.usage, ["家用"]);
  assert.equal(r.constraints.charging, true);
});

test("解析能源与车身类型", () => {
  const r = parseMessage("纯电，20万SUV", [], CARS);
  assert.deepEqual(r.constraints.energy, ["纯电"]);
  assert.deepEqual(r.constraints.bodyType, ["SUV"]);
});

test("解析多个序数引用", () => {
  const candidates = [
    { modelId: "a" }, { modelId: "b" }, { modelId: "c" },
  ] as any;
  const r = parseMessage("对比第一款和第三款", candidates, CARS);
  assert.deepEqual(r.ordinal, [0, 2]);
});

test("自我介绍意图不会被当成选车", () => {
  assert.equal(parseMessage("你是谁", [], CARS).intent, "smalltalk");
});
