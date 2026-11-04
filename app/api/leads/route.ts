import { createTestDriveLead } from "@/src/tools/index";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await createTestDriveLead({
    sessionId: String(body.sessionId ?? ""),
    modelId: String(body.modelId ?? ""),
    city: String(body.city ?? "北京"),
    phone: String(body.phone ?? ""),
    confirmed: Boolean(body.confirmed),
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
