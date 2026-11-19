import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAdvisorTurn } from "../src/agent/runner";

test("带娃研究加预约不会直接拿旧候选进入预约", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousIntent = process.env.INTENT_MODEL_ENABLED;
  const previousTool = process.env.TOOL_AGENT_ENABLED;
  process.env.OPENAI_API_KEY = "";
  process.env.INTENT_MODEL_ENABLED = "false";
  process.env.TOOL_AGENT_ENABLED = "false";

  try {
    const sessionId = `dialogue-${randomUUID()}`;
    const first = await runAdvisorTurn({
      sessionId,
      message: "20万以内 SUV，经常跑长途",
    });
    assert.ok(first.candidates.length > 0);
    assert.ok(first.candidates.every((car) => car.price <= 20));

    const second = await runAdvisorTurn({
      sessionId,
      message: "我需要带娃出行，偶尔需要跑长途，帮我找几款车型并且进行对比和预约试驾",
    });
    assert.equal(second.intent, "research");
    assert.equal(second.executionMode, "tool_loop");
    assert.equal(second.interrupted, undefined);
    assert.ok(second.comparison);
    assert.ok(second.toolEvents.some((event) => event.name === "search_cars"));
    assert.ok(second.toolEvents.some((event) => event.name === "compare_cars"));
    assert.doesNotMatch(second.answer, /已预约成功/);
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousIntent == null) delete process.env.INTENT_MODEL_ENABLED;
    else process.env.INTENT_MODEL_ENABLED = previousIntent;
    if (previousTool == null) delete process.env.TOOL_AGENT_ENABLED;
    else process.env.TOOL_AGENT_ENABLED = previousTool;
  }
});
