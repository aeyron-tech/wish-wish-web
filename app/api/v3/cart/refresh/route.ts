import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND = (
  process.env.WISHWISH_API_URL ||
  "https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws"
).replace(/\/$/, "");

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  try {
    const res = await fetch(`${BACKEND}/v3/cart/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json({ error: text.slice(0, 200) || "bad response" }, { status: 502 });
    }
    return Response.json(json, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "cart refresh unreachable";
    return Response.json({ error: msg }, { status: 503 });
  }
}
