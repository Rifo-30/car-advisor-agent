// 历史会话列表：GET /api/sessions?limit=50（仅当前用户）
import { listSessions } from "@/src/db/repo";
import { hasDb } from "@/src/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasDb()) {
    return Response.json({ ok: true, sessions: [], note: "未配置 DATABASE_URL，当前为内存模式" });
  }
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const userId = String(req.headers.get("x-user-id") || "anonymous");
  const sessions = await listSessions(limit, userId);
  return Response.json({ ok: true, sessions });
}
