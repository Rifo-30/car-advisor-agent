// ============================================================
// RAG 检索 query 构建：只在口碑检索节点使用
// 规则先构建可解释 query；指代明显时可用模型补全，失败则回退规则结果
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { CarModel } from "../types";

export interface ReviewQueryInput {
  question: string;
  car?: CarModel;
  previousUserMessages?: string[];
}

const ASPECT_EXPANSIONS: Array<[RegExp, string]> = [
  [/高速|长途|跑远路/, "高速 长途 稳定性 舒适性"],
  [/噪音|隔音|风噪|胎噪|nvh/i, "噪音 隔音 风噪 胎噪 NVH"],
  [/空间|后排|后备箱|带娃|孩子|家庭/, "空间 后排 后备箱 家庭 儿童座椅"],
  [/油耗|省油|用车成本|保养/, "油耗 用车成本 保养"],
  [/续航|充电|补能|电耗/, "续航 充电 补能 电耗"],
  [/动力|加速|超车/, "动力 加速 超车"],
  [/底盘|滤震|舒适/, "底盘 滤震 舒适性"],
  [/车机|智能|辅助驾驶|智驾/, "车机 智能座舱 辅助驾驶"],
  [/缺点|不足|问题|吐槽/, "缺点 问题 槽点"],
];

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dedupeWords(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/\s+/)
    .filter((word) => {
      if (!word || seen.has(word)) return false;
      seen.add(word);
      return true;
    })
    .join(" ");
}

/** 可解释、零额外模型调用的检索 query 构造 */
export function buildReviewQuery(input: ReviewQueryInput): string {
  const question = normalize(input.question);
  const carName = input.car ? `${input.car.brand} ${input.car.series}` : "";
  const needsContext = /这车|这款|这辆|那车|那款|那辆|它|该车/.test(question) || Array.from(question).length <= 8;
  const contextText = needsContext ? (input.previousUserMessages ?? []).slice(-2).join(" ") : "";
  const aspects = ASPECT_EXPANSIONS.filter(([pattern]) => pattern.test(`${contextText} ${question}`)).map(([, text]) => text);

  const query = dedupeWords(normalize([
    carName,
    question,
    ...aspects,
    "车主口碑 优点 缺点 真实评价",
  ].filter(Boolean).join(" ")));

  return query.slice(0, 220);
}

function shouldUseModel(question: string): boolean {
  const hasSpecificTopic = /高速|长途|噪音|隔音|空间|后排|油耗|续航|充电|动力|底盘|车机|智能|缺点|优点/.test(question);
  return !hasSpecificTopic || Array.from(question.trim()).length <= 4;
}

/**
 * 口碑 query 改写：仅在指代或主题不足时启用。
 * 模型失败、超时或输出异常时返回规则 query，不阻塞口碑主流程。
 */
export async function rewriteReviewQuery(input: ReviewQueryInput): Promise<string> {
  const fallback = buildReviewQuery(input);
  if (process.env.RAG_QUERY_REWRITE_ENABLED === "false") return fallback;
  if (!process.env.OPENAI_API_KEY || !shouldUseModel(input.question)) return fallback;

  try {
    const model = new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      temperature: 0,
      maxRetries: 0,
      timeout: 4000,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
    } as any);

    const result = await model.invoke([
      new SystemMessage(
        "你是汽车口碑检索 query 改写器。只输出一条用于检索车主口碑的中文 query，不要解释、不要 Markdown，不超过 120 字。只能使用输入中已有的事实，不得编造车型或配置；不要加入预算、推荐、筛车等非口碑词。"
      ),
      new HumanMessage([
        `车型：${input.car ? `${input.car.brand} ${input.car.series}` : "未指定"}`,
        `当前问题：${input.question}`,
        `最近用户消息：${(input.previousUserMessages ?? []).slice(-3).join(" | ") || "无"}`,
        `规则 query：${fallback}`,
      ].join("\n")),
    ]);

    const raw = typeof result.content === "string" ? result.content : "";
    const rewritten = normalize(raw.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").replace(/^["“]|["”]$/g, ""));
    if (!rewritten || rewritten.length > 160) return fallback;

    const carName = input.car ? `${input.car.brand} ${input.car.series}` : "";
    return carName && !rewritten.includes(input.car!.series)
      ? normalize(`${carName} ${rewritten}`).slice(0, 220)
      : rewritten;
  } catch (err) {
    console.warn("[rag] query 改写失败，使用规则 query:", (err as Error).message);
    return fallback;
  }
}
