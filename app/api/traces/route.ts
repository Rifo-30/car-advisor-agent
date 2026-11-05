// 最近的本地 trace 列表：GET /api/traces?limit=50
import { listLocalTraces } from "@/src/observability/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  return Response.json({ ok: true, traces: listLocalTraces(limit) });
}
