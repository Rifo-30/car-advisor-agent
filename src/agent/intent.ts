// ============================================================
// 意图与约束解析（规则层）
// 面试要点：LLM 负责「理解与表达」，但硬约束（预算/能源/座位）
// 用规则解析更稳定、可测试、可解释，避免模型把 15 万说成 20 万。
// ============================================================
import { CARS } from "../data/cars";
import type { BudgetMode, Candidate, CarModel, Constraints, EnergyType } from "../types";

export type Intent =
  | "smalltalk"
  | "recommend"
  | "compare"
  | "price"
  | "reviews"
  | "research"
  | "book"
  | "confirm"
  | "unknown";

export interface ParsedMessage {
  intent: Intent;
  constraints: Constraints;
  modelIds: string[];
  ordinal?: number[];
  /** 当前轮相对预算变化，单位万元；正数增加，负数减少 */
  budgetDelta?: number;
  /** 弱意图：命中了意图关键词但证据不足（如只说"比较"却没点名车型），允许模型覆盖 */
  weakIntent?: boolean;
}

const EXPLICIT_COMPARE = /对比|差异|区别|哪个好|哪款好|哪个更|比较一下|比较下|比较这|比较那|相比|哪个.*(?:空间|续航|油耗|动力|大|好|强|省|合适)/;

/** 只有明确的“先做 A 再做 B”多目标任务才进入自主工具循环 */
export function isMultiStepResearch(text: string): boolean {
  const taskSignals = [
    /推荐|筛选|找|选车|看看|查看/,
    EXPLICIT_COMPARE,
    /口碑|评价|缺点|优点/,
    /落地|报价|多少钱|价格/,
    /预约|试驾/,
  ].filter((pattern) => pattern.test(text)).length;
  const sequence = /先.*(?:再|然后)|再.*(?:然后|并|同时)|然后|并且|同时|顺便|一起|综合/;
  return taskSignals >= 2 && sequence.test(text);
}

const CITY_LIST = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "重庆", "苏州", "天津"];

// ⭐ 允许传入数据库中的车型列表，避免与静态 CARS 不一致
export function matchModelIds(text: string, cars: CarModel[] = CARS): string[] {
  return cars
    .filter((c) => text.includes(c.series) || text.includes(`${c.brand}${c.series}`) || text.includes(`${c.brand} ${c.series}`))
    .map((c) => c.id);
}

function parseBudget(text: string): { budgetMin?: number; budgetMax?: number; budgetMode?: BudgetMode } {
  // 10-15万 / 10~15万 / 10到15万
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (range) {
    return { budgetMin: Number(range[1]), budgetMax: Number(range[2]), budgetMode: "range" };
  }
  // 20万以内 / 20万以下 / 不超过20万
  const max = text.match(/(?:不超过|最多|最高|封顶)?\s*(\d+(?:\.\d+)?)\s*万\s*(?:以内|以下|封顶|内)/) ??
    text.match(/(?:不超过|最多|最高|封顶)\s*(\d+(?:\.\d+)?)\s*万/);
  if (max) {
    return { budgetMin: 0, budgetMax: Number(max[1]), budgetMode: "max" };
  }
  // 20万以上 / 至少20万
  const min = text.match(/(?:至少|最低)\s*(\d+(?:\.\d+)?)\s*万/) ??
    text.match(/(\d+(?:\.\d+)?)\s*万\s*(?:以上|起)/);
  if (min) {
    return { budgetMin: Number(min[1]), budgetMode: "min" };
  }
  // 15万左右 / 预算15万
  const single = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (single) {
    const v = Number(single[1]);
    return {
      budgetMin: Math.round(v * 0.9 * 10) / 10,
      budgetMax: Math.round(v * 1.1 * 10) / 10,
      budgetMode: "around",
    };
  }
  return {};
}

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseCnInteger(text: string): number | null {
  const normalized = text.replace(/两/g, "二");
  const total = 0;
  let section = 0;
  let number = 0;
  let found = false;

  for (const ch of normalized) {
    const digit = CN_DIGITS[ch];
    if (digit != null) {
      number = digit;
      found = true;
      continue;
    }

    const unit = ch === "十" ? 10 : ch === "百" ? 100 : ch === "千" ? 1000 : 0;
    if (!unit) continue;
    found = true;
    section += (number || 1) * unit;
    number = 0;
  }

  return found ? total + section + number : null;
}

function parseDeltaAmount(raw: string, tailDigit?: string): number | null {
  const amount = /^\d+(?:\.\d+)?$/.test(raw)
    ? Number(raw)
    : parseCnInteger(raw);
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const tail = tailDigit ? Number(CN_DIGITS[tailDigit] ?? 0) / 10 : 0;
  return Math.round((amount + tail) * 10) / 10;
}

/** 解析“再加两万 / 便宜一万”等相对预算表达，返回带符号的万元数 */
export function parseBudgetDelta(text: string): number | undefined {
  // “加两万配置/加装座椅”不是预算变化
  if (/配置|座椅|装饰|充电桩/.test(text) && !/预算|车价|价格/.test(text)) return undefined;

  const amount = "([0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十百]+)";
  const tail = "(?:\\s*([一二三四五六七八九]))?";
  const increase = new RegExp(`(?:再加|增加|提高|上调|多|加)\\s*${amount}\\s*万${tail}`);
  const decrease = new RegExp(`(?:减少|降低|下调|便宜|降|少)\\s*${amount}\\s*万${tail}`);

  const up = text.match(increase);
  if (up) {
    const n = parseDeltaAmount(up[1], up[2]);
    return n == null ? undefined : n;
  }

  const down = text.match(decrease);
  if (down) {
    const n = parseDeltaAmount(down[1], down[2]);
    return n == null ? undefined : -n;
  }

  return undefined;
}

function parseEnergy(text: string): EnergyType[] | undefined {
  // 排除式表达要转换成"允许的能源集合"，否则"不要电车"会被错误解析成只要纯电
  if (/不看|不要|排除|不考虑/.test(text) && /纯电|电车|电动/.test(text)) {
    return ["燃油", "混动"];
  }
  if (/不看|不要|排除|不考虑/.test(text) && /燃油|油车/.test(text)) {
    return ["混动", "纯电"];
  }
  if (/不看|不要|排除|不考虑/.test(text) && /混动|插混|油电/.test(text)) {
    return ["燃油", "纯电"];
  }
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
  if (/家用|家庭|有娃|接娃|带娃|遛娃|孩子/.test(text)) usage.push("家用");
  if (/带娃|遛娃/.test(text)) usage.push("空间");
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

export function parseMessage(text: string, candidates: Candidate[], cars: CarModel[] = CARS): ParsedMessage {
  let intent: Intent = "unknown";
  const budgetDelta = parseBudgetDelta(text);

  // ⭐ 先识别寒暄/自我介绍：这类问题不该逼用户"澄清需求"
  const identity = /你是谁|你叫什么|你是什么|介绍一下你自己|你能做什么|你有什么功能|你是干什么的/;
  const greeting = /^(你好|您好|hi|hello|嗨|哈喽|在吗)[!！。,.，\s]*$/i;
  const thanks = /^(谢谢|感谢|多谢|再见|拜拜|ok|好的)[!！。,.，\s]*$/i;

  // 顺序很重要：寒暄 > 预约 > 对比 > 价格 > 口碑 > 推荐
  if (identity.test(text) || greeting.test(text) || thanks.test(text)) intent = "smalltalk";
  else if (isMultiStepResearch(text)) intent = "research";
  else if (/试驾|预约|到店|看车/.test(text)) intent = "book";
  // ⭐ 收紧对比意图：裸"比较"会误伤"比较远/比较贵/比较省油"，改成明确的对比表达
  else if (EXPLICIT_COMPARE.test(text)) intent = "compare";
  else if (/落地|多少钱|价格|优惠|报价/.test(text)) intent = "price";
  else if (
    /口碑|评价|怎么样|缺点|优点|真实|吐槽/.test(text) ||
    // 已有候选时，“这车高速噪音大吗/它空间怎么样”属于口碑追问，不是重新筛车
    (/噪音|隔音|风噪|胎噪|空间|后排|后备箱|油耗|续航|动力|底盘|舒适|安全|车机|智驾|带娃|孩子|家庭/i.test(text) &&
      (/这车|这款|这辆|那车|那款|那辆|它|该车/.test(text) || candidates.length > 0) &&
      !/推荐|预算|买|选/.test(text))
  ) intent = "reviews";
  else if (/推荐|买|选|预算|家用|通勤|代步|万/.test(text)) intent = "recommend";

  const constraints: Constraints = {
    // 相对预算只产出 budgetDelta，不能把“加2万”里的 2 万误当成绝对预算
    ...(budgetDelta == null ? parseBudget(text) : {}),
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

  // ⭐ 多轮追问经常省略"推荐"动词，例如上一轮已有推荐后只说"油车呢"。
  //   只要能解析出新的硬约束，就按"基于上下文继续筛选"处理。
  if (intent === "unknown" && (Object.keys(constraints).length > 0 || budgetDelta != null)) {
    intent = "recommend";
  }

  const modelIds = matchModelIds(text, cars);

  // 序数引用：「第一款」「前两款」「第1款」
  const ordinal: number[] = [];
  if (/前两|这两|都对比|全部对比/.test(text) && candidates.length >= 2) {
    ordinal.push(...candidates.map((_, i) => i).slice(0, 3));
  }
  // ⭐ 解析所有「第X款」，支持"对比第一款和第三款"
  const map: Record<string, number> = { 一: 0, 二: 1, 三: 2, "1": 0, "2": 1, "3": 2 };
  for (const m of text.matchAll(/第([一二三123])款/g)) {
    ordinal.push(map[m[1]] ?? 0);
  }

  // ⭐ 弱意图判断：compare 但没有点名车型、没有候选、也没有序数引用
  //    → 可能是"比较远的地方"这类误匹配，允许模型复核并覆盖
  let weakIntent = false;
  if (intent === "compare") {
    const hasNamedModels = modelIds.length >= 2;
    const hasOrdinalRef = /前两|这两|都对比|全部对比|第[一二三123]款/.test(text);
    const hasCandidates = candidates.length > 0;
    weakIntent = !hasNamedModels && !hasOrdinalRef && !hasCandidates;
  }

  return {
    intent,
    constraints,
    modelIds,
    ordinal: ordinal.length ? ordinal : undefined,
    budgetDelta,
    weakIntent: weakIntent || undefined,
  };
}

/**
 * 判断是否需要调用模型补充：
 * - 意图完全不明（unknown）
 * - 规则意图是弱匹配（例如 compare 没点名车型、没有候选、没有序数引用）
 * - 是选车类意图，但一个上下文标签都没解析到（例如"带娃推荐什么车"）
 *
 * 只在"规则不确定"时触发，控制模型调用比例，避免每次都多花一次请求。
 */
export function needsModelFallback(parsed: ParsedMessage): boolean {
  // 1) 完全没识别出意图
  if (parsed.intent === "unknown") return true;

  // 2) 弱意图（如只命中"比较"但没点名车型）→ 让模型复核
  if (parsed.weakIntent) return true;

  // 规则已稳定抽出预算增量时，不需要再让模型计算一次
  if (parsed.budgetDelta != null) return false;

  // 3) 选车类意图，但一个上下文约束都没解析到 → 可能识别错了
  const selectLike = ["recommend", "compare", "price", "reviews"];
  if (!selectLike.includes(parsed.intent)) return false;

  const c = parsed.constraints;
  const noContext =
    !c.usage?.length &&
    !c.energy?.length &&
    !c.bodyType?.length &&
    !c.charging &&
    c.budgetMin == null;

  return noContext;
}
