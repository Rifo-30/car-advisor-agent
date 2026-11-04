// ============================================================
// RAG 检索层：优先 pgvector 语义检索，失败回退 BM25-lite 关键词检索
// 面试要点：
// 1) 关键词检索解决「精确术语」，向量检索解决「语义相近」；
// 2) 外部依赖失败必须能降级，不能把主流程拖垮。
// ============================================================
import OpenAI from "openai";
import type { Review } from "../types";
import { getAllReviews, searchReviewsVector } from "../db/repo";

/** 中文按 bigram 切分 + 英文/数字按单词切分（零依赖的轻量分词） */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const ascii = lower.match(/[a-z0-9]+/g) ?? [];
  const cn = lower.replace(/[^\u4e00-\u9fa5]/g, "");
  const bigrams: string[] = [];
  for (let i = 0; i < cn.length - 1; i++) bigrams.push(cn.slice(i, i + 2));
  if (cn.length === 1) bigrams.push(cn);
  return [...ascii, ...bigrams];
}

function score(queryTokens: string[], review: Review): number {
  const text = `${review.title} ${review.content} ${review.source}`;
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let s = 0;
  for (const q of new Set(queryTokens)) {
    const f = tf.get(q) ?? 0;
    if (f > 0) s += 1 + Math.log(f);
  }
  // 评分高的口碑略加分
  s += (review.rating - 3.5) * 0.3;
  return s;
}

export async function retrieveReviews(modelId: string, topic: string, topK = 3): Promise<Review[]> {
  // 1) 有 DB + key 时走 pgvector 语义检索
  if (process.env.DATABASE_URL && process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
      });
      const emb = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: topic,
      });
      const vectorHits = await searchReviewsVector(emb.data[0].embedding, topK);
      if (vectorHits.length) return vectorHits;
    } catch (err) {
      console.warn("[rag] 向量检索失败，回退关键词:", (err as Error).message);
    }
  }

  // 2) 回退：关键词打分
  const local = await getAllReviews(modelId);
  const qTokens = tokenize(topic);
  return local
    .map((r) => ({ r, s: score(qTokens, r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map((x) => x.r);
}
