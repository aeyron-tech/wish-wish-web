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

const API = (
  process.env.NEXT_PUBLIC_WISHWISH_API_URL ||
  "https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws"
).replace(/\/$/, "");
const TOKEN = process.env.NEXT_PUBLIC_WISHWISH_TOKEN || "test";

function asOffers(products: unknown): Offer[] {
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
      pushStep("Talking to Wish Wish API");
      const res = await fetch(`${API}/v2/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: TOKEN,
          message: q,
          session_id: sessionId || undefined,
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        patchTurn(id, { error: String(json.detail || json.message || "Something went wrong.") });
        return;
      }
      const data = (json.data || {}) as Record<string, unknown>;
      const turn = (data.response || {}) as Record<string, unknown>;
      const inner = (turn.data || {}) as Record<string, unknown>;
      if (data.session_id) setSessionId(String(data.session_id));
      const nextOffers = asOffers(inner.products);
      if (nextOffers.length) {
        setOffers(nextOffers);
        setActiveQuery(q);
        pushStep(`Found ${nextOffers.length} offers`);
      }
      if (turn.action === "view_cart") {
        const site = STORE_NAME[String(inner.site || "")] || String(inner.site || "shop");
        patchTurn(id, {
          cartNote: String(turn.message || `Cart on ${site}.`),
          cartSite: site,
        });
        pushStep(`In the ${site} cart`);
      }
      const answer = String(turn.message || "").trim();
      if (answer) patchTurn(id, { answer });
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
          href={(process.env.NEXT_PUBLIC_BASE_PATH || "") + "/"}
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
