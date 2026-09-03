import { NextRequest } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BACKEND =
  process.env.WISHWISH_API_URL ||
  "https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws";
const TOKEN = process.env.WISHWISH_TOKEN || "test";

function sse(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function productsToOffers(products: unknown): Array<Record<string, unknown>> {
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

function cartNote(inner: Record<string, unknown>): { ok: boolean; site: string; error?: string } {
  const site = String(inner.site || "");
  const items = Array.isArray(inner.items) ? inner.items : [];
  const carts = Array.isArray(inner.carts) ? inner.carts : [];
  if (inner.ok === false) {
    return { ok: false, site, error: String(inner.error || inner.message || "Could not add to cart.") };
  }
  if (items.length || carts.length) {
    return { ok: true, site: site || (carts[0] as { site?: string })?.site || "" };
  }
  return { ok: true, site };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query = String(body.query || body.message || "").trim();
  const sessionId = String(body.session_id || "").trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(sse(obj)));
      try {
        send({ type: "status", text: "Talking to Wish Wish API" });
        const res = await fetch(`${BACKEND.replace(/\/$/, "")}/v2/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: TOKEN,
            message: query,
            session_id: sessionId || undefined,
          }),
          signal: AbortSignal.timeout(280_000),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          send({
            type: "error",
            text: String((json as { detail?: unknown }).detail || json.message || `HTTP ${res.status}`),
          });
          send({ type: "done" });
          controller.close();
          return;
        }

        const data = (json.data || {}) as Record<string, unknown>;
        const turn = (data.response || {}) as Record<string, unknown>;
        const inner = (turn.data || {}) as Record<string, unknown>;
        if (data.session_id) send({ type: "session", session_id: data.session_id });

        const offers = productsToOffers(inner.products);
        if (offers.length) send({ type: "offers", offers });

        if (turn.action === "view_cart") {
          send({ type: "cart", result: cartNote(inner) });
        }

        const answer = String(turn.message || json.message || "").trim();
        if (answer) send({ type: "answer", text: answer });
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          text: err instanceof Error ? err.message : "Wish Wish API is not reachable.",
        });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}
