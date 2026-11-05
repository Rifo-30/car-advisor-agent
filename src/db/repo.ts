// ============================================================
// 仓储层：统一「先查数据库，失败回退内置数据」的读取逻辑
// 面试要点：业务代码不关心数据来自 PG 还是内存，方便灰度与降级。
// ============================================================
import { CARS } from "../data/cars";
import { REVIEWS } from "../data/reviews";
import type { CarModel, Review } from "../types";
import { getPool, hasDb, initSchema, query } from "./index";

/** 确保 schema 已初始化（幂等，失败不阻塞） */
async function ensureSchema(): Promise<void> {
  try {
    await initSchema();
  } catch (err) {
    console.warn("[repo] initSchema 失败:", (err as Error).message);
  }
}

type VariantRow = {
  id: string; model_id: string; name: string; guide_price: string;
  range_km: number | null; power_kw: string | null; length_mm: number | null;
  wheelbase_mm: number | null; fuel_consumption: string | null; config: unknown;
};

export async function getAllCars(): Promise<CarModel[]> {
  await ensureSchema();
  if (!hasDb()) return CARS;
  try {
    const models = await query<any>(`SELECT * FROM car_models ORDER BY id`);
    if (!models.length) return CARS;
    const variants = await query<VariantRow>(`SELECT * FROM car_variants ORDER BY guide_price`);
    return models.map((m) => ({
      id: m.id,
      brand: m.brand,
      series: m.series,
      level: m.level,
      energyType: m.energy_type,
      seats: m.seats,
      bodyType: m.body_type,
      launchYear: m.launch_year,
      tags: Array.isArray(m.tags) ? m.tags : [],
      description: m.description ?? "",
      variants: variants
        .filter((v) => v.model_id === m.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          guidePrice: Number(v.guide_price),
          rangeKm: v.range_km ?? undefined,
          powerKw: Number(v.power_kw ?? 0),
          lengthMm: v.length_mm ?? 0,
          wheelbaseMm: v.wheelbase_mm ?? 0,
          fuelConsumption: v.fuel_consumption ? Number(v.fuel_consumption) : undefined,
          config: Array.isArray(v.config) ? (v.config as string[]) : [],
        })),
    }));
  } catch (err) {
    console.warn("[repo] 读取数据库失败，回退内置数据:", (err as Error).message);
    return CARS;
  }
}

export async function getCar(modelId: string): Promise<CarModel | undefined> {
  const cars = await getAllCars();
  return cars.find((c) => c.id === modelId);
}

export async function getAllReviews(modelId?: string): Promise<Review[]> {
  await ensureSchema();
  if (!hasDb()) return modelId ? REVIEWS.filter((r) => r.modelId === modelId) : REVIEWS;
  try {
    const rows = modelId
      ? await query<any>(`SELECT * FROM car_reviews WHERE model_id = $1`, [modelId])
      : await query<any>(`SELECT * FROM car_reviews`);
    if (!rows.length) return modelId ? REVIEWS.filter((r) => r.modelId === modelId) : REVIEWS;
    return rows.map((r) => ({
      id: r.id, modelId: r.model_id, source: r.source, title: r.title,
      content: r.content, rating: Number(r.rating ?? 0), sentiment: r.sentiment,
      publishedAt: String(r.published_at).slice(0, 10),
    }));
  } catch (err) {
    console.warn("[repo] 读取评测失败，回退内置数据:", (err as Error).message);
    return modelId ? REVIEWS.filter((r) => r.modelId === modelId) : REVIEWS;
  }
}

/** pgvector 语义检索（需要 DATABASE_URL + 已写入 embedding） */
export async function searchReviewsVector(
  modelId: string,
  embedding: number[],
  topK = 3
): Promise<Review[]> {
  if (!hasDb()) return [];
  try {
    const rows = await query<any>(
      `SELECT id, model_id, source, title, content, rating, sentiment, published_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM car_reviews
       WHERE embedding IS NOT NULL
         AND model_id = $2          -- ⭐ 必须按车型过滤，否则会返回别的车的口碑
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [JSON.stringify(embedding), modelId, topK]
    );
    return rows.map((r) => ({
      id: r.id, modelId: r.model_id, source: r.source, title: r.title,
      content: r.content, rating: Number(r.rating ?? 0), sentiment: r.sentiment,
      publishedAt: String(r.published_at).slice(0, 10),
    }));
  } catch (err) {
    console.warn("[repo] 向量检索失败，回退关键词检索:", (err as Error).message);
    return [];
  }
}

export async function insertLead(lead: {
  sessionId: string;
  userId: string;
  modelId: string;
  city: string;
  phoneEnc: string;
  idempotencyKey: string;
}): Promise<{ inserted: boolean; error?: string }> {
  if (!hasDb()) return { inserted: true }; // 无数据库时视为成功（内存模式）
  await ensureSchema();
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO leads (session_id, user_id, model_id, city, phone_enc, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [lead.sessionId, lead.userId, lead.modelId, lead.city, lead.phoneEnc, lead.idempotencyKey]
    );
    return { inserted: rows.length > 0 };
  } catch (err) {
    console.warn("[repo] 写入线索失败:", (err as Error).message);
    return { inserted: false, error: (err as Error).message };
  }
}

export interface SessionSummary {
  id: string;
  title: string;
  stage: string;
  messageCount: number;
  updatedAt: string | null;
}

/** 历史会话列表：标题取第一条 user 消息 */
export async function listSessions(limit = 50, userId?: string): Promise<SessionSummary[]> {
  await ensureSchema();
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query(
      `SELECT
         id,
         COALESCE(
           (SELECT m->>'content'
              FROM jsonb_array_elements(COALESCE(state->'messages','[]'::jsonb)) WITH ORDINALITY AS t(m, ord)
             WHERE m->>'role' = 'user'
             ORDER BY ord
             LIMIT 1),
           '(空会话)'
         ) AS title,
         COALESCE(state->>'stage', '-') AS stage,
         jsonb_array_length(COALESCE(state->'messages','[]'::jsonb)) AS message_count,
         COALESCE(state->>'updatedAt', to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) AS updated_at
       FROM sessions
       WHERE ($2::text IS NULL OR state->>'userId' = $2)
       ORDER BY updated_at DESC NULLS LAST
       LIMIT $1`,
      [limit, userId ?? null]
    );
    return res.rows.map((r) => ({
      id: r.id,
      title: String(r.title ?? "(空会话)"),
      stage: String(r.stage ?? "-"),
      messageCount: Number(r.message_count ?? 0),
      updatedAt: r.updated_at ? String(r.updated_at) : null,
    }));
  } catch (err) {
    console.warn("[repo] 读取会话列表失败:", (err as Error).message);
    return [];
  }
}

export async function getSessionState(sessionId: string): Promise<any | null> {
  await ensureSchema();
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(`SELECT state FROM sessions WHERE id = $1`, [sessionId]);
    return res.rows[0]?.state ?? null;
  } catch {
    return null;
  }
}

export async function saveSessionState(sessionId: string, state: unknown): Promise<void> {
  await ensureSchema();
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO sessions (id, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [sessionId, JSON.stringify(state)]
    );
  } catch (err) {
    console.warn("[repo] 保存会话失败:", (err as Error).message);
  }
}

// ============================================================
// Trace 持久化（用 any 避免与 observability/trace.ts 形成循环依赖）
// ============================================================
export async function saveTraceRecord(t: any): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  try {
    await query(
      `INSERT INTO traces (id, name, session_id, input, output, start_ms, duration_ms, spans, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (id) DO UPDATE SET
         output = EXCLUDED.output,
         duration_ms = EXCLUDED.duration_ms,
         spans = EXCLUDED.spans,
         updated_at = now()`,
      [
        t.id, t.name, t.sessionId,
        JSON.stringify(t.input ?? null),
        JSON.stringify(t.output ?? null),
        t.startMs ?? null,
        t.durationMs ?? null,
        JSON.stringify(t.spans ?? []),
      ]
    );
  } catch (err) {
    console.warn("[repo] 保存 trace 失败:", (err as Error).message);
  }
}

export async function getTraceRecord(id: string): Promise<any | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  try {
    const rows = await query<any>(
      `SELECT id, name, session_id, input, output, start_ms, duration_ms, spans
       FROM traces WHERE id = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      sessionId: r.session_id,
      input: r.input,
      output: r.output,
      startMs: Number(r.start_ms ?? 0),
      durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
      spans: Array.isArray(r.spans) ? r.spans : [],
    };
  } catch (err) {
    console.warn("[repo] 读取 trace 失败:", (err as Error).message);
    return null;
  }
}

export async function listTraceRecords(limit = 50): Promise<any[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  try {
    const rows = await query<any>(
      `SELECT id, name, session_id, start_ms, duration_ms, spans
       FROM traces ORDER BY start_ms DESC NULLS LAST LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sessionId: r.session_id,
      startMs: Number(r.start_ms ?? 0),
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      spanCount: Array.isArray(r.spans) ? r.spans.length : 0,
    }));
  } catch (err) {
    console.warn("[repo] 读取 trace 列表失败:", (err as Error).message);
    return [];
  }
}
