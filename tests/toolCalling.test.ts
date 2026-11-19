import test from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import { createReadOnlyTools, runToolCallingLoop, type ToolAgentContext } from "../src/agent/toolAgent";

function context(): ToolAgentContext {
  return {
    query: "帮我找10万左右家用车，再对比前两款，然后看口碑",
    turnId: "turn-test",
    constraints: { budgetMin: 9, budgetMax: 11, usage: ["家用"] },
    candidates: [],
    targetModelIds: [],
  };
}

test("Tool Calling 只暴露只读工具，不暴露预约写操作", () => {
  const state = { turnId: "t", candidates: [], comparisonCandidates: [], comparison: null, citations: [], toolEvents: [], lastSummary: "" };
  const names = createReadOnlyTools(context(), state).map((item) => item.name);
  assert.deepEqual(names.sort(), ["compare_cars", "estimate_price", "get_car_detail", "search_cars", "search_reviews"].sort());
  assert.equal(names.includes("create_test_drive_lead"), false);
});

test("模型发起工具调用后，结果回填并继续生成最终回答", async () => {
  let turn = 0;
  const result = await runToolCallingLoop(context(), {
    invokeModel: async () => {
      turn += 1;
      if (turn === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ id: "call-search", name: "search_cars", args: { budgetMin: 9, budgetMax: 11, usage: ["家用"], limit: 2 }, type: "tool_call" }],
        });
      }
      return new AIMessage({ content: "已根据工具结果找到合适车型。" });
    },
    maxSteps: 4,
  });

  assert.equal(result.answer, "已根据工具结果找到合适车型。");
  assert.ok(result.candidates.length > 0);
  assert.equal(result.toolEvents[0]?.name, "search_cars");
  assert.equal(result.toolEvents[0]?.turnId, "turn-test");
  assert.equal(result.exhausted, false);
});

test("未知工具和重复调用会作为 Observation 返回，不抛异常", async () => {
  let turn = 0;
  const result = await runToolCallingLoop(context(), {
    invokeModel: async () => {
      turn += 1;
      if (turn === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ id: "call-bad", name: "delete_database", args: {}, type: "tool_call" }],
        });
      }
      return new AIMessage({ content: "工具不可用，我将基于现有信息回答。" });
    },
    maxSteps: 3,
  });

  assert.equal(result.exhausted, false);
  assert.equal(result.toolEvents[0]?.ok, false);
  assert.match(result.toolEvents[0]?.summary ?? "", /只读白名单/);
});

test("达到最大步数时停止循环并返回兜底结果", async () => {
  const result = await runToolCallingLoop(context(), {
    invokeModel: async () => new AIMessage({
      content: "",
      tool_calls: [{ id: "call-search", name: "search_cars", args: { budgetMin: 9, budgetMax: 11, usage: ["家用"] }, type: "tool_call" }],
    }),
    maxSteps: 2,
  });

  assert.equal(result.exhausted, true);
  assert.equal(result.steps, 2);
  assert.ok(result.toolEvents.length >= 1);
});
