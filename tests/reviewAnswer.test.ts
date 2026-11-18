import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewFocus } from "../src/agent/reviewAnswer";
import { REVIEWS } from "../src/data/reviews";

test("口碑回答会先给出问题对应的直接结论和证据", () => {
  const reviews = REVIEWS.filter((item) => item.modelId === "yt-x3");
  const answer = buildReviewFocus("这车高速噪音大吗", reviews);
  assert.match(answer, /直接结论/);
  assert.match(answer, /隔音|噪音|风噪/);
});

test("没有对应证据时不编造，明确说明召回未覆盖", () => {
  const answer = buildReviewFocus("这车智能驾驶能力怎么样", []);
  assert.match(answer, /没有直接覆盖/);
});
