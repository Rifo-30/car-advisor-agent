// ============================================================
// 意图与约束解析（规则层）
// 面试要点：LLM 负责「理解与表达」，但硬约束（预算/能源/座位）
// 用规则解析更稳定、可测试、可解释，避免模型把 15 万说成 20 万。
// ============================================================
import { CARS } from "../data/cars";
import type { Candidate, Constraints, EnergyType } from "../types";

export type Intent =
  | "recommend"
  | "compare"
  | "price"
  | "reviews"
  | "book"
  | "confirm"
  | "unknown";

export interface ParsedMessage {
  intent: Intent;
  constraints: Constraints;
  modelIds: string[];
  ordinal?: number[];
}

const CITY_LIST = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "重庆", "苏州", "天津"];

export function matchModelIds(text: string): string[] {
  return CARS
    .filter((c) => text.includes(c.series) || text.includes(`${c.brand}${c.series}`) || text.includes(`${c.brand} ${c.series}`))
    .map((c) => c.id);
}

function parseBudget(text: string): { budgetMin?: number; budgetMax?: number } {
  // 10-15万 / 10~15万 / 10到15万
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (range) {
    return { budgetMin: Number(range[1]), budgetMax: Number(range[2]) };
  }
  // 15万左右 / 预算15万
  const single = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (single) {
    const v = Number(single[1]);
    return { budgetMin: Math.round(v * 0.9 * 10) / 10, budgetMax: Math.round(v * 1.1 * 10) / 10 };
  }
  return {};
}

function parseEnergy(text: string): EnergyType[] | undefined {
  if (/新能源/.test(text)) return ["混动", "纯电"];
  if (/纯电|电车|电动/.test(text)) return ["纯电"];
  if (/混动|插混|油电/.test(text)) return ["混动"];
  if (/燃油|油车/.test(text)) return ["燃油"];
  return undefined;
}

function parseSeats(text: string): number | undefined {
  const m = text.match(/([4-7])\s*座/);
  if (m) return Number(m[1]);
  if (/七座/.test(text)) return 7;
  if (/六座/.test(text)) return 6;
  if (/五座/.test(text)) return 5;
  return undefined;
}

function parseBodyType(text: string): string[] | undefined {
  const types: string[] = [];
  if (/suv|越野车/i.test(text)) types.push("SUV");
  if (/轿车/.test(text)) types.push("轿车");
  if (/mpv|商务车/i.test(text)) types.push("MPV");
  if (/两厢|小车/.test(text)) types.push("两厢车");
  return types.length ? types : undefined;
}

function parseUsage(text: string): string[] | undefined {
  const usage: string[] = [];
  if (/家用|家庭|有娃|接娃|孩子/.test(text)) usage.push("家用");
  if (/通勤|上下班|代步/.test(text)) usage.push("通勤");
  if (/长途|自驾|高速/.test(text)) usage.push("长途");
  if (/越野|烂路/.test(text)) usage.push("通过性");
  if (/省油|油耗|经济/.test(text)) usage.push("省油");
  if (/空间|大空间/.test(text)) usage.push("空间");
  return usage.length ? usage : undefined;
}

function parseCharging(text: string): boolean | undefined {
  if (/有充电桩|有家充|能充电|固定车位/.test(text)) return true;
  if (/没充电桩|没有充电桩|不能充电|无固定车位|不方便充电/.test(text)) return false;
  return undefined;
}

export function parseMessage(text: string, candidates: Candidate[]): ParsedMessage {
  let intent: Intent = "unknown";

  // 顺序很重要：预约 > 对比 > 价格 > 口碑 > 推荐
  if (/试驾|预约|到店|看车/.test(text)) intent = "book";
  else if (/对比|比较|哪个好|差异|区别/.test(text)) intent = "compare";
  else if (/落地|多少钱|价格|优惠|报价/.test(text)) intent = "price";
  else if (/口碑|评价|怎么样|缺点|优点|真实|吐槽/.test(text)) intent = "reviews";
  else if (/推荐|买|选|预算|家用|通勤|代步|万/.test(text)) intent = "recommend";

  const constraints: Constraints = {
    ...parseBudget(text),
    energy: parseEnergy(text),
    seats: parseSeats(text),
    bodyType: parseBodyType(text),
    usage: parseUsage(text),
    charging: parseCharging(text),
    city: CITY_LIST.find((c) => text.includes(c)),
  };
  // 去掉 undefined，方便状态合并
  for (const k of Object.keys(constraints) as Array<keyof Constraints>) {
    if (constraints[k] === undefined) delete constraints[k];
  }

  const modelIds = matchModelIds(text);

  // 序数引用：「第一款」「前两款」「第1款」
  const ordinal: number[] = [];
  if (/前两|这两|都对比|全部对比/.test(text) && candidates.length >= 2) {
    ordinal.push(...candidates.map((_, i) => i).slice(0, 3));
  }
  const one = text.match(/第([一二三123]|[1-3])款/);
  if (one) {
    const map: Record<string, number> = { 一: 0, 二: 1, 三: 2, "1": 0, "2": 1, "3": 2 };
    ordinal.push(map[one[1]] ?? 0);
  }

  return { intent, constraints, modelIds, ordinal: ordinal.length ? ordinal : undefined };
}
