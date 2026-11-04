// ============================================================
// 仓储层：统一「先查数据库，失败回退内置数据」的读取逻辑
// 面试要点：业务代码不关心数据来自 PG 还是内存，方便灰度与降级。
// ============================================================
import { CARS } from "../data/cars";
import { REVIEWS } from "../data/reviews";
import type { CarModel, Review } from "../types";
import { getPool, hasDb, query } from "./index";

type VariantRow = {
  id: string; model_id: string; name: string; guide_price: string;
  range_km: number | null; power_kw: string | null; length_mm: number | null;
  wheelbase_mm: number | null; fuel_consumption: string | null; config: unknown;
};

export async function getAllCars(): Promise<CarModel[]> {
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
export async function searchReviewsVector(embedding: number[], topK = 3): Promise<Review[]> {
  if (!hasDb()) return [];
  try {
    const rows = await query<any>(
      `SELECT id, model_id, source, title, content, rating, sentiment, published_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM car_reviews
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(embedding), topK]
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
  sessionId: string; modelId: string; city: string; phoneEnc: string;
}): Promise<void> {
  if (!hasDb()) return;
  try {
    await query(
      `INSERT INTO leads (session_id, model_id, city, phone_enc) VALUES ($1, $2, $3, $4)`,
      [lead.sessionId, lead.modelId, lead.city, lead.phoneEnc]
    );
  } catch (err) {
    console.warn("[repo] 写入线索失败（不影响演示）:", (err as Error).message);
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
export async function listSessions(limit = 50): Promise<SessionSummary[]> {
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
       ORDER BY updated_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
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
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO sessions (id, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [sessionId, JSON.stringify(state)]
    );
  } catch {
    /* 忽略：会话持久化是加分项，不影响主流程 */
  }
}
