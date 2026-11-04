// 读取某个会话的完整对话历史（用于刷新后恢复）
import { getSessionState } from "@/src/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await getSessionState(id);
  if (!state) return Response.json({ ok: false, error: "session not found" }, { status: 404 });
  return Response.json({ ok: true, session: state });
}
