// ============================================================
// 缓存层（Redis，可降级为进程内 Map）
// 面试要点：缓存是 Agent 降本增效的第一手段；
// 外部依赖不可用时不能拖垮主流程，所以做了 fallback。
// ============================================================
import Redis from "ioredis";

let client: Redis | null = null;
let disabled = false;

export function hasRedis(): boolean {
  return Boolean(process.env.REDIS_URL) && !disabled;
}

export function getRedis(): Redis | null {
  if (!hasRedis()) return null;
  if (!client) {
    try {
      client = new Redis(process.env.REDIS_URL!, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1200,
        retryStrategy: () => null,
      });
      client.on("error", (err) => {
        console.warn("[redis] error, 切换内存缓存:", err.message);
        disabled = true;
      });
    } catch (err) {
      console.warn("[redis] 初始化失败，使用内存缓存:", (err as Error).message);
      disabled = true;
      return null;
    }
  }
  return client;
}

const mem = new Map<string, { value: string; expireAt: number }>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      disabled = true;
    }
  }
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) {
    mem.delete(key);
    return null;
  }
  return JSON.parse(hit.value) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  const raw = JSON.stringify(value);
  const r = getRedis();
  if (r) {
    try {
      await r.set(key, raw, "EX", ttlSeconds);
      return;
    } catch {
      disabled = true;
    }
  }
  mem.set(key, { value: raw, expireAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  const r = getRedis();
  if (r) {
    try { await r.del(key); } catch { disabled = true; }
  }
  mem.delete(key);
}
