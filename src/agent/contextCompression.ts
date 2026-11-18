// ============================================================
// 对话上下文压缩与 token budget
// - 原始 messages 保留用于历史展示
// - contextWindowMessages 只保留最近消息 + 历史摘要
// - 旧消息按游标增量摘要，避免每轮重复总结
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatMessage } from "../types";

export interface ContextCompressionOptions {
  maxTokens?: number;
  keepRecentMessages?: number;
  summaryMaxTokens?: number;
  summarizedCount?: number;
}

export interface ContextCompressionResult {
  summary: string;
  messages: ChatMessage[];
  estimatedTokens: number;
  summarizedCount: number;
  compressed: boolean;
}

function countTokens(text: string): number {
  const chars = Array.from(text);
  const cjk = chars.filter((char) => /[\u4e00-\u9fa5]/.test(char)).length;
  const other = chars.length - cjk;
  return Math.ceil(cjk / 2 + other / 4);
}

export function estimateContextTokens(text: string): number {
  return countTokens(text);
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (countTokens(text) <= maxTokens) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countTokens(chars.slice(0, mid).join("")) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, Math.max(1, low)).join("")}…`;
}

function deterministicSummary(messages: ChatMessage[], maxTokens: number): string {
  const lines: string[] = [];
  for (const message of messages) {
    const role = message.role === "user" ? "用户" : "助手";
    const text = message.content.replace(/\s+/g, " ").trim();
    if (text) lines.push(`${role}：${truncateToTokens(text, message.role === "user" ? 120 : 80)}`);
  }
  return truncateToTokens(lines.join("\n"), maxTokens);
}

async function modelSummary(
  newMessages: ChatMessage[],
  previousSummary: string,
  maxTokens: number
): Promise<string | null> {
  if (process.env.CONTEXT_SUMMARY_MODEL_ENABLED === "false" || !process.env.OPENAI_API_KEY) return null;
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
        "你负责压缩汽车选车 Agent 的历史对话。保留用户预算、能源、座位、用途、指代目标、已确认车型、未完成事项和重要限制；不要编造；不要输出 Markdown；不超过 180 字。"
      ),
      new HumanMessage([
        `旧摘要：${previousSummary || "无"}`,
        `新增历史：\n${newMessages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n")}`,
      ].join("\n\n")),
    ]);
    const content = typeof result.content === "string" ? result.content.trim() : "";
    return content ? truncateToTokens(content, maxTokens) : null;
  } catch (err) {
    console.warn("[context] 模型摘要失败，使用规则摘要:", (err as Error).message);
    return null;
  }
}

function fitRecent(messages: ChatMessage[], budget: number): ChatMessage[] {
  const recent = [...messages];
  while (recent.length > 1 && recent.reduce((sum, message) => sum + countTokens(message.content), 0) > budget) {
    recent.shift();
  }
  return recent;
}

/**
 * 将历史消息压缩为“摘要 + 最近消息窗口”。
 * summarizedCount 是已纳入摘要的原始消息数量，保证增量处理。
 */
export async function compressContext(
  messages: ChatMessage[],
  options: ContextCompressionOptions = {},
  previousSummary = ""
): Promise<ContextCompressionResult> {
  const maxTokens = Math.max(200, options.maxTokens ?? 3000);
  const keepRecentMessages = Math.max(2, options.keepRecentMessages ?? 8);
  const summaryMaxTokens = Math.max(80, options.summaryMaxTokens ?? 600);
  const summarizedCount = Math.min(options.summarizedCount ?? 0, messages.length);

  const summarizeEnd = Math.max(0, messages.length - keepRecentMessages);
  const newMessages = messages.slice(summarizedCount, summarizeEnd);
  let summary = previousSummary;
  let nextSummarizedCount = summarizedCount;
  let compressed = false;

  if (newMessages.length) {
    const oldTokens = countTokens(newMessages.map((message) => message.content).join(""));
    const modelText = oldTokens >= Number(process.env.CONTEXT_SUMMARY_MODEL_THRESHOLD ?? 300)
      ? await modelSummary(newMessages, previousSummary, summaryMaxTokens)
      : null;
    summary = modelText ?? deterministicSummary(newMessages, summaryMaxTokens);
    nextSummarizedCount = summarizeEnd;
    compressed = true;
  }

  const recent = messages.slice(summarizeEnd);
  const summaryTokens = summary ? countTokens(summary) + 20 : 0;
  const recentWindow = fitRecent(recent, Math.max(100, maxTokens - summaryTokens));
  const window: ChatMessage[] = summary
    ? [{ role: "assistant", content: `[历史摘要]\n${summary}` }, ...recentWindow]
    : recentWindow;
  const estimatedTokens = window.reduce((sum, message) => sum + countTokens(message.content), 0);

  if (window.length < messages.length) compressed = true;
  return { summary, messages: window, estimatedTokens, summarizedCount: nextSummarizedCount, compressed };
}
