// ============================================================
// LLM 连通性自检：GET /api/llm-test
// 用途：快速确认 Key / BaseURL / 模型名 是否可用（不消耗太多 token）
// ============================================================
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { getBaseURL, getModelName, hasLLM } from "@/src/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasLLM()) {
    return Response.json({ ok: false, error: "未配置 OPENAI_API_KEY" }, { status: 400 });
  }

  const started = Date.now();
  const modelName = getModelName();
  const baseURL = getBaseURL() || "https://api.openai.com/v1（默认）";

  try {
    const model = new ChatOpenAI({
      model: modelName,
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 20_000,
      configuration: getBaseURL() ? { baseURL: getBaseURL() } : undefined,
    } as any);

    const res = await model.invoke([new HumanMessage("只回复两个字母：OK")]);
    return Response.json({
      ok: true,
      model: modelName,
      baseURL,
      ms: Date.now() - started,
      reply: String(res.content).slice(0, 100),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        model: modelName,
        baseURL,
        ms: Date.now() - started,
        error: (err as Error).message.slice(0, 600),
      },
      { status: 502 }
    );
  }
}
