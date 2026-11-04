import { getCarDetail } from "@/src/tools/index";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getCarDetail(id);
  return Response.json(result, { status: result.ok ? 200 : 404 });
}
