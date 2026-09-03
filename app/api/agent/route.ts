import { NextRequest } from "next/server";

export const maxDuration = 180;
export const dynamic = "force-dynamic";

const BACKEND = (
  process.env.WISHWISH_API_URL ||
  "https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws"
).replace(/\/$/, "");
const TOKEN = process.env.WISHWISH_TOKEN || "test";

function asOffers(products: unknown) {
  if (!Array.isArray(products)) return [];
  return products.map((raw) => {
    const p = (raw || {}) as Record<string, unknown>;
    const price = p.price ?? p.price_sar ?? p.sale_price;
    return {
      site: String(p.site || ""),
      title: String(p.name || p.title || ""),
      price_sar: typeof price === "number" ? price : price != null ? Number(price) : null,
      url: String(p.url || ""),
      image_url: String(p.image || p.image_url || ""),
    };
  });
}

function timeoutMessage() {
  return "Search timed out. Try a specific product (e.g. milk 1 litre).";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query = String(body.query || body.message || "").trim();
  const sessionId = String(body.session_id || "").trim();

  try {
    const res = await fetch(`${BACKEND}/v2/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: TOKEN,
        message: query,
        session_id: sessionId || undefined,
      }),
      signal: AbortSignal.timeout(170_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: res.status === 504 ? timeoutMessage() : text.slice(0, 200) || timeoutMessage() },
        { status: res.status === 504 ? 504 : 502 },
      );
    }
    if (!res.ok) {
      const detail = String(
        (json as { detail?: unknown }).detail || json.message || json.error || `HTTP ${res.status}`,
      );
      return Response.json(
        { error: res.status === 504 ? timeoutMessage() : detail },
        { status: res.status },
      );
    }
    const data = (json.data || {}) as Record<string, unknown>;
    const turn = (data.response || {}) as Record<string, unknown>;
    const inner = (turn.data || {}) as Record<string, unknown>;
    return Response.json({
      session_id: data.session_id || null,
      offers: asOffers(inner.products),
      action: turn.action || null,
      site: inner.site || null,
      message: String(turn.message || "").trim(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Wish Wish API is not reachable.";
    const timedOut = /timeout|aborted|504/i.test(msg);
    return Response.json(
      { error: timedOut ? timeoutMessage() : msg },
      { status: timedOut ? 504 : 503 },
    );
  }
}
