import test from "node:test";
import assert from "node:assert/strict";
import { validateJudgeResult } from "../src/eval/judge";

test("LLM judge 结果只接受合法分数和理由", () => {
  assert.deepEqual(validateJudgeResult({ score: 4, reason: "回答相关且完整" }), {
    score: 4,
    pass: true,
    reason: "回答相关且完整",
  });
  assert.equal(validateJudgeResult({ score: 3, reason: "信息不足" })?.pass, false);
  assert.equal(validateJudgeResult({ score: 6, reason: "越界" }), null);
  assert.equal(validateJudgeResult({ score: 4 }), null);
});
