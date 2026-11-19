import test from "node:test";
import assert from "node:assert/strict";
import { isMultiStepResearch, parseMessage } from "../src/agent/intent";
import { CARS } from "../src/data/cars";
import type { Candidate } from "../src/types";

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

test("省略推荐动词的能源追问应按推荐处理", () => {
  const candidates = [{ modelId: "a" }, { modelId: "b" }] as unknown as Candidate[];
  const r = parseMessage("油车呢", candidates, CARS);
  assert.equal(r.intent, "recommend");
  assert.deepEqual(r.constraints.energy, ["燃油"]);
});

test("排除式能源表达应转换成允许集合", () => {
  assert.deepEqual(parseMessage("不要电车", [], CARS).constraints.energy, ["燃油", "混动"]);
  assert.deepEqual(parseMessage("不看油车", [], CARS).constraints.energy, ["混动", "纯电"]);
});

test("解析相对预算增量且不误当绝对预算", () => {
  const add = parseMessage("再加两万呢", [], CARS);
  assert.equal(add.intent, "recommend");
  assert.equal(add.budgetDelta, 2);
  assert.equal(add.constraints.budgetMin, undefined);

  const decrease = parseMessage("便宜一万", [], CARS);
  assert.equal(decrease.budgetDelta, -1);

  const arabic = parseMessage("预算提高2.5万", [], CARS);
  assert.equal(arabic.budgetDelta, 2.5);
  assert.equal(arabic.constraints.budgetMin, undefined);

  assert.equal(parseMessage("再加点", [], CARS).budgetDelta, undefined);
});

test("候选上下文中的口碑属性问题应识别为 reviews", () => {
  const candidates = [{ modelId: "yt-x1" }] as unknown as Candidate[];
  assert.equal(parseMessage("这车高速噪音大吗", candidates, CARS).intent, "reviews");
  assert.equal(parseMessage("它空间怎么样", candidates, CARS).intent, "reviews");
});

test("明确的多步任务才识别为 research", () => {
  assert.equal(isMultiStepResearch("帮我找15万家用SUV，再对比前两款，然后看口碑"), true);
  assert.equal(isMultiStepResearch("帮我找几款车并且进行对比和预约试驾"), true);
  assert.equal(isMultiStepResearch("对比前两款"), false);
  assert.equal(isMultiStepResearch("15万左右，家用，推荐什么车"), false);
});

test("带娃长途的混合任务解析为 research，并保留用途约束", () => {
  const r = parseMessage("我需要带娃出行，偶尔需要跑长途，帮我找几款车型并且进行对比和预约试驾", [], CARS);
  assert.equal(r.intent, "research");
  assert.deepEqual(r.constraints.usage, ["家用", "空间", "长途"]);
});
