"use client";

import { FormEvent, useEffect, useState } from "react";
import "./shop.css";

type Offer = {
  site: string;
  title: string;
  price_sar: number | null;
  url: string;
  image_url: string;
};

type ProductDetail = {
  title: string;
  description: string;
  price_sar: number | null;
  image_url: string;
  error: string;
};

type ClarifyOption = { id: string; label: string };
type ClarifyGroup = {
  id: string;
  title: string;
  multi: boolean;
  options: ClarifyOption[];
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
  clarifying: boolean;
  optionGroups: ClarifyGroup[];
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

export default function CompareDesk() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeQuery, setActiveQuery] = useState("");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnSeq, setTurnSeq] = useState(1);
  const [sessionId, setSessionId] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [openOffer, setOpenOffer] = useState<Offer | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailCache, setDetailCache] = useState<Record<string, ProductDetail>>({});

  function resetHome() {
    setSearched(false);
    setOffers([]);
    setQuery("");
    setActiveQuery("");
    setTurns([]);
    setSessionId("");
    setPicked({});
    closeDetail();
  }

  function closeDetail() {
    setOpenOffer(null);
    setDetail(null);
    setDetailBusy(false);
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
      clarifying: false,
      optionGroups: [],
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
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, session_id: sessionId }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        patchTurn(id, { error: String(json.error || json.detail || json.message || "Something went wrong.") });
        return;
      }
      if (json.session_id) setSessionId(String(json.session_id));
      const nextOffers = Array.isArray(json.offers) ? (json.offers as Offer[]) : [];
      if (nextOffers.length) {
        setOffers(nextOffers);
        setActiveQuery(q);
        pushStep(`Found ${nextOffers.length} offers`);
      }
      if (json.action === "view_cart") {
        const site = STORE_NAME[String(json.site || "")] || String(json.site || "shop");
        patchTurn(id, {
          cartNote: String(json.message || `Cart on ${site}.`),
          cartSite: site,
        });
        pushStep(`In the ${site} cart`);
      }
      const groups = Array.isArray(json.option_groups)
        ? (json.option_groups as ClarifyGroup[])
        : [];
      if (json.clarifying && groups.length) {
        setPicked({});
        patchTurn(id, { clarifying: true, optionGroups: groups });
        pushStep("Pick options, then search");
      }
      const answer = String(json.message || "").trim();
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

  function toggleOption(group: ClarifyGroup, optionId: string) {
    setPicked((prev) => {
      const current = new Set(prev[group.id] || []);
      if (group.multi) {
        if (current.has(optionId)) current.delete(optionId);
        else {
          if (optionId.startsWith("any")) current.clear();
          else current.delete("any-brand");
          current.add(optionId);
        }
      } else if (current.has(optionId)) {
        current.clear();
      } else {
        current.clear();
        current.add(optionId);
      }
      return { ...prev, [group.id]: [...current] };
    });
  }

  function searchFromPicks(groups: ClarifyGroup[]) {
    const labels: string[] = [];
    for (const group of groups) {
      const ids = picked[group.id] || [];
      for (const id of ids) {
        const opt = group.options.find((o) => o.id === id);
        if (opt) labels.push(opt.label);
      }
    }
    const topic = lastTurn?.query?.trim() || "";
    const picks = labels.length ? labels.join(", ") : "any";
    const q =
      topic && !picks.toLowerCase().includes(topic.toLowerCase())
        ? `${topic}, ${picks}`
        : picks;
    void runAsk(q);
  }

  async function showOffer(offer: Offer) {
    setOpenOffer(offer);
    const cached = detailCache[offer.url];
    if (cached) {
      setDetail(cached);
      setDetailBusy(false);
      return;
    }
    setDetail(null);
    setDetailBusy(true);
    try {
      const res = await fetch("/api/product", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: offer.site, url: offer.url }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      const next: ProductDetail = {
        title: String(json.title || offer.title),
        description: String(json.description || ""),
        price_sar:
          typeof json.price_sar === "number"
            ? json.price_sar
            : offer.price_sar,
        image_url: String(json.image_url || offer.image_url || ""),
        error: res.ok ? "" : String(json.error || json.message || "Could not load details."),
      };
      if (res.ok && !next.description && !next.error) {
        next.error = "";
      }
      setDetailCache((prev) => ({ ...prev, [offer.url]: next }));
      setDetail(next);
    } catch {
      setDetail({
        title: offer.title,
        description: "",
        price_sar: offer.price_sar,
        image_url: offer.image_url,
        error: "Could not load the product page.",
      });
    } finally {
      setDetailBusy(false);
    }
  }

  const showHome = !searched && !busy;
  const lastError = turns.at(-1)?.error || "";
  const lastTurn = turns.at(-1);
  const clarifying = Boolean(lastTurn?.clarifying && lastTurn.optionGroups.length);
  const hasAnswer = turns.some((turn) => turn.answer || turn.cartNote);

  useEffect(() => {
    if (!openOffer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [openOffer]);

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
          <p className="eyebrow">Riyadh · live shop prices · COD</p>
          <h1>Find it. Compare it. Pick the best price.</h1>
          <p className="hero-lead">
            We search Ninja, Tamimi, Panda, Danube, and Carrefour, then you pick. Click a card for the shop description.
          </p>
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
              Compare
            </button>
          </form>
          <div className="suggest">
            {SUGGESTIONS.map((item) => (
              <button key={item} type="button" onClick={() => void runAsk(item)}>
                {item}
              </button>
            ))}
          </div>
          <p className="stores">Ninja · Tamimi · Panda · Danube · Carrefour</p>
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

          {clarifying && lastTurn && (
            <div className="clarify">
              {lastTurn.optionGroups.map((group) => (
                <div key={group.id} className="clarify-group">
                  <p>
                    {group.title}
                    {group.multi ? <span> · pick several</span> : <span> · pick one</span>}
                  </p>
                  <div className="clarify-chips">
                    {group.options.map((opt) => {
                      const on = (picked[group.id] || []).includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={on ? "is-on" : ""}
                          disabled={busy}
                          onClick={() => toggleOption(group, opt.id)}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="clarify-go"
                disabled={busy}
                onClick={() => searchFromPicks(lastTurn.optionGroups)}
              >
                Search shops
              </button>
            </div>
          )}

          {!busy && !clarifying && turns.length > 0 && (
            <div className="suggest followups">
              {FOLLOWUPS.map((item) => (
                <button key={item} type="button" onClick={() => void runAsk(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}

          {busy && offers.length === 0 && !clarifying && (
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
                <p>Tap a product to read the shop description. Nothing opens in a new tab.</p>
              </div>
              <div className="grid">
                {offers.map((offer, i) => (
                  <button
                    key={`${offer.site}-${offer.url}-${i}`}
                    type="button"
                    className={`product ${i === 0 ? "is-best" : ""}`}
                    onClick={() => void showOffer(offer)}
                  >
                    {i === 0 && <span className="badge">Best match</span>}
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
                      <span className="peek">View details</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {!busy && !lastError && offers.length === 0 && !hasAnswer && !clarifying && (
            <div className="shelf-head">
              <h2>No results for “{activeQuery || turns.at(-1)?.query}”</h2>
            </div>
          )}
        </section>
      )}

      {openOffer && (
        <div className="drawer-back" onClick={closeDetail} role="presentation">
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="drawer-x" onClick={closeDetail} aria-label="Close">
              Close
            </button>
            <div className="drawer-photo">
              {(detail?.image_url || openOffer.image_url) ? (
                <img
                  src={detail?.image_url || openOffer.image_url}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <em>No photo</em>
              )}
            </div>
            <p className="store">{STORE_NAME[openOffer.site] || openOffer.site}</p>
            <h3 id="drawer-title">{detail?.title || openOffer.title}</h3>
            {(detail?.price_sar ?? openOffer.price_sar) != null && (
              <p className="cost">
                {Number(detail?.price_sar ?? openOffer.price_sar).toFixed(2)} <small>SAR</small>
              </p>
            )}
            {detailBusy && <p className="drawer-wait">Reading the shop page…</p>}
            {!detailBusy && detail?.error && <p className="agent-error">{detail.error}</p>}
            {!detailBusy && detail && !detail.description && !detail.error && (
              <p className="drawer-wait">No description on the shop page.</p>
            )}
            {!detailBusy && detail?.description && (
              <p className="drawer-copy">{detail.description}</p>
            )}
            <div className="drawer-actions">
              <button
                type="button"
                className="clarify-go"
                disabled={busy}
                onClick={() => {
                  const title = detail?.title || openOffer.title;
                  closeDetail();
                  void runAsk(`Add ${title} to ${openOffer.site} cart`);
                }}
              >
                Add to {STORE_NAME[openOffer.site] || openOffer.site} cart
              </button>
            </div>
          </aside>
        </div>
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
