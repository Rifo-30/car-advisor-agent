// 读取某个会话的完整对话历史（仅限会话所有者）
import { getSessionState } from "@/src/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = String(req.headers.get("x-user-id") || "anonymous");

  const state = await getSessionState(id);
  if (!state) return Response.json({ ok: false, error: "session not found" }, { status: 404 });

  // ⭐ 防越权：只有会话所有者能读
  if ((state.userId ?? "anonymous") !== userId) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  return Response.json({ ok: true, session: state });
}
