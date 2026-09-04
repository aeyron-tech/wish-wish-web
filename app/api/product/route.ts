import { NextRequest } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BACKEND = (
  process.env.WISHWISH_API_URL ||
  "https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws"
).replace(/\/$/, "");
const TOKEN = process.env.WISHWISH_TOKEN || "test";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  const site = String(body.site || "").trim();
  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${BACKEND}/v2/product`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, url, site: site || undefined }),
      signal: AbortSignal.timeout(55_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return Response.json(
        { error: String(json.detail || json.error || json.message || `HTTP ${res.status}`) },
        { status: res.status },
      );
    }
    const data = (json.data || {}) as Record<string, unknown>;
    return Response.json({
      success: Boolean(json.success),
      message: String(json.message || ""),
      site: String(data.site || site),
      url: String(data.url || url),
      title: String(data.title || ""),
      price_sar: data.price_sar ?? null,
      description: String(data.description || ""),
      image_url: String(data.image_url || ""),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Wish Wish API is not reachable.";
    return Response.json({ error: msg }, { status: 503 });
  }
}
