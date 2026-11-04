import { hasDb } from "@/src/db/index";
import { hasRedis } from "@/src/cache/redis";
import { hasLLM, getModelName } from "@/src/agent/llm";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    llm: { enabled: hasLLM(), model: hasLLM() ? getModelName() : null },
    postgres: hasDb(),
    redis: hasRedis(),
    langfuse: Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY),
  });
}
