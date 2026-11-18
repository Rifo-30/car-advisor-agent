import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewQuery } from "../src/rag/queryRewrite";
import { CARS } from "../src/data/cars";

test("口碑 query 会补全车型、指代和属性词", () => {
  const query = buildReviewQuery({
    question: "这车高速噪音大吗",
    car: CARS.find((car) => car.id === "yt-x1"),
    previousUserMessages: ["10万左右，家用，推荐什么车"],
  });
  assert.ok(query.includes("云途 远山 X1"));
  assert.ok(query.includes("高速"));
  assert.ok(query.includes("噪音"));
  assert.ok(query.includes("车主口碑"));
});

test("口碑 query 只使用当前车型内容，长度受控", () => {
  const query = buildReviewQuery({
    question: "空间怎么样",
    car: CARS.find((car) => car.id === "yt-x5"),
  });
  assert.ok(query.includes("云途 远山 X5"));
  assert.ok(query.length <= 220);
});
