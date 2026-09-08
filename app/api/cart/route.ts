import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND = (
  process.env.WISHWISH_API_URL ||
  "https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws"
).replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") || "";
  const sessionId = url.searchParams.get("session_id") || "";
  if (!userId && !sessionId) {
    return Response.json({ error: "user_id or session_id required" }, { status: 400 });
  }
  const qs = new URLSearchParams();
  if (userId) qs.set("user_id", userId);
  if (sessionId) qs.set("session_id", sessionId);
  try {
    const res = await fetch(`${BACKEND}/v2/orders/me?${qs.toString()}`, {
      signal: AbortSignal.timeout(15_000),
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
    const msg = err instanceof Error ? err.message : "cart unreachable";
    return Response.json({ error: msg }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") || "";
  const sessionId = url.searchParams.get("session_id") || "";
  const name = url.searchParams.get("name") || "";
  const productUrl = url.searchParams.get("product_url") || "";
  const index = url.searchParams.get("index");
  const clear = url.searchParams.get("clear");

  if (!userId && !sessionId) {
    return Response.json({ error: "user_id or session_id required" }, { status: 400 });
  }

  const qs = new URLSearchParams();
  if (userId) qs.set("user_id", userId);
  if (sessionId) qs.set("session_id", sessionId);
  if (name) qs.set("name", name);
  if (productUrl) qs.set("product_url", productUrl);
  if (index !== null && index !== undefined) qs.set("index", index);

  const endpoint = clear === "1" || clear === "true" ? "/v2/orders/me/clear" : "/v2/orders/me/items";

  try {
    const res = await fetch(`${BACKEND}${endpoint}?${qs.toString()}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
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
    const msg = err instanceof Error ? err.message : "cart unreachable";
    return Response.json({ error: msg }, { status: 503 });
  }
}

