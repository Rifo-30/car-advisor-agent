import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAdvisorTurn } from "../src/agent/runner";

test("final stage 使用真实业务节点，routingStage 单独表示分类中", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousIntent = process.env.INTENT_MODEL_ENABLED;
  const previousTool = process.env.TOOL_AGENT_ENABLED;
  const previousRag = process.env.RAG_QUERY_REWRITE_ENABLED;
  process.env.OPENAI_API_KEY = "";
  process.env.INTENT_MODEL_ENABLED = "false";
  process.env.TOOL_AGENT_ENABLED = "false";
  process.env.RAG_QUERY_REWRITE_ENABLED = "false";

  try {
    const sessionId = `stage-${randomUUID()}`;
    const first = await runAdvisorTurn({ sessionId, message: "15万左右，家用，推荐什么车" });
    assert.equal(first.stage, "recommend");
    assert.equal(first.routingStage, "classifying");

    const reviews = await runAdvisorTurn({ sessionId, message: "这车口碑怎么样" });
    assert.equal(reviews.stage, "reviews");
    assert.equal(reviews.routingStage, "classifying");

    const smalltalk = await runAdvisorTurn({ sessionId: `stage-small-${randomUUID()}`, message: "你好" });
    assert.equal(smalltalk.stage, "smalltalk");

    const bookingSession = `stage-book-${randomUUID()}`;
    await runAdvisorTurn({ sessionId: bookingSession, message: "15万左右，家用，推荐什么车" });
    const booking = await runAdvisorTurn({ sessionId: bookingSession, message: "预约试驾" });
    assert.equal(booking.interrupted?.type, "confirm");
    assert.equal(booking.stage, "confirm");
    assert.equal(booking.routingStage, "classifying");
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previousKey],
      ["INTENT_MODEL_ENABLED", previousIntent],
      ["TOOL_AGENT_ENABLED", previousTool],
      ["RAG_QUERY_REWRITE_ENABLED", previousRag],
    ] as const) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
