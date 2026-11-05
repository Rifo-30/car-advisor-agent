import test from "node:test";
import assert from "node:assert/strict";
import { parseConfirmDecision } from "../src/agent/confirm";

const cases: Array<[string, string]> = [
  ["确认", "confirm"], ["好的", "confirm"], ["可以", "confirm"], ["OK", "confirm"], ["嗯", "confirm"], ["行", "confirm"], ["没问题", "confirm"],
  ["不好", "cancel"], ["不行", "cancel"], ["取消", "cancel"], ["确认取消", "cancel"], ["算了", "cancel"], ["不要了", "cancel"], ["先不预约", "cancel"],
  ["不确定", "ambiguous"], ["", "ambiguous"], ["随便", "ambiguous"], ["再看看", "ambiguous"], ["我想想", "ambiguous"],
];

for (const [input, expected] of cases) {
  test(`parseConfirmDecision(${JSON.stringify(input)}) === ${expected}`, () => {
    assert.equal(parseConfirmDecision(input), expected);
  });
}
