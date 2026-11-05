import { getTrace } from "@/src/observability/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trace = await getTrace(id);
  if (!trace) return Response.json({ error: "trace not found" }, { status: 404 });
  return Response.json(trace);
}
