"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import "./shop.css";

export type Offer = {
  site: string;
  title: string;
  price_sar: number | null;
  url: string;
  image_url: string;
};

export type ProductDetail = {
  title: string;
  description: string;
  price_sar: number | null;
  image_url: string;
  error: string;
};

export type ClarifyOption = { id: string; label: string };
export type ClarifyGroup = {
  id: string;
  title: string;
  multi: boolean;
  options: ClarifyOption[];
};

export type Step = { id: number; text: string };

export type CartItem = {
  name?: string;
  qty?: number;
  price_sar?: number;
  site?: string;
  product_url?: string;
  image_url?: string;
};

export type MyOrder = {
  id: string;
  site: string;
  status: string;
  fulfillment: string;
  total_sar: number | null;
  items: CartItem[];
  updated_at?: string;
  missing_fields?: string[];
  ask_message?: string;
  ask_customer_now?: boolean;
  is_pickup?: boolean;
} | null;

export type Turn = {
  id: number;
  query: string;
  steps: Step[];
  answer: string;
  offers?: Offer[];
  cartNote: string;
  cartShot: string;
  cartSite: string;
  error: string;
  clarifying: boolean;
  optionGroups: ClarifyGroup[];
  createdAt?: number;
  responseCreatedAt?: number;
};

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
  turns: Turn[];
};

const USER_ID_KEY = "wishwish.user_id";
const THREADS_STORAGE_KEY = "wishwish.threads.v2";
const ACTIVE_THREAD_ID_KEY = "wishwish.active_thread_id.v2";

const STORE_NAME: Record<string, string> = {
  ninja: "Ninja",
  tamimi: "Tamimi",
  panda: "Panda",
  danube: "Danube",
  carrefour: "Carrefour",
};

function cartShopLabel(cart: MyOrder): string {
  const names = [
    ...new Set(
      (cart?.items || [])
        .map((i) => STORE_NAME[String(i.site || "")] || String(i.site || "").trim())
        .filter(Boolean),
    ),
  ];
  if (names.length) return names.join(" · ");
  return STORE_NAME[cart?.site || ""] || cart?.site || "Cart";
}

function coerceCartItem(item: CartItem & { price?: number; quantity?: number; url?: string; image?: string }): CartItem {
  const price =
    typeof item.price_sar === "number"
      ? item.price_sar
      : typeof item.price === "number"
        ? item.price
        : undefined;
  return {
    ...item,
    qty: item.qty ?? item.quantity ?? 1,
    price_sar: price,
    product_url: item.product_url || item.url || "",
    image_url: item.image_url || item.image || "",
  };
}

function coerceCartOrder(raw: MyOrder): MyOrder {
  if (!raw) return raw;
  const items = (raw.items || []).map((item) => coerceCartItem(item));
  const priced = items.every((i) => typeof i.price_sar === "number");
  const total = priced
    ? Math.round(items.reduce((s, i) => s + (i.price_sar as number) * (i.qty ?? 1), 0) * 100) / 100
    : raw.total_sar;
  return { ...raw, items, total_sar: total };
}

const SUGGESTIONS = [
  { label: "🥛 Fresh Milk 1L", prompt: "Milk 1L - find the best price" },
  { label: "🥚 Farm Eggs (30 pack)", prompt: "Fresh eggs 30 pack lowest price" },
  { label: "🍞 Sliced Bread", prompt: "Fresh sliced bread best deal" },
  { label: "🛒 What do you need to order?", prompt: "What do you need from me to order groceries?" },
];

const FOLLOWUPS = [
  "Add the cheapest to cart",
  "What does it need to do checkout?",
  "Check prices at Carrefour vs Danube",
  "Show my current cart",
];

function generateThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createNewThread(initialTitle: string = "New chat"): ChatThread {
  return {
    id: generateThreadId(),
    title: initialTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId: "",
    turns: [],
  };
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default function CompareDesk() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [inputQuery, setInputQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnSeq, setTurnSeq] = useState(1);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [openOffer, setOpenOffer] = useState<Offer | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailCache, setDetailCache] = useState<Record<string, ProductDetail>>({});
  const [userId, setUserId] = useState("");
  const [cart, setCart] = useState<MyOrder>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set());
  const [pushCursor, setPushCursor] = useState(0);
  const [fetchingLocation, setFetchingLocation] = useState(false);

  const activeThreadIdRef = useRef<string>("");
  const threadsRef = useRef<ChatThread[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep refs in sync for asynchronous operations
  activeThreadIdRef.current = activeThreadId;
  threadsRef.current = threads;

  // 1. Initialize user ID
  useEffect(() => {
    try {
      let existing = window.localStorage.getItem(USER_ID_KEY) || "";
      if (!existing) {
        existing =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `web-${crypto.randomUUID()}`
            : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        window.localStorage.setItem(USER_ID_KEY, existing);
      }
      setUserId(existing);
    } catch {}
  }, []);

  // 2. Load threads from localStorage on initial render
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THREADS_STORAGE_KEY);
      let parsedThreads: ChatThread[] = [];
      if (stored) {
        try {
          parsedThreads = JSON.parse(stored);
        } catch {
          parsedThreads = [];
        }
      }

      if (!Array.isArray(parsedThreads) || parsedThreads.length === 0) {
        const fresh = createNewThread();
        parsedThreads = [fresh];
      }

      let activeId = window.localStorage.getItem(ACTIVE_THREAD_ID_KEY) || "";
      if (!activeId || !parsedThreads.some((t) => t.id === activeId)) {
        activeId = parsedThreads[0].id;
      }

      setThreads(parsedThreads);
      setActiveThreadId(activeId);
      activeThreadIdRef.current = activeId;
      threadsRef.current = parsedThreads;

      let maxId = 1;
      for (const t of parsedThreads) {
        for (const turn of t.turns) {
          if (turn.id >= maxId) maxId = turn.id + 1;
        }
      }
      setTurnSeq(maxId);
    } catch {
      const fresh = createNewThread();
      setThreads([fresh]);
      setActiveThreadId(fresh.id);
      activeThreadIdRef.current = fresh.id;
      threadsRef.current = [fresh];
    }
  }, []);

  // Active thread computations
  const effectiveActiveId = activeThreadId || (threads[0]?.id ?? "");
  const activeThread = threads.find((t) => t.id === effectiveActiveId) || threads[0];
  const activeTurns = activeThread?.turns || [];
  const sessionId = activeThread?.sessionId || "";

  // Helper to persist updated threads cleanly
  const updateAndPersistThreads = (
    updater: (prev: ChatThread[]) => ChatThread[],
    newActiveId?: string,
  ) => {
    setThreads((prev) => {
      const next = updater(prev);
      threadsRef.current = next;
      try {
        window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

    if (newActiveId !== undefined) {
      setActiveThreadId(newActiveId);
      activeThreadIdRef.current = newActiveId;
      try {
        window.localStorage.setItem(ACTIVE_THREAD_ID_KEY, newActiveId);
      } catch {}
    }
  };

  // Scroll to bottom when turns update or bot is busy
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeTurns, busy]);

  // Adjust textarea height dynamically
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputQuery]);

  // Close modals on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openOffer) closeDetail();
        if (cartOpen) setCartOpen(false);
        if (mobileSidebarOpen) setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openOffer, cartOpen, mobileSidebarOpen]);

  function _addKey(offer: Offer): string {
    return `${offer.site}::${offer.url || offer.title}`;
  }

  async function quickAddToCart(offer: Offer): Promise<boolean> {
    const key = _addKey(offer);
    if (addingKeys.has(key)) return true;

    // 1. Open the drawer AND drop an optimistic line before the network call
    // fires — the user sees the item land the instant they click Add.
    setCartOpen(true);
    setAddingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    // 1b. Mirror the click into the chat so the user sees the add there too.
    const siteLabel = STORE_NAME[offer.site] || offer.site || "shop";
    const chatTurnId = appendCartTurn(
      `Add "${offer.title}" to ${siteLabel} cart`,
      `Adding to ${siteLabel} cart…`,
      offer.site,
    );

    const optimisticItem: CartItem = {
      name: offer.title,
      qty: 1,
      site: offer.site,
      price_sar: offer.price_sar ?? undefined,
      image_url: offer.image_url,
      product_url: offer.url,
    };
    setCart((prev) => {
      const existing = prev?.items || [];
      let matched = false;
      const items = existing.map((i) => {
        const sameSite = (i.site || prev?.site) === offer.site;
        const isSame =
          sameSite &&
          ((i.product_url && i.product_url === offer.url) || i.name === offer.title);
        if (isSame) {
          matched = true;
          return {
            ...i,
            site: i.site || offer.site,
            image_url: i.image_url || optimisticItem.image_url,
            price_sar: i.price_sar ?? optimisticItem.price_sar,
          };
        }
        return i;
      });
      const finalItems = matched ? items : [...items, optimisticItem];
      const total = finalItems.every((i) => typeof i.price_sar === "number")
        ? Math.round(finalItems.reduce((s, i) => s + (i.price_sar as number) * (i.qty ?? 1), 0) * 100) / 100
        : prev?.total_sar ?? (offer.price_sar != null ? offer.price_sar : null);
      return {
        id: prev?.id || "pending",
        site: prev?.site || offer.site,
        status: prev?.status || "collecting",
        fulfillment: "delivery",
        total_sar: total,
        items: finalItems,
        ask_customer_now: true,
        is_pickup: false,
        missing_fields: prev?.missing_fields,
        ask_message: prev?.ask_message,
      };
    });

    // 2. Route the add through the chat agent so it can add to the shared cart
    // and only ask for delivery fields still missing (saved details are reused).
    try {
      const chatMessage = `Add "${offer.title}" from ${siteLabel} to my cart.`;
      const res = await fetch(`/api/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: chatMessage,
          session_id: sessionId || undefined,
          user_id: userId || undefined,
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        setCart((prev) =>
          prev
            ? {
                ...prev,
                items: (prev.items || []).filter((i) => {
                  const sameSite = (i.site || prev.site) === offer.site;
                  if (!sameSite) return true;
                  if (i.product_url && i.product_url === offer.url) return false;
                  if (!i.product_url && i.name === offer.title) return false;
                  return true;
                }),
              }
            : prev,
        );
        const errText = String(
          json.error || json.detail || json.message || "Could not add to cart.",
        );
        patchActiveTurn(chatTurnId, { cartNote: "", error: errText });
        return false;
      }

      // Persist the session id the backend created for this add so subsequent
      // chat turns land on the same conversation.
      if (json.session_id) {
        const sid = String(json.session_id);
        const targetThreadId = activeThreadIdRef.current;
        setThreads((prevThreads) => {
          const nextThreads = prevThreads.map((t) =>
            t.id === targetThreadId ? { ...t, sessionId: sid } : t,
          );
          threadsRef.current = nextThreads;
          try {
            window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
          } catch {}
          return nextThreads;
        });
      }

      // The agent's answer typically includes "Added … Please share name,
      // mobile, district, …" — surface it verbatim in the alert row so the
      // user sees the follow-up questions in chat. Leave `answer` empty so
      // the same text doesn't render twice (bubble + alert).
      const agentAnswer = String(json.message || "").trim();
      patchActiveTurn(chatTurnId, {
        cartNote: agentAnswer || `Added "${offer.title}" to your ${siteLabel} cart.`,
        cartSite: siteLabel,
      });

      // Persist image / url / price onto the shared cart even if the chat
      // agent path stored a bare name-only line.
      try {
        await fetch(`/api/v3/cart/add`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId || json.session_id || undefined,
            user_id: userId || undefined,
            site: offer.site,
            query: offer.title,
            offer: {
              name: offer.title,
              site: offer.site,
              price_sar: offer.price_sar,
              price: offer.price_sar,
              image_url: offer.image_url,
              image: offer.image_url,
              url: offer.url,
              product_url: offer.url,
            },
          }),
        });
      } catch {
        // Non-fatal — cart drawer may miss the photo until next add.
      }

      void refreshCart();
      return true;
    } catch {
      patchActiveTurn(chatTurnId, { cartNote: "", error: "Could not reach the shop. Try again." });
      return false;
    } finally {
      setAddingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function clearCart() {
    setCartBusy(true);
    // Optimistically empty the drawer so it feels instant.
    setCart(null);
    try {
      await fetch(`/api/v3/cart/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId || undefined,
          user_id: userId || undefined,
        }),
      });
      await refreshCart();
    } catch {
      // Ignore — refreshCart on next interaction will re-sync.
    } finally {
      setCartBusy(false);
    }
  }

  async function refreshCart() {
    setCartBusy(true);
    try {
      const qs = new URLSearchParams();
      if (userId) qs.set("user_id", userId);
      if (sessionId) qs.set("session_id", sessionId);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await fetch(`/api/cart${suffix}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        return;
      }
      const raw = (json.data || null) as MyOrder;
      if (raw && raw.id) {
        setCart(coerceCartOrder(raw));
      } else if (addingKeys.size === 0) {
        setCart(null);
      }
    } catch {
      // Network hiccup — keep whatever we already have on screen.
    } finally {
      setCartBusy(false);
    }
  }

  useEffect(() => {
    void refreshCart();
    // One shared cart for the whole app — load it as soon as the desk mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function removeCartItem(item: CartItem, index: number) {
    if (removingIndex !== null) return;
    setRemovingIndex(index);
    try {
      const qs = new URLSearchParams();
      if (userId) qs.set("user_id", userId);
      if (sessionId) qs.set("session_id", sessionId);
      if (item.product_url) qs.set("product_url", item.product_url);
      if (item.name) qs.set("name", item.name);
      qs.set("index", String(index));

      const res = await fetch(`/api/cart?${qs.toString()}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok && json.data) {
        const updated = json.data as MyOrder;
        setCart(updated && updated.id ? coerceCartOrder(updated) : null);
      } else {
        await refreshCart();
      }
    } catch {
      await refreshCart();
    } finally {
      setRemovingIndex(null);
    }
  }

  function handleCreateNewThread() {
    const fresh = createNewThread();
    updateAndPersistThreads((prev) => [fresh, ...prev], fresh.id);
    setInputQuery("");
    setPicked({});
    setMobileSidebarOpen(false);
  }

  function handleSelectThread(id: string) {
    setActiveThreadId(id);
    activeThreadIdRef.current = id;
    setPicked({});
    setMobileSidebarOpen(false);
    try {
      window.localStorage.setItem(ACTIVE_THREAD_ID_KEY, id);
    } catch {}
  }

  function handleDeleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    updateAndPersistThreads((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fresh = createNewThread();
        setActiveThreadId(fresh.id);
        activeThreadIdRef.current = fresh.id;
        try {
          window.localStorage.setItem(ACTIVE_THREAD_ID_KEY, fresh.id);
        } catch {}
        return [fresh];
      }
      const nextActiveId = activeThreadIdRef.current === id ? remaining[0].id : activeThreadIdRef.current;
      setActiveThreadId(nextActiveId);
      activeThreadIdRef.current = nextActiveId;
      try {
        window.localStorage.setItem(ACTIVE_THREAD_ID_KEY, nextActiveId);
      } catch {}
      return remaining;
    });
  }

  function appendCartTurn(query: string, note: string, site: string): number {
    const targetThreadId = activeThreadIdRef.current;
    const id = turnSeq;
    setTurnSeq((n) => n + 1);
    const siteLabel = STORE_NAME[site] || site || "";
    const newTurn: Turn = {
      id,
      query,
      steps: [],
      answer: "",
      offers: [],
      cartNote: note,
      cartShot: "",
      cartSite: siteLabel,
      error: "",
      clarifying: false,
      optionGroups: [],
      createdAt: Date.now(),
      responseCreatedAt: Date.now(),
    };
    setThreads((prevThreads) => {
      const nextThreads = prevThreads.map((t) =>
        t.id === targetThreadId
          ? { ...t, turns: [...t.turns, newTurn], updatedAt: Date.now() }
          : t,
      );
      threadsRef.current = nextThreads;
      try {
        window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
      } catch {}
      return nextThreads;
    });
    return id;
  }

  function patchActiveTurn(id: number, patch: Partial<Turn> | ((prev: Turn) => Turn)) {
    const targetThreadId = activeThreadIdRef.current;
    setThreads((prevThreads) => {
      const nextThreads = prevThreads.map((t) => {
        if (t.id !== targetThreadId) return t;
        const nextTurns = t.turns.map((turn) => {
          if (turn.id !== id) return turn;
          return typeof patch === "function" ? patch(turn) : { ...turn, ...patch };
        });
        return { ...t, turns: nextTurns, updatedAt: Date.now() };
      });
      threadsRef.current = nextThreads;
      try {
        window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
      } catch {}
      return nextThreads;
    });
  }

  async function handleLocationShare() {
    if (!navigator.geolocation) {
      alert("Your browser doesn't support location sharing.");
      return;
    }
    setFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFetchingLocation(false);
        const { latitude, longitude } = pos.coords;
        const mapLink = `https://maps.google.com/?q=${latitude},${longitude}`;
        void runAsk(`My location pin: ${mapLink}`);
      },
      (err) => {
        setFetchingLocation(false);
        if (err.code === err.PERMISSION_DENIED) {
          alert("Location access denied. Please enable location in your browser settings.");
        } else {
          alert("Could not get your location. Please try again.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function runAsk(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;

    const currentThreadId = activeThreadIdRef.current || threads[0]?.id;
    if (!currentThreadId) return;

    const id = turnSeq;
    setTurnSeq((n) => n + 1);

    const nextTurn: Turn = {
      id,
      query: q,
      steps: [],
      answer: "",
      offers: [],
      cartNote: "",
      cartShot: "",
      cartSite: "",
      error: "",
      clarifying: false,
      optionGroups: [],
      createdAt: Date.now(),
    };

    // Append turn immediately using functional update
    let currentSessionId = "";
    setThreads((prevThreads) => {
      const nextThreads = prevThreads.map((t) => {
        if (t.id !== currentThreadId) return t;
        currentSessionId = t.sessionId;
        const isNew = t.turns.length === 0 || t.title === "New chat";
        const newTitle = isNew
          ? q.length > 28
            ? `${q.slice(0, 28).trim()}…`
            : q
          : t.title;
        return {
          ...t,
          title: newTitle,
          turns: [...t.turns, nextTurn],
          updatedAt: Date.now(),
        };
      });
      threadsRef.current = nextThreads;
      try {
        window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
      } catch {}
      return nextThreads;
    });

    setInputQuery("");
    setBusy(true);

    let stepCounter = 1;
    const pushStep = (text: string) => {
      const sid = stepCounter++;
      patchActiveTurn(id, (turn) => ({
        ...turn,
        steps: [...turn.steps, { id: sid, text }],
      }));
    };

    try {
      const lowQ = q.toLowerCase();
      const deliveryTurn =
        /\b(change|update|set)\b.*\b(name|phone|address|street|notes?|pin)\b/.test(lowQ) ||
        /\b(my name is|delivery details|updated details|my details|place order|drop-?off|map pin)\b/.test(lowQ) ||
        /\b(اسمي|عنوان|جوال)\b/.test(lowQ);
      const cartTurn =
        /\b(add|remove|delete|drop|clear|view|show|check)\b.*\b(cart|basket)\b/.test(lowQ) ||
        /\b(remove|delete|drop)\b/.test(lowQ) ||
        /\b(my cart|empty cart|in my cart|in the cart|cart right now|current cart)\b/.test(lowQ);
      if (deliveryTurn) pushStep("Updating delivery details…");
      else if (/\b(remove|delete|drop|clear)\b/.test(lowQ)) pushStep("Updating your cart…");
      else if (cartTurn) pushStep("Checking your cart…");
      else pushStep("Searching live Riyadh stores (Ninja, Tamimi, Panda, Danube, Carrefour)…");
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: q,
          session_id: currentSessionId || undefined,
          user_id: userId,
        }),
      });

      const json = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        patchActiveTurn(id, {
          error: String(json.error || json.detail || json.message || "Something went wrong."),
        });
        return;
      }

      if (json.session_id) {
        const sid = String(json.session_id);
        setThreads((prevThreads) => {
          const nextThreads = prevThreads.map((t) =>
            t.id === currentThreadId ? { ...t, sessionId: sid } : t,
          );
          threadsRef.current = nextThreads;
          try {
            window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
          } catch {}
          return nextThreads;
        });
      }

      const nextOffers = Array.isArray(json.offers) ? (json.offers as Offer[]) : [];
      if (nextOffers.length) {
        pushStep(`Found ${nextOffers.length} offers with live prices`);
        patchActiveTurn(id, { offers: nextOffers });
      }

      if (json.action === "view_cart" || json.action === "collect_delivery" || json.action === "delivery_saved") {
        const site = STORE_NAME[String(json.site || "")] || String(json.site || "shop");
        patchActiveTurn(id, {
          cartNote: String(json.message || `Cart on ${site}.`),
          cartSite: site,
        });
        if (json.action === "view_cart") {
          pushStep("Showing your cart");
        } else if (json.action === "collect_delivery") {
          const missing = Array.isArray(json.missing_fields) ? (json.missing_fields as string[]) : [];
          pushStep(
            missing.length
              ? `Still need delivery details: ${missing.join(", ")}`
              : "Collecting delivery details",
          );
        } else {
          pushStep("Delivery details updated");
        }
        void refreshCart();
      }

      const groups = Array.isArray(json.option_groups)
        ? (json.option_groups as ClarifyGroup[])
        : [];
      if (json.clarifying && groups.length) {
        setPicked({});
        patchActiveTurn(id, { clarifying: true, optionGroups: groups });
        pushStep("Pick preferred options to narrow search");
      }

      const answer = String(json.message || "").trim();
      if (answer) {
        patchActiveTurn(id, { answer });
      }
    } catch {
      patchActiveTurn(id, { error: "Something went wrong. Please try again." });
    } finally {
      patchActiveTurn(id, (turn) => ({
        ...turn,
        responseCreatedAt: turn.responseCreatedAt || Date.now(),
      }));
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runAsk(inputQuery);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void runAsk(inputQuery);
    }
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

  function closeDetail() {
    setOpenOffer(null);
    setDetail(null);
    setDetailBusy(false);
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

  const lastTurn = activeTurns.at(-1);
  const clarifying = Boolean(lastTurn?.clarifying && lastTurn.optionGroups.length);

  // Poll for agent-pushed messages (rider called, on the way, delivered)
  useEffect(() => {
    if (!userId && !sessionId) return;
    const active = Boolean(
      cart && ["placed", "rider_calling", "with_rider"].includes(cart.status),
    );
    if (!active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const qs = new URLSearchParams();
        if (userId) qs.set("user_id", userId);
        if (sessionId) qs.set("session_id", sessionId);
        qs.set("since", String(pushCursor));
        const res = await fetch(`/api/chat/messages?${qs.toString()}`);
        if (!res.ok) return;
        const json = (await res.json()) as Record<string, unknown>;
        const data = (json.data || {}) as Record<string, unknown>;
        const messages = Array.isArray(data.messages)
          ? (data.messages as Array<{ id: number; text: string; kind?: string }>)
          : [];
        if (cancelled || messages.length === 0) {
          if (typeof data.cursor === "number") setPushCursor(data.cursor);
          return;
        }

        let nextSeq = turnSeq;
        const additions: Turn[] = messages.map((m) => {
          const id = nextSeq++;
          return {
            id,
            query: "",
            steps: [],
            answer: String(m.text || ""),
            offers: [],
            cartNote: "",
            cartShot: "",
            cartSite: "",
            error: "",
            clarifying: false,
            optionGroups: [],
            createdAt: Date.now(),
          };
        });
        setTurnSeq(nextSeq);

        const currentTargetId = activeThreadIdRef.current;
        setThreads((prevThreads) => {
          const nextThreads = prevThreads.map((t) => {
            if (t.id !== currentTargetId) return t;
            return {
              ...t,
              turns: [...t.turns, ...additions],
              updatedAt: Date.now(),
            };
          });
          threadsRef.current = nextThreads;
          try {
            window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
          } catch {}
          return nextThreads;
        });

        if (typeof data.cursor === "number") setPushCursor(data.cursor);
        void refreshCart();
      } catch {}
    };
    void tick();
    const handle = window.setInterval(tick, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [userId, sessionId, cart?.status, pushCursor, turnSeq]);

  // Group threads chronologically
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOf7Days = startOfToday - 7 * 86400000;

  const groupedThreads: { label: string; items: ChatThread[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const t of threads) {
    const time = t.updatedAt || t.createdAt;
    if (time >= startOfToday) {
      groupedThreads[0].items.push(t);
    } else if (time >= startOfYesterday) {
      groupedThreads[1].items.push(t);
    } else if (time >= startOf7Days) {
      groupedThreads[2].items.push(t);
    } else {
      groupedThreads[3].items.push(t);
    }
  }

  const nonEmptyGroups = groupedThreads.filter((g) => g.items.length > 0);

  return (
    <div className="chat-app-root">
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="chat-mobile-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (ChatGPT style) */}
      <aside className={`chat-sidebar ${sidebarOpen ? "is-open" : "is-collapsed"} ${mobileSidebarOpen ? "is-mobile-open" : ""}`}>
        <div className="chat-sidebar-header">
          <button
            type="button"
            className="new-chat-btn"
            onClick={handleCreateNewThread}
            aria-label="Start new chat"
          >
            <PlusIcon />
            <span>New chat</span>
          </button>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => {
              setSidebarOpen(!sidebarOpen);
              setMobileSidebarOpen(false);
            }}
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-label="Toggle sidebar"
          >
            <SidebarToggleIcon />
          </button>
        </div>

        <div className="chat-sidebar-threads">
          {nonEmptyGroups.map((group) => (
            <div key={group.label} className="threads-group">
              <span className="threads-group-label">{group.label}</span>
              <ul className="threads-list">
                {group.items.map((t) => {
                  const isActive = t.id === effectiveActiveId;
                  return (
                    <li key={t.id} className={`thread-item ${isActive ? "is-active" : ""}`}>
                      <button
                        type="button"
                        className="thread-select-btn"
                        onClick={() => handleSelectThread(t.id)}
                      >
                        <ChatBubbleIcon />
                        <span className="thread-title">{t.title}</span>
                      </button>
                      <button
                        type="button"
                        className="thread-delete-btn"
                        onClick={(e) => handleDeleteThread(t.id, e)}
                        title="Delete chat"
                        aria-label={`Delete chat ${t.title}`}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="chat-sidebar-footer">
          <div className="sidebar-badge-stores">
            <span className="live-dot" />
            <span>Ninja · Tamimi · Panda · Danube</span>
          </div>
          <div className="sidebar-user-info">
            <span className="user-id-label">Session ID: {userId ? `${userId.slice(0, 11)}…` : "Anonymous"}</span>
          </div>
        </div>
      </aside>

      {/* Main Chat Workspace */}
      <main className="chat-main-area">
        {/* Top bar header */}
        <header className="chat-topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button
                type="button"
                className="topbar-icon-btn"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
                aria-label="Open sidebar"
              >
                <SidebarToggleIcon />
              </button>
            )}
            <button
              type="button"
              className="topbar-icon-btn mobile-menu-btn"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open threads menu"
            >
              <MenuIcon />
            </button>
            <div className="topbar-wordmark">
              Wish <span>Wish</span>
            </div>
          </div>

          <div className="topbar-center">
            <span className="active-thread-heading" title={activeThread?.title}>
              {activeThread?.title || "New chat"}
            </span>
          </div>

          <div className="topbar-right">
            <button
              type="button"
              className="new-chat-chip"
              onClick={handleCreateNewThread}
              title="Start a new chat thread"
            >
              <PlusIcon />
              <span>New</span>
            </button>
            <button
              type="button"
              className="cart-chip"
              onClick={() => {
                const next = !cartOpen;
                setCartOpen(next);
                if (next) void refreshCart();
              }}
              aria-label="My cart"
            >
              <CartIcon />
              <span>Cart</span>
              {cart && cart.items?.length ? (
                <span className="cart-chip-count">{cart.items.length}</span>
              ) : null}
            </button>
          </div>
        </header>

        {/* Chat Feed Area */}
        <div className="chat-feed-scroll">
          {activeTurns.length === 0 ? (
            <div className="chat-hero-welcome">
              <div className="hero-logo-circle">
                <SparkleIcon />
              </div>
              <h1 className="hero-heading">Where should we find groceries today?</h1>
              <p className="hero-subtext">
                Live prices from <strong>Ninja, Tamimi, Panda, Danube & Carrefour</strong> in Riyadh.
                Compare prices, check stock, and build your cart directly.
              </p>

              <div className="hero-suggestions-grid">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="hero-suggestion-card"
                    onClick={() => void runAsk(item.prompt)}
                  >
                    <span className="card-label">{item.label}</span>
                    <span className="card-prompt">{item.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-messages-container">
              {activeTurns.map((turn, turnIdx) => (
                <div key={turn.id} className="turn-block">
                  {/* User Question Row */}
                  {turn.query && (
                    <div className="message-row user-row">
                      <div className="message-avatar user-avatar">You</div>
                      <div className="message-content user-content">
                        <p className="user-query-text">{turn.query}</p>
                        {turn.createdAt && (
                          <span className="message-timestamp">
                            {formatTimestamp(turn.createdAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Assistant Answer Row */}
                  <div className="message-row assistant-row">
                    <div className="message-avatar assistant-avatar">
                      <SparkleIcon />
                    </div>
                    <div className="message-content assistant-content">
                      {/* Thought / Execution Steps */}
                      {turn.steps && turn.steps.length > 0 && (
                        <div className="assistant-steps-container">
                          {turn.steps.map((step) => (
                            <span key={`${turn.id}-step-${step.id}`} className="step-badge">
                              <CheckCircleIcon />
                              {step.text}
                            </span>
                          ))}
                          {busy && turnIdx === activeTurns.length - 1 && (
                            <span className="step-badge is-live">
                              <SpinnerIcon />
                              Searching stores…
                            </span>
                          )}
                        </div>
                      )}

                      {/* Main Message Text */}
                      {turn.answer && (
                        <div className="assistant-text-bubble">
                          <p>{turn.answer}</p>
                        </div>
                      )}

                      {/* Inline Product Offers Grid */}
                      {turn.offers && turn.offers.length > 0 && (
                        <div className="turn-offers-container">
                          <div className="turn-offers-header">
                            <span className="offers-count-tag">
                              {turn.offers.length} options found
                            </span>
                            <span className="offers-note">
                              Click any card to inspect full description or add to cart
                            </span>
                          </div>
                          <div className="turn-offers-grid">
                            {turn.offers.map((offer, offIdx) => (
                              <div
                                key={`${offer.site}-${offer.url}-${offIdx}`}
                                className={`turn-offer-card ${offIdx === 0 ? "is-best-deal" : ""}`}
                                onClick={() => void showOffer(offer)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void showOffer(offer);
                                }}
                              >
                                {offIdx === 0 && (
                                  <span className="best-deal-badge">Best Match</span>
                                )}
                                <div className="offer-image-wrap">
                                  {offer.image_url ? (
                                    <img
                                      src={offer.image_url}
                                      alt={offer.title}
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="offer-no-photo">No photo</div>
                                  )}
                                </div>
                                <div className="offer-details">
                                  <span className={`store-badge store-${offer.site.toLowerCase()}`}>
                                    {STORE_NAME[offer.site] || offer.site}
                                  </span>
                                  <strong className="offer-title" title={offer.title}>
                                    {offer.title}
                                  </strong>
                                  <div className="offer-footer">
                                    {offer.price_sar != null ? (
                                      <span className="offer-price">
                                        {Number(offer.price_sar).toFixed(2)} <small>SAR</small>
                                      </span>
                                    ) : (
                                      <span className="offer-price-na">Check in store</span>
                                    )}
                                    {(() => {
                                      const key = _addKey(offer);
                                      const isAdding = addingKeys.has(key);
                                      return (
                                        <button
                                          type="button"
                                          className="quick-add-btn"
                                          disabled={busy || isAdding}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void quickAddToCart(offer);
                                          }}
                                        >
                                          {isAdding ? "Adding…" : "Add"}
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Clarification Chips if Bot Needs Specifics */}
                      {turn.clarifying && turn.optionGroups.length > 0 && (
                        <div className="clarify-container">
                          {turn.optionGroups.map((group) => (
                            <div key={group.id} className="clarify-group-block">
                              <p className="clarify-title">
                                {group.title}
                                <span>{group.multi ? " · select multiple" : " · choose one"}</span>
                              </p>
                              <div className="clarify-chips-row">
                                {group.options.map((opt) => {
                                  const isSelected = (picked[group.id] || []).includes(opt.id);
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      className={`clarify-chip-btn ${isSelected ? "is-selected" : ""}`}
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
                            className="clarify-submit-btn"
                            disabled={busy}
                            onClick={() => searchFromPicks(turn.optionGroups)}
                          >
                            Apply Filters & Search
                          </button>
                        </div>
                      )}

                      {/* Cart Action Note */}
                      {turn.cartNote && (
                        <div className="cart-action-alert">
                          <CheckCircleIcon />
                          <span>{turn.cartNote}</span>
                        </div>
                      )}

                      {/* Cart Screenshot Preview */}
                      {turn.cartShot && (
                        <figure className="cart-shot-figure">
                          <div className="cart-shot-frame">
                            <img
                              src={turn.cartShot}
                              alt={`Cart on ${turn.cartSite || "store"}`}
                            />
                          </div>
                          <figcaption>{turn.cartSite || "Shop"} live cart</figcaption>
                        </figure>
                      )}

                      {/* Error State */}
                      {turn.error && (
                        <div className="assistant-error-alert">
                          <AlertTriangleIcon />
                          <span>{turn.error}</span>
                        </div>
                      )}

                      {/* Response Timestamp */}
                      {(turn.responseCreatedAt || (turn.createdAt && (!busy || turnIdx < activeTurns.length - 1))) && (
                        <span className="message-timestamp">
                          {formatTimestamp(turn.responseCreatedAt || turn.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Busy Indicator when loading next turn */}
              {busy && activeTurns.length > 0 && !lastTurn?.steps?.length && (
                <div className="message-row assistant-row">
                  <div className="message-avatar assistant-avatar">
                    <SparkleIcon />
                  </div>
                  <div className="message-content assistant-content">
                    <div className="typing-indicator">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Follow-up Chips under latest turn */}
              {!busy && !clarifying && activeTurns.length > 0 && (
                <div className="chat-followup-chips">
                  {FOLLOWUPS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="followup-chip"
                      onClick={() => void runAsk(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Anchored ChatGPT-style Input Box */}
        <div className="chat-input-dock">
          <form className="chat-input-form" onSubmit={onSubmit}>
            <div className="chat-input-box">
              <textarea
                ref={textareaRef}
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Wish Wish to find groceries, compare prices, or add items to cart…"
                rows={1}
                disabled={busy}
              />
              <button
                type="button"
                className="chat-location-btn"
                disabled={busy || fetchingLocation}
                title="Share your location pin"
                aria-label="Share location"
                onClick={handleLocationShare}
              >
                {fetchingLocation ? <SpinnerIcon /> : <LocationPinIcon />}
              </button>
              <button
                type="submit"
                className="chat-send-btn"
                disabled={busy || !inputQuery.trim()}
                title="Send message"
                aria-label="Send message"
              >
                {busy ? <SpinnerIcon /> : <ArrowUpIcon />}
              </button>
            </div>
            <div className="chat-dock-caption">
              <span>Wish Wish queries live grocery platforms across Riyadh. Cash on Delivery & live cart sync supported.</span>
            </div>
          </form>
        </div>
      </main>

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="drawer-back" onClick={() => setCartOpen(false)} role="presentation">
          <aside
            className="drawer cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="drawer-x"
              onClick={() => setCartOpen(false)}
              aria-label="Close cart"
            >
              ✕
            </button>
            <h3 id="cart-drawer-title">
              My Cart
              {cartBusy && (
                <span
                  aria-live="polite"
                  style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, opacity: 0.6 }}
                >
                  syncing…
                </span>
              )}
            </h3>
            {!cart && !cartBusy && (
              <p className="cart-empty">
                Your cart is empty. Search for an item and ask “add to cart”.
              </p>
            )}
            {!cart && cartBusy && (
              <p className="cart-empty">Refreshing live cart…</p>
            )}
            {cart && (
              <>
                <p className="cart-meta">
                  {cartShopLabel(cart)} · Delivery · Status:{" "}
                  <strong>{cart.status}</strong>
                </p>
                {cart.ask_customer_now && cart.missing_fields && cart.missing_fields.length > 0 && (
                  <div className="cart-ask" role="status" style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#fff7e6",
                    border: "1px solid #f0c674",
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}>
                    <strong>Still need to finalize:</strong> {cart.missing_fields.join(", ")}. Reply in chat with these details to place the order.
                  </div>
                )}
                <ul className="cart-lines">
                  {(cart.items || []).map((item, i) => {
                    const itemImage = item.image_url || (item as any).image || "";
                    const itemPrice = item.price_sar ?? (item as any).price;
                    return (
                      <li key={`${item.product_url || item.name}-${i}`}>
                        <div className="cart-line-photo">
                          {itemImage ? (
                            <img src={itemImage} alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <em>—</em>
                          )}
                        </div>
                        <div className="cart-line-meta">
                          <strong>{item.name || "Item"}</strong>
                          <span>
                            {item.site ? `${STORE_NAME[item.site] || item.site} · ` : ""}
                            Qty {item.qty ?? 1}
                            {itemPrice != null
                              ? ` · ${Number(itemPrice).toFixed(2)} SAR`
                              : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="cart-line-remove"
                          onClick={() => void removeCartItem(item, i)}
                          disabled={removingIndex === i}
                          title={`Remove ${item.name || "item"}`}
                          aria-label={`Remove ${item.name || "item"}`}
                        >
                          {removingIndex === i ? "…" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {cart.total_sar != null && (
                  <p className="cart-total">
                    Total: {Number(cart.total_sar).toFixed(2)} SAR · cash to Wish Wish
                  </p>
                )}
                <p className="cart-note">
                  Order id <code>{cart.id}</code>. Say “place order” in chat once your delivery address is confirmed.
                </p>
                <button
                  type="button"
                  className="cart-line-remove"
                  onClick={() => {
                    if (window.confirm("Clear all items from your local cart? (The real shop cart is untouched.)")) {
                      void clearCart();
                    }
                  }}
                  disabled={cartBusy}
                  style={{ marginTop: 8, width: "100%" }}
                >
                  {cartBusy ? "Clearing…" : "Clear cart"}
                </button>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Product Detail Drawer */}
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
              ✕
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
            {detailBusy && <p className="drawer-wait">Fetching official product page…</p>}
            {!detailBusy && detail?.error && <p className="agent-error">{detail.error}</p>}
            {!detailBusy && detail && !detail.description && !detail.error && (
              <p className="drawer-wait">No extra description available on the store catalog.</p>
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
                  const price = detail?.price_sar ?? openOffer.price_sar;
                  const image = detail?.image_url || openOffer.image_url;
                  closeDetail();
                  void quickAddToCart({
                    site: openOffer.site,
                    title,
                    price_sar: price,
                    url: openOffer.url,
                    image_url: image,
                  });
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

// Inline SVGs
function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SidebarToggleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="anim-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
    </svg>
  );
}

function LocationPinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
