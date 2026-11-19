import test from "node:test";
import assert from "node:assert/strict";
import { routeExecutionMode } from "../src/agent/executionRouter";

const base = { constraints: {}, candidates: [] };

test("规则明确的单步请求不调用执行路由模型", async () => {
  let called = false;
  const r = await routeExecutionMode(
    { ...base, text: "15万左右，家用，推荐什么车", intent: "recommend" },
    { enabled: true, invokeModel: async () => { called = true; return "{}"; } }
  );
  assert.equal(r.mode, "direct");
  assert.equal(called, false);
});

test("明确多步任务走 tool_loop", async () => {
  const r = await routeExecutionMode({
    ...base,
    text: "先找15万家用SUV，再对比前两款，然后看口碑",
    intent: "research",
  });
  assert.equal(r.mode, "tool_loop");
  assert.equal(r.source, "rule");
});

test("模糊请求可以由 LLM Router 提升为 tool_loop", async () => {
  const r = await routeExecutionMode(
    { ...base, text: "帮我认真研究一下这几款车怎么选", intent: "recommend", candidates: [{ modelId: "yt-x3", brand: "云途", series: "X3" } as any] },
    { enabled: true, invokeModel: async () => JSON.stringify({ mode: "tool_loop", confidence: 0.92, reason: "需要多步比较" }) }
  );
  assert.equal(r.mode, "tool_loop");
  assert.equal(r.source, "model");
});

test("高风险写操作即使模型要求 tool_loop 也强制 direct", async () => {
  const r = await routeExecutionMode(
    { ...base, text: "帮我预约试驾", intent: "book" },
    { enabled: true, invokeModel: async () => JSON.stringify({ mode: "tool_loop", confidence: 0.99, reason: "错误路由" }) }
  );
  assert.equal(r.mode, "direct");
});

test("研究加预约的混合请求先走只读 tool_loop，而不是直接预约", async () => {
  const r = await routeExecutionMode({
    ...base,
    text: "帮我找几款车并且进行对比和预约试驾",
    intent: "research",
  });
  assert.equal(r.mode, "tool_loop");
  assert.equal(r.source, "rule");
});

test("低置信度或非法模型输出回退规则", async () => {
  const low = await routeExecutionMode(
    { ...base, text: "帮我认真研究一下", intent: "recommend" },
    { enabled: true, invokeModel: async () => JSON.stringify({ mode: "tool_loop", confidence: 0.3, reason: "不确定" }) }
  );
  assert.equal(low.mode, "direct");
  assert.equal(low.source, "fallback");
});
