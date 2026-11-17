import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getNodeProgress, runAdvisorTurn, type TurnProgressEvent } from "../src/agent/runner";

test("关键节点有明确的进度文案", () => {
  assert.deepEqual(getNodeProgress("retrieve"), {
    stage: "filtering",
    label: "正在筛选车型…",
  });
  assert.equal(getNodeProgress("unknown-node"), null);
});

test("执行推荐时按顺序发出 stage 和 tool 进度", async () => {
  const events: TurnProgressEvent[] = [];
  const result = await runAdvisorTurn(
    { sessionId: `progress-${randomUUID()}`, message: "10万左右，家用，推荐什么车" },
    (event) => events.push(event)
  );

  const filteringIndex = events.findIndex(
    (event) => event.event === "stage" && event.stage === "filtering"
  );
  const searchToolIndex = events.findIndex(
    (event) => event.event === "tool" && event.tool.name === "search_cars"
  );

  assert.equal(result.stage, "recommend");
  assert.ok(filteringIndex >= 0, "应发出正在筛选车型的 stage 事件");
  assert.ok(searchToolIndex > filteringIndex, "筛选工具结果应在筛选开始后发出");
});
