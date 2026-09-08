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
  const since = url.searchParams.get("since") || "0";
  if (!userId && !sessionId) {
    return Response.json({ error: "user_id or session_id required" }, { status: 400 });
  }
  const qs = new URLSearchParams();
  if (userId) qs.set("user_id", userId);
  if (sessionId) qs.set("session_id", sessionId);
  qs.set("since", since);
  try {
    const res = await fetch(`${BACKEND}/v2/chat/me/messages?${qs.toString()}`, {
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
    const msg = err instanceof Error ? err.message : "messages unreachable";
    return Response.json({ error: msg }, { status: 503 });
  }
}
