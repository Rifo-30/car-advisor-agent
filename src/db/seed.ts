// ============================================================
// 种子脚本：把内置样本数据写入 PostgreSQL + pgvector
// 用法：pnpm db:seed（需先 docker compose up -d）
// ============================================================
import "dotenv/config";
import OpenAI from "openai";
import { CARS } from "../data/cars";
import { REVIEWS } from "../data/reviews";
import { closeDb, hasDb, initSchema, query } from "./index";

async function main() {
  if (!hasDb()) {
    console.log("⚠️ 未配置 DATABASE_URL，跳过入库（应用会自动使用内置内存数据）");
    return;
  }

  await initSchema();
  console.log("→ 写入车型与配置...");

  for (const car of CARS) {
    await query(
      `INSERT INTO car_models (id, brand, series, level, energy_type, seats, body_type, launch_year, tags, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         brand=EXCLUDED.brand, series=EXCLUDED.series, level=EXCLUDED.level,
         energy_type=EXCLUDED.energy_type, seats=EXCLUDED.seats, body_type=EXCLUDED.body_type,
         launch_year=EXCLUDED.launch_year, tags=EXCLUDED.tags, description=EXCLUDED.description`,
      [car.id, car.brand, car.series, car.level, car.energyType, car.seats, car.bodyType, car.launchYear, JSON.stringify(car.tags), car.description]
    );

    for (const v of car.variants) {
      await query(
        `INSERT INTO car_variants (id, model_id, name, guide_price, range_km, power_kw, length_mm, wheelbase_mm, fuel_consumption, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, guide_price=EXCLUDED.guide_price, range_km=EXCLUDED.range_km,
           power_kw=EXCLUDED.power_kw, length_mm=EXCLUDED.length_mm, wheelbase_mm=EXCLUDED.wheelbase_mm,
           fuel_consumption=EXCLUDED.fuel_consumption, config=EXCLUDED.config`,
        [v.id, car.id, v.name, v.guidePrice, v.rangeKm ?? null, v.powerKw, v.lengthMm, v.wheelbaseMm, v.fuelConsumption ?? null, JSON.stringify(v.config)]
      );
    }
  }

  console.log("→ 写入评测/口碑（含向量）...");
  const client = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined })
    : null;

  for (let i = 0; i < REVIEWS.length; i += 10) {
    const batch = REVIEWS.slice(i, i + 10);
    let embeddings: number[][] = [];
    if (client) {
      try {
        const res = await client.embeddings.create({
          model: "text-embedding-3-small",
          input: batch.map((r) => `${r.title}\n${r.content}`),
        });
        embeddings = res.data.map((d) => d.embedding);
      } catch (err) {
        console.warn("  向量生成失败，先写入文本:", (err as Error).message);
      }
    }

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const emb = embeddings[j];
      await query(
        `INSERT INTO car_reviews (id, model_id, source, title, content, rating, sentiment, published_at, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           title=EXCLUDED.title, content=EXCLUDED.content, rating=EXCLUDED.rating,
           sentiment=EXCLUDED.sentiment, embedding=COALESCE(EXCLUDED.embedding, car_reviews.embedding)`,
        [r.id, r.modelId, r.source, r.title, r.content, r.rating, r.sentiment, r.publishedAt, emb ? JSON.stringify(emb) : null]
      );
    }
  }

  console.log("✅ 种子数据完成");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
