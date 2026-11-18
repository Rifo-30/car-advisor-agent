import test from "node:test";
import assert from "node:assert/strict";
import { compressContext, estimateContextTokens } from "../src/agent/contextCompression";
import type { ChatMessage } from "../src/types";

function history(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: index % 2 === 0 ? `第${index}轮用户预算和车型需求` : `第${index}轮助手推荐结论`,
  }));
}

test("token 估算对中文和英文都能给出预算", () => {
  assert.ok(estimateContextTokens("预算十五万家用SUV") > 0);
  assert.ok(estimateContextTokens("budget and family SUV") > 0);
});

test("超过窗口后保留摘要和最近消息", async () => {
  const messages = history(12);
  const result = await compressContext(messages, { maxTokens: 2000, keepRecentMessages: 4, summaryMaxTokens: 200 });
  assert.equal(result.compressed, true);
  assert.equal(result.summarizedCount, 8);
  assert.equal(result.messages.at(-1)?.content, messages.at(-1)?.content);
  assert.match(result.messages[0]?.content ?? "", /历史摘要/);
  assert.ok(result.messages.length <= 5);
});

test("增量摘要不会每轮重复处理已经摘要的消息", async () => {
  const first = history(9);
  const firstResult = await compressContext(first, { keepRecentMessages: 4, summaryMaxTokens: 200 });
  const next = [...first, ...history(2).map((message, index) => ({
    ...message,
    content: `${message.content}-new-${index}`,
  }))];
  const second = await compressContext(
    next,
    { keepRecentMessages: 4, summaryMaxTokens: 200, summarizedCount: firstResult.summarizedCount },
    firstResult.summary
  );
  assert.equal(second.summarizedCount, next.length - 4);
  assert.ok(second.messages.at(-1)?.content.includes("new"));
});
