import test from "node:test";
import assert from "node:assert/strict";
import { finishTrace, getTrace, startTrace } from "../src/observability/trace";

test("trace 结束后的润色指标不会覆盖路由和意图字段", async () => {
  const trace = startTrace("agent.turn", "trace-test");
  trace.addSpan("node:classify", { message: "test" }, { intent: "recommend" }, 2);
  trace.end({
    intent: "recommend",
    executionMode: "direct",
    executionRouteSource: "rule",
    contextEstimatedTokens: 20,
  });
  finishTrace(trace.id, { llmMs: 30, fallback: false });

  const saved = await getTrace(trace.id);
  assert.deepEqual(saved?.output, {
    intent: "recommend",
    executionMode: "direct",
    executionRouteSource: "rule",
    contextEstimatedTokens: 20,
    llmMs: 30,
    fallback: false,
  });
  assert.ok(saved?.spans.some((span) => span.name === "node:classify"));
});
