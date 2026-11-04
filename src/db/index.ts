// ============================================================
// 数据库连接层（PostgreSQL + pgvector）
// 面试要点：这里做了「可降级设计」——没有 DATABASE_URL 时
// 自动回退到内置样本数据，保证项目在任何机器上都能跑起来。
// ============================================================
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool | null {
  if (!hasDb()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 3000,
    });
    pool.on("error", (err) => console.error("[db] pool error", err.message));
  }
  return pool;
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(sql, params);
  return res.rows as T[];
}

/** 首次连接时初始化 schema（幂等） */
export async function initSchema(): Promise<void> {
  if (!hasDb()) return;
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const p = getPool();
    if (!p) return;
    const file = fileURLToPath(new URL("./schema.sql", import.meta.url));
    const sql = await readFile(path.resolve(file), "utf8");
    await p.query(sql);
    console.log("[db] schema ready");
  })();

  return schemaReady;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
