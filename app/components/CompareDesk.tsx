"use client";

import { FormEvent, useState } from "react";
import "./shop.css";

type Offer = {
  site: string;
  title: string;
  price_sar: number | null;
  url: string;
  image_url: string;
};

type Step = { id: number; text: string };

type Turn = {
  id: number;
  query: string;
  steps: Step[];
  answer: string;
  cartNote: string;
  cartShot: string;
  cartSite: string;
  error: string;
};

const STORE_NAME: Record<string, string> = {
  ninja: "Ninja",
  tamimi: "Tamimi",
  panda: "Panda",
  danube: "Danube",
  carrefour: "Carrefour",
};

const SUGGESTIONS = ["Milk 1L", "Eggs", "What do you need from me to order?"];
const FOLLOWUPS = [
  "Add the cheapest 1 litre to cart",
  "What does it need to do checkout?",
  "Prefer a single 1L carton",
];

function describeTool(name: string, kwargs: Record<string, unknown>): string {
  if (name === "search_groceries") {
    const q = String(kwargs.query || "").trim();
    return q ? `Searching shops for “${q}”` : "Searching shops";
  }
  if (name === "add_grocery_to_cart") {
    const site = STORE_NAME[String(kwargs.site || "")] || String(kwargs.site || "shop");
    return `Adding to ${site} cart`;
  }
  if (name === "get_order_requirements") {
    return "Checking what each shop needs from you";
  }
  return name;
}

async function readAgentStream(
  res: Response,
  onEvent: (ev: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error("No stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
      } catch {
        /* ignore a truncated JSON frame */
      }
    }
  }
}

export default function CompareDesk() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeQuery, setActiveQuery] = useState("");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnSeq, setTurnSeq] = useState(1);
  const [sessionId, setSessionId] = useState("");

  function resetHome() {
    setSearched(false);
    setOffers([]);
    setQuery("");
    setActiveQuery("");
    setTurns([]);
    setSessionId("");
  }

  function patchTurn(id: number, patch: Partial<Turn> | ((prev: Turn) => Turn)) {
    setTurns((prev) =>
      prev.map((turn) => {
        if (turn.id !== id) return turn;
        return typeof patch === "function" ? patch(turn) : { ...turn, ...patch };
      }),
    );
  }

  async function runAsk(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    const history = turns
      .filter((turn) => turn.answer)
      .slice(-6)
      .flatMap((turn) => [
        { role: "user", content: turn.query },
        { role: "assistant", content: turn.answer },
      ]);
    const id = turnSeq;
    setTurnSeq((n) => n + 1);
    const next: Turn = {
      id,
      query: q,
      steps: [],
      answer: "",
      cartNote: "",
      cartShot: "",
      cartSite: "",
      error: "",
    };
    setTurns((prev) => [...prev, next]);
    setQuery("");
    setBusy(true);
    setSearched(true);
    let stepId = 1;
    const pushStep = (text: string) => {
      const sid = stepId;
      stepId += 1;
      patchTurn(id, (turn) => ({
        ...turn,
        steps: [...turn.steps, { id: sid, text }],
      }));
    };
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, history, session_id: sessionId }),
      });
      if (!res.ok) {
        patchTurn(id, { error: "Something went wrong. Please try again." });
        return;
      }
      await readAgentStream(res, (ev) => {
        const type = String(ev.type || "");
        if (type === "session" && ev.session_id) setSessionId(String(ev.session_id));
        if (type === "status" && ev.text) pushStep(String(ev.text));
        if (type === "tool") {
          pushStep(describeTool(String(ev.name || ""), (ev.kwargs || {}) as Record<string, unknown>));
        }
        if (type === "offers" && Array.isArray(ev.offers)) {
          setOffers(ev.offers as Offer[]);
          setActiveQuery(q);
        }
        if (type === "cart") {
          const result = (ev.result || {}) as Record<string, unknown>;
          const site = STORE_NAME[String(result.site || "")] || String(result.site || "");
          if (result.ok) {
            const shot =
              typeof result.screenshot === "string" && result.screenshot.startsWith("data:")
                ? result.screenshot
                : "";
            patchTurn(id, {
              cartNote: `Added to ${site} cart. Stopped before checkout.`,
              cartShot: shot,
              cartSite: site,
            });
            pushStep(`In the ${site} cart`);
          } else {
            patchTurn(id, { cartNote: String(result.error || "Could not add to cart.") });
            pushStep("Cart add failed");
          }
        }
        if (type === "answer" && ev.text) patchTurn(id, { answer: String(ev.text) });
        if (type === "error" && ev.text) patchTurn(id, { error: String(ev.text) });
      });
    } catch {
      patchTurn(id, { error: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runAsk(query);
  }

  const showHome = !searched && !busy;
  const lastError = turns.at(-1)?.error || "";
  const hasAnswer = turns.some((turn) => turn.answer || turn.cartNote);

  return (
    <div className={`market ${showHome ? "is-home" : "is-results"}`}>
      <header className="market-bar">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            if (searched) {
              e.preventDefault();
              resetHome();
            }
          }}
        >
          Wish <span>Wish</span>
        </a>
        {!showHome && (
          <form className="search search-bar" onSubmit={onSubmit}>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a follow-up, or search again…"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !query.trim()}>
              {busy ? "Working" : "Go"}
            </button>
          </form>
        )}
      </header>

      {showHome && (
        <section className="hero">
          <p className="eyebrow">Riyadh groceries</p>
          <h1>Find it. Compare it. Pick the best price.</h1>
          <form className="search search-hero" onSubmit={onSubmit}>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you need today?"
              disabled={busy}
              autoFocus
            />
            <button type="submit" disabled={busy || !query.trim()}>
              Go
            </button>
          </form>
          <div className="suggest">
            {SUGGESTIONS.map((item) => (
              <button key={item} type="button" onClick={() => void runAsk(item)}>
                {item}
              </button>
            ))}
          </div>
          <p className="suggest-hint">Then follow up: add the cheapest to cart, or ask what each shop needs from you.</p>
        </section>
      )}

      {!showHome && (
        <section className="shelf">
          {turns.length > 0 && (
            <div className="thread">
              {turns.map((turn, i) => (
                <article key={turn.id} className="agent">
                  <p className="agent-ask">{turn.query}</p>
                  <div className="agent-steps">
                    {turn.steps.map((step) => (
                      <span key={`${turn.id}-step-${step.id}`} className="agent-step">
                        {step.text}
                      </span>
                    ))}
                    {busy && i === turns.length - 1 && (
                      <span className="agent-step is-live">Working…</span>
                    )}
                  </div>
                  {turn.cartNote && <p className="agent-cart">{turn.cartNote}</p>}
                  {turn.cartShot && (
                    <figure className="agent-shot">
                      <div className="agent-shot-frame">
                        <img src={turn.cartShot} alt={`Cart on ${turn.cartSite || "the shop"} after add`} />
                      </div>
                      <figcaption>
                        {turn.cartSite || "Shop"} cart · no checkout
                      </figcaption>
                    </figure>
                  )}
                  {turn.answer && <p className="agent-answer">{turn.answer}</p>}
                  {turn.error && <p className="agent-error">{turn.error}</p>}
                </article>
              ))}
            </div>
          )}

          {!busy && turns.length > 0 && (
            <div className="suggest followups">
              {FOLLOWUPS.map((item) => (
                <button key={item} type="button" onClick={() => void runAsk(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}

          {busy && offers.length === 0 && (
            <div className="grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="product skeleton" />
              ))}
            </div>
          )}

          {offers.length > 0 && (
            <>
              <div className="shelf-head">
                <h2>
                  {offers.length} results
                  {activeQuery ? ` for “${activeQuery}”` : ""}
                </h2>
              </div>
              <div className="grid">
                {offers.map((offer, i) => (
                  <a
                    key={`${offer.site}-${offer.url}-${i}`}
                    className="product"
                    href={offer.url || undefined}
                    target={offer.url ? "_blank" : undefined}
                    rel="noreferrer"
                  >
                    <div className="photo">
                      {offer.image_url ? (
                        <img src={offer.image_url} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <em>No photo</em>
                      )}
                    </div>
                    <div className="meta">
                      <span className="store">{STORE_NAME[offer.site] || offer.site}</span>
                      <strong>{offer.title}</strong>
                      {offer.price_sar != null && (
                        <span className="cost">
                          {Number(offer.price_sar).toFixed(2)} <small>SAR</small>
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}

          {!busy && !lastError && offers.length === 0 && !hasAnswer && (
            <div className="shelf-head">
              <h2>No results for “{activeQuery || turns.at(-1)?.query}”</h2>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.2 16.2 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
