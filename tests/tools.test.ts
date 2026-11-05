import test from "node:test";
import assert from "node:assert/strict";
import { searchCars, createTestDriveLead } from "../src/tools/index";

test("推荐结果必须落在预算区间内", async () => {
  const r = await searchCars({ budgetMin: 13.5, budgetMax: 16.5, usage: ["家用"], limit: 5 });
  assert.equal(r.ok, true);
  for (const c of r.data ?? []) {
    assert.ok(c.price >= 13.5 * 0.92, `${c.series} 低于预算下限: ${c.price}`);
    assert.ok(c.price <= 16.5 * 1.02, `${c.series} 超出预算上限: ${c.price}`);
  }
});

test("未确认不能创建线索", async () => {
  const r = await createTestDriveLead({
    sessionId: "t1", modelId: "yt-x3", city: "北京", phone: "13800138000", confirmed: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "NOT_CONFIRMED");
});

test("手机号格式错误被拒绝", async () => {
  const r = await createTestDriveLead({
    sessionId: "t1", modelId: "yt-x3", city: "北京", phone: "123", confirmed: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "INVALID_PHONE");
});
