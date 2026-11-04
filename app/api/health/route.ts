// ============================================================
// 健康检查：真实探活（不是只看环境变量有没有配）
// 面试要点：/health 必须验证「连得上」，否则监控就是假的。
// ============================================================
import { getPool } from "@/src/db/index";
import { getRedis } from "@/src/cache/redis";
import { hasLLM, getModelName, getBaseURL } from "@/src/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

async function checkPg() {
  const configured = Boolean(process.env.DATABASE_URL);
  const pool = getPool();
  if (!pool) return { configured, connected: false, error: configured ? "pool 初始化失败" : "未配置 DATABASE_URL" };
  try {
    await withTimeout(pool.query("SELECT 1"), 1500);
    return { configured, connected: true };
  } catch (err) {
    return { configured, connected: false, error: (err as Error).message.slice(0, 200) };
  }
}

async function checkRedis() {
  const configured = Boolean(process.env.REDIS_URL);
  const client = getRedis();
  if (!client) return { configured, connected: false, error: configured ? "client 初始化失败" : "未配置 REDIS_URL" };
  try {
    await withTimeout(client.ping(), 1500);
    return { configured, connected: true };
  } catch (err) {
    return { configured, connected: false, error: (err as Error).message.slice(0, 200) };
  }
}

export async function GET() {
  const [postgres, redis] = await Promise.all([checkPg(), checkRedis()]);

  return Response.json({
    ok: true,
    llm: {
      enabled: hasLLM(),
      model: hasLLM() ? getModelName() : null,
      baseURL: getBaseURL() ?? "https://api.openai.com/v1（默认）",
    },
    postgres,
    redis,
    langfuse: {
      configured: Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY),
    },
    // 实际生效的数据/缓存模式
    dataMode: postgres.connected ? "postgres" : "memory",
    cacheMode: redis.connected ? "redis" : "memory",
  });
}
