// ============================================================
// LLM 层：LangChain ChatOpenAI（可选）+ 本地流式兜底
// 面试要点：
// 1) 没有 API Key 也要能跑（mock 模式）；
// 2) LLM 只做「语言润色」，事实必须来自工具结果（factSheet）。
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export function hasLLM(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getModelName(): string {
  return process.env.OPENAI_MODEL || "gpt-5.6-luna";
}

export function getBaseURL(): string | undefined {
  return process.env.OPENAI_BASE_URL || undefined;
}

function llmOptions() {
  return {
    model: getModelName(),
    temperature: 0.3,
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,          // 失败快速暴露，避免长时间无响应
    timeout: 30_000,
    // 兼容第三方网关 / DeepSeek / 中转站：填 OPENAI_BASE_URL 即可
    configuration: getBaseURL() ? { baseURL: getBaseURL() } : undefined,
  };
}

function splitForStreaming(text: string, size = 6): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 流式生成最终回答：
 * - 有 Key：调用 ChatOpenAI 流式润色（严格禁止改动事实）
 * - 无 Key：把模板答案按字分块推送，模拟打字机
 */
export async function* streamAnswer(
  baseAnswer: string,
  factSheet: string,
  onFallback?: (reason: string) => void
): AsyncGenerator<string> {
  if (hasLLM()) {
    try {
      const model = new ChatOpenAI(llmOptions() as any);

      const stream = await model.stream([
        new SystemMessage(
          "你是懂车帝风格的选车顾问。你只能使用用户提供的「资料」中的事实，" +
          "绝对不要修改任何数字、车型名、价格、配置；资料没有的信息就说不知道。" +
          "不要使用“最”“第一”“绝对”“保证”等绝对化用语。" +
          "输出中文，条理清晰，不超过 300 字。"
        ),
        new HumanMessage(`资料：\n${factSheet}\n\n请把资料组织成给用户的自然回答：`),
      ]);

      let produced = false;
      for await (const chunk of stream) {
        const content = chunk.content;
        const text = typeof content === "string" ? content : "";
        if (text) {
          produced = true;
          yield text;
        }
      }
      if (produced) return;
    } catch (err) {
      const reason = (err as Error).message || String(err);
      console.warn("[llm] 调用失败，回退模板输出:", reason);
      // 通知上层（前端会显示提示，而不是"没反应"）
      onFallback?.(reason.slice(0, 300));
    }
  }

  for (const piece of splitForStreaming(baseAnswer)) {
    yield piece;
    await sleep(12);
  }
}
