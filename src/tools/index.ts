// ============================================================
// 工具层（Function Calling 的「真实实现」）
// 面试要点：LLM 只负责决定调用哪个工具，真正执行与鉴权在这里。
// ============================================================
import type { Candidate, CarModel, Comparison, EnergyType, Review } from "../types";
import { getAllCars } from "../db/repo";
import { insertLead } from "../db/repo";
import { retrieveReviews } from "../rag/retriever";
import { cacheGet, cacheSet } from "../cache/redis";
import { hashPhone, isValidPhone, maskPhone } from "../guardrails/guard";

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  summary: string;
  error?: string;
}

export interface SearchArgs {
  budgetMin?: number;
  budgetMax?: number;
  energy?: EnergyType[];
  seats?: number;
  bodyType?: string[];
  usage?: string[];
  charging?: boolean;
  limit?: number;
}

function pickVariant(car: CarModel, min: number, max: number) {
  const inRange = car.variants
    .filter((v) => v.guidePrice >= min && v.guidePrice <= max)
    .sort((a, b) => a.guidePrice - b.guidePrice);
  return inRange[0] ?? car.variants.slice().sort((a, b) => a.guidePrice - b.guidePrice)[0];
}

function buildWhy(car: CarModel, variant: ReturnType<typeof pickVariant>, usage: string[] | undefined): string[] {
  const why: string[] = [`预算内：${variant.name} ${variant.guidePrice.toFixed(2)} 万`];
  if (usage?.length) {
    const hit = car.tags.filter((t) => usage.some((u) => t.includes(u) || u.includes(t)));
    if (hit.length) why.push(`匹配需求：${hit.join("、")}`);
  }
  if (car.energyType === "纯电") why.push(`纯电续航 ${variant.rangeKm ?? "-"}km`);
  if (car.energyType === "混动") why.push(`可油可电，纯电续航 ${variant.rangeKm ?? "-"}km`);
  if (variant.wheelbaseMm >= 2800) why.push(`空间宽裕：轴距 ${variant.wheelbaseMm}mm`);
  if (variant.fuelConsumption && variant.fuelConsumption <= 6) why.push(`油耗较低：${variant.fuelConsumption}L/100km`);
  return why.slice(0, 4);
}

function buildTradeoffs(car: CarModel, variant: ReturnType<typeof pickVariant>): string[] {
  const t: string[] = [];
  if (variant.fuelConsumption && variant.fuelConsumption >= 8) t.push(`油耗偏高（${variant.fuelConsumption}L/100km）`);
  if (car.energyType === "纯电" && (variant.rangeKm ?? 0) < 450) t.push("续航偏短，长途需规划充电");
  if (car.energyType === "纯电") t.push("依赖充电条件");
  if (variant.powerKw < 120) t.push("动力偏弱，满载或超车需预留");
  if (car.seats >= 7) t.push("车身较大，市区停车不便");
  if (!t.length) t.push("暂无明显短板，建议试驾确认");
  return t.slice(0, 3);
}

export async function searchCars(args: SearchArgs): Promise<ToolResult<Candidate[]>> {
  const cacheKey = `tool:search_cars:${JSON.stringify(args)}`;
  const cached = await cacheGet<Candidate[]>(cacheKey);
  if (cached) return { ok: true, data: cached, summary: `命中 ${cached.length} 款（缓存）` };

  const cars = await getAllCars();
  const min = args.budgetMin ?? 0;
  const max = args.budgetMax ?? Number.MAX_SAFE_INTEGER;
  const usage = args.usage ?? [];

  const candidates: Candidate[] = [];
  for (const car of cars) {
    if (args.energy?.length && !args.energy.includes(car.energyType)) continue;
    if (args.seats && car.seats < args.seats) continue;
    if (args.bodyType?.length && !args.bodyType.includes(car.bodyType)) continue;

    // 预算是一个区间：低于下限太多的车（如 15 万预算推荐 7 万微型车）也要排除
    const inRange = car.variants
      .filter((v) => v.guidePrice >= min * 0.92 && v.guidePrice <= max * 1.02)
      .sort((a, b) => b.guidePrice - a.guidePrice); // 优先更贴近预算的高配
    if (!inRange.length) continue;
    const variant = inRange[0];

    candidates.push({
      modelId: car.id,
      brand: car.brand,
      series: car.series,
      level: car.level,
      energyType: car.energyType,
      seats: car.seats,
      price: variant.guidePrice,
      variantId: variant.id,
      variantName: variant.name,
      why: buildWhy(car, variant, usage),
      tradeoffs: buildTradeoffs(car, variant),
      tags: car.tags,
    });
  }

  const mid = (min + max) / 2;
  const span = Math.max(1, max - min);
  const score = (c: Candidate) => {
    const tagMatch = c.tags.filter((t) => usage.some((u) => t.includes(u) || u.includes(t))).length;
    const priceFit = 1 - Math.abs(c.price - mid) / span;
    const chargingFit = args.charging && (c.energyType === "纯电" || c.energyType === "混动") ? 0.5 : 0;
    return tagMatch * 2 + priceFit + chargingFit;
  };
  candidates.sort((a, b) => score(b) - score(a));

  const top = candidates.slice(0, args.limit ?? 3);
  await cacheSet(cacheKey, top, 120);
  return { ok: true, data: top, summary: `命中 ${top.length} 款（候选共 ${candidates.length} 款）` };
}

export async function getCarDetail(modelId: string): Promise<ToolResult<CarModel | undefined>> {
  const cars = await getAllCars();
  const car = cars.find((c) => c.id === modelId);
  if (!car) return { ok: false, summary: "未找到该车型", error: "NOT_FOUND" };
  return { ok: true, data: car, summary: `已获取 ${car.brand} ${car.series}` };
}

export async function compareCars(modelIds: string[]): Promise<ToolResult<Comparison>> {
  const cars = await getAllCars();
  const picked = modelIds
    .map((id) => cars.find((c) => c.id === id))
    .filter((c): c is CarModel => Boolean(c));

  if (picked.length < 2) {
    return { ok: false, summary: "至少需要两款车型才能对比", error: "NEED_TWO_CARS" };
  }

  const columns = picked.map((c) => ({ modelId: c.id, title: `${c.brand} ${c.series}` }));
  const rows = [
    { label: "指导价（万）", values: picked.map((c) => `${Math.min(...c.variants.map((v) => v.guidePrice)).toFixed(2)} 起`) },
    { label: "能源类型", values: picked.map((c) => c.energyType) },
    { label: "座位数", values: picked.map((c) => `${c.seats} 座`) },
    { label: "车身类型", values: picked.map((c) => c.bodyType) },
    { label: "纯电续航", values: picked.map((c) => (c.energyType === "纯电" || c.energyType === "混动") ? `${c.variants[0].rangeKm ?? "-"} km` : "—") },
    { label: "最大功率", values: picked.map((c) => `${Math.max(...c.variants.map((v) => v.powerKw))} kW`) },
    { label: "车长", values: picked.map((c) => `${c.variants[0].lengthMm} mm`) },
    { label: "轴距", values: picked.map((c) => `${c.variants[0].wheelbaseMm} mm`) },
    { label: "油耗", values: picked.map((c) => c.variants[0].fuelConsumption ? `${c.variants[0].fuelConsumption} L/100km` : "—") },
  ];

  return { ok: true, data: { columns, rows }, summary: `已生成 ${picked.length} 款车型对比` };
}

export async function estimatePrice(modelId: string, variantId?: string, city = "北京"): Promise<ToolResult<any>> {
  const cars = await getAllCars();
  const car = cars.find((c) => c.id === modelId);
  if (!car) return { ok: false, summary: "未找到该车型", error: "NOT_FOUND" };

  const variant = car.variants.find((v) => v.id === variantId) ?? car.variants[0];
  const guide = variant.guidePrice;
  // 购置税：纯电按现行减免政策示例为 0；燃油/混动按 10% 估算（演示口径）
  const purchaseTax = car.energyType === "纯电" ? 0 : (guide / 1.13) * 0.1;
  const insurance = Math.max(0.45, guide * 0.035);
  const plate = 0.05;
  const total = guide + purchaseTax + insurance + plate;

  return {
    ok: true,
    summary: `${car.brand} ${car.series} ${variant.name} 落地约 ${total.toFixed(2)} 万`,
    data: {
      car: `${car.brand} ${car.series}`,
      variant: variant.name,
      city,
      guidePrice: guide.toFixed(2),
      purchaseTax: purchaseTax.toFixed(2),
      insurance: insurance.toFixed(2),
      plate: plate.toFixed(2),
      total: total.toFixed(2),
    },
  };
}

export async function searchReviews(modelId: string, topic: string): Promise<ToolResult<Review[]>> {
  const reviews = await retrieveReviews(modelId, topic, 3);
  return { ok: true, data: reviews, summary: `检索到 ${reviews.length} 条评测/口碑` };
}

export async function createTestDriveLead(args: {
  sessionId: string;
  userId?: string;
  modelId: string;
  city: string;
  phone: string;
  confirmed: boolean;
}): Promise<ToolResult<{ maskedPhone: string; duplicated?: boolean }>> {
  // 关键：服务端强制校验 confirmed，绝不信任模型/前端的"已确认"
  if (!args.confirmed) {
    return { ok: false, summary: "未确认，不能提交预约", error: "NOT_CONFIRMED" };
  }
  if (!isValidPhone(args.phone)) {
    return { ok: false, summary: "手机号格式不正确", error: "INVALID_PHONE" };
  }

  const phoneEnc = hashPhone(args.phone);
  // ⭐ 幂等键：同一会话 + 同一车型 + 同一手机号，重复提交只落一条
  const idempotencyKey = hashPhone(`${args.sessionId}:${args.modelId}:${phoneEnc}`);

  const { inserted, error } = await insertLead({
    sessionId: args.sessionId,
    userId: args.userId ?? "anonymous",
    modelId: args.modelId,
    city: args.city,
    phoneEnc,
    idempotencyKey,
  });

  if (error) {
    return { ok: false, summary: `预约提交失败：${error}`, error: "INSERT_FAILED" };
  }

  return {
    ok: true,
    summary: inserted
      ? `已提交 ${args.city} 试驾预约，预计 2 小时内经销商联系`
      : `该预约已提交过，无需重复提交（${args.city}）`,
    data: { maskedPhone: maskPhone(args.phone), duplicated: !inserted },
  };
}

/** 工具 schema 清单（供 LLM tool calling / 文档展示） */
export const TOOL_SCHEMAS = [
  { name: "search_cars", description: "按预算、能源类型、座位数、用途筛选候选车型", parameters: { type: "object", properties: { budgetMin: { type: "number" }, budgetMax: { type: "number" }, energy: { type: "array", items: { type: "string" } }, seats: { type: "number" }, usage: { type: "array", items: { type: "string" } } } } },
  { name: "get_car_detail", description: "查询单个车型的详细参数与配置", parameters: { type: "object", properties: { modelId: { type: "string" } }, required: ["modelId"] } },
  { name: "compare_cars", description: "对比 2~4 款车型的核心参数", parameters: { type: "object", properties: { modelIds: { type: "array", items: { type: "string" } } }, required: ["modelIds"] } },
  { name: "estimate_price", description: "估算落地价（裸车 + 购置税 + 保险 + 上牌）", parameters: { type: "object", properties: { modelId: { type: "string" }, variantId: { type: "string" }, city: { type: "string" } }, required: ["modelId"] } },
  { name: "search_reviews", description: "检索车型的评测与车主口碑", parameters: { type: "object", properties: { modelId: { type: "string" }, topic: { type: "string" } }, required: ["modelId", "topic"] } },
  { name: "create_test_drive_lead", description: "提交试驾预约（必须用户已确认）", parameters: { type: "object", properties: { modelId: { type: "string" }, city: { type: "string" }, phone: { type: "string" }, confirmed: { type: "boolean" } }, required: ["modelId", "city", "phone", "confirmed"] } },
];
