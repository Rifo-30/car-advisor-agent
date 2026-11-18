// ============================================================
// LLM-as-judge：补充规则断言无法覆盖的回答质量评估
// 规则断言负责事实/结构，judge 负责相关性、完整性、表达和克制程度
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface JudgeInput {
  category: string;
  userMessages: string[];
  answer: string;
  toolSummaries: string[];
}

export interface JudgeResult {
  score: number;
  pass: boolean;
  reason: string;
}

function stripFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function validateJudgeResult(raw: unknown): JudgeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const score = Number(obj.score);
  const reason = String(obj.reason ?? "").trim();
  if (!Number.isFinite(score) || score < 1 || score > 5 || !reason) return null;
  return { score, pass: score >= 4, reason: reason.slice(0, 500) };
}

export async function judgeAnswer(
  input: JudgeInput,
  enabled = process.env.EVAL_JUDGE_ENABLED !== "false"
): Promise<JudgeResult | null> {
  if (!enabled || !process.env.OPENAI_API_KEY || !input.answer.trim()) return null;

  try {
    const model = new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      temperature: 0,
      maxRetries: 0,
      timeout: 20_000,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
    } as any);

    const result = await model.invoke([
      new SystemMessage([
        "你是严格的汽车选车 Agent 评测员。只输出 JSON：",
        '{"score": 1到5的整数, "pass": boolean, "reason": "不超过120字"}',
        "评分维度：",
        "1. 是否正面回答用户；2. 是否覆盖用户要求；3. 是否保持事实和约束；",
        "4. 是否承认缺失信息而非编造；5. 是否简洁、清晰、无绝对化承诺。",
        "只评价最后一条用户消息对应的本轮回答。历史用户消息只用于理解上下文，不要求回答重复历史请求。",
        "不要因为措辞普通而低分，重点是正确、相关、完整、可信。",
      ].join("\n")),
      new HumanMessage([
        `场景：${input.category}`,
        `历史用户消息：${input.userMessages.slice(0, -1).join(" | ") || "无"}`,
        `本轮用户消息：${input.userMessages.at(-1) ?? ""}`,
        `工具结果摘要：${input.toolSummaries.join(" | ") || "无"}`,
        `Agent 回答：${input.answer}`,
        '输出 JSON：{"score":4,"pass":true,"reason":"..."}',
      ].join("\n")),
    ]);

    const content = typeof result.content === "string" ? result.content : "";
    if (!content) return null;
    return validateJudgeResult(JSON.parse(stripFence(content)));
  } catch (err) {
    console.warn("[eval] LLM-as-judge 跳过:", (err as Error).message);
    return null;
  }
}
