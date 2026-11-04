import { compareCars } from "@/src/tools/index";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const modelIds = Array.isArray(body.modelIds) ? body.modelIds.map(String) : [];
  const result = await compareCars(modelIds);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
