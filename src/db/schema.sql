-- ============================================================
-- 选车决策 Agent 数据层（PostgreSQL + pgvector）
-- 对应 PRD §10 数据模型
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 车型（车系）
CREATE TABLE IF NOT EXISTS car_models (
  id           TEXT PRIMARY KEY,
  brand        TEXT NOT NULL,
  series       TEXT NOT NULL,
  level        TEXT,
  energy_type  TEXT,
  seats        INT,
  body_type    TEXT,
  launch_year  INT,
  tags         JSONB DEFAULT '[]'::jsonb,
  description  TEXT
);

-- 具体配置版本
CREATE TABLE IF NOT EXISTS car_variants (
  id                TEXT PRIMARY KEY,
  model_id          TEXT REFERENCES car_models(id) ON DELETE CASCADE,
  name              TEXT,
  guide_price       NUMERIC(10, 2),
  range_km          INT,
  power_kw          NUMERIC(10, 2),
  length_mm         INT,
  wheelbase_mm      INT,
  fuel_consumption  NUMERIC(6, 2),
  config            JSONB DEFAULT '[]'::jsonb
);

-- 评测 / 口碑（非结构化 + 向量）
CREATE TABLE IF NOT EXISTS car_reviews (
  id            TEXT PRIMARY KEY,
  model_id      TEXT REFERENCES car_models(id) ON DELETE CASCADE,
  source        TEXT,
  title         TEXT,
  content       TEXT,
  rating        NUMERIC(3, 1),
  sentiment     TEXT,
  published_at  DATE,
  embedding     vector(1536)
);

-- 试驾线索（手机号加密存储）
CREATE TABLE IF NOT EXISTS leads (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT,
  model_id    TEXT,
  city        TEXT,
  phone_enc   TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 会话（Redis 不可用时的持久化兜底）
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  state       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 向量索引（HNSW，余弦距离）
CREATE INDEX IF NOT EXISTS car_reviews_embedding_idx
  ON car_reviews USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS car_reviews_model_idx ON car_reviews(model_id);
