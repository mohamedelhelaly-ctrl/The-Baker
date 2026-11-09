import { MAX_QTY, lineKey } from "./cartKeys";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

/** A cart line holds only what the customer chose. Names and prices always come from the server quote. */
export interface CartLine {
  variantId: number;
  quantity: number;
  inscription: string;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  add: (variantId: number, quantity: number, inscription?: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  setInscription: (key: string, inscription: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const KEY = "baker.cart";
const OWNER_KEY = "baker.cart.owner"; // which account the cart in this browser was last synced with
const SAVE_DELAY_MS = 400;

interface ServerLine {
  variant_id: number;
  quantity: number;
  inscription: string | null;
}
const fromServer = (l: ServerLine): CartLine => ({ variantId: l.variant_id, quantity: clamp(l.quantity), inscription: l.inscription ?? "" });
const toServer = (l: CartLine): ServerLine => ({ variant_id: l.variantId, quantity: l.quantity, inscription: l.inscription || null });

/** The account's saved cart plus anything a guest added before signing in (same item: quantities add up). */
function merge(saved: CartLine[], guest: CartLine[]): CartLine[] {
  const result = saved.map((l) => ({ ...l }));
  for (const g of guest) {
    const same = result.find((l) => lineKey(l) === lineKey(g));
    if (same) same.quantity = clamp(same.quantity + g.quantity);
    else result.push({ ...g });
  }
  return result;
}

function readOwner(): number | null {
  try {
    const n = Number(localStorage.getItem(OWNER_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function writeOwner(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(OWNER_KEY);
    else localStorage.setItem(OWNER_KEY, String(id));
  } catch {
    /* only a convenience */
  }
}
const clamp = (n: number) => Math.min(MAX_QTY, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));

function load(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => Number.isInteger(l?.variantId) && l.variantId > 0)
      .map((l) => ({ variantId: l.variantId, quantity: clamp(Number(l.quantity)), inscription: String(l.inscription ?? "").slice(0, 80) }));
  } catch {
    return [];
  }
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);
  const userId = useAuth().user?.id ?? null;
  // The account the cart is currently in step with. Nothing is saved until the account's own cart has
  // been fetched, so signing in can never overwrite it with an empty one.
  const [syncedFor, setSyncedFor] = useState<number | null>(null);
  // Whoever signs in (or out), the previous sync is over: adjusting state while rendering is React's way to reset it.
  const [seenUser, setSeenUser] = useState<number | null>(userId);
  if (seenUser !== userId) {
    setSeenUser(userId);
    setSyncedFor(null);
  }

  // Signing in: bring back the account's cart. Items a guest added first are kept (merged in), but a cart
  // left in this browser by a different account (for example after a session expired) is not inherited.
  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    api
      .get<{ lines: ServerLine[] }>("/me/cart", { signal: controller.signal })
      .then((res) => {
        const saved = res.lines.map(fromServer);
        const owner = readOwner();
        setLines((local) => (owner === userId ? saved : owner === null ? merge(saved, local) : saved));
        writeOwner(userId);
        setSyncedFor(userId);
      })
      .catch(() => undefined); // offline: keep the local cart and try again at the next sign-in
    return () => controller.abort();
  }, [userId]);

  // While signed in, every change is saved to the account (briefly delayed, so typing does not flood it).
  useEffect(() => {
    if (userId === null || syncedFor !== userId) return;
    const id = setTimeout(() => {
      api.put("/me/cart", { lines: lines.map(toServer) }).catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [lines, userId, syncedFor]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      /* the cart lasts until reload */
    }
  }, [lines]);

  const add = useCallback((variantId: number, quantity: number, inscription = "") => {
    const insc = inscription.trim().slice(0, 80);
    setLines((prev) => {
      const key = lineKey({ variantId, inscription: insc });
      const existing = prev.find((l) => lineKey(l) === key);
      if (existing) return prev.map((l) => (lineKey(l) === key ? { ...l, quantity: clamp(l.quantity + quantity) } : l));
      return [...prev, { variantId, quantity: clamp(quantity), inscription: insc }];
    });
  }, []);

  const setQuantity = useCallback(
    (key: string, quantity: number) => setLines((prev) => prev.map((l) => (lineKey(l) === key ? { ...l, quantity: clamp(quantity) } : l))),
    [],
  );
  const setInscription = useCallback(
    (key: string, inscription: string) =>
      setLines((prev) => {
        const next = inscription.trim().slice(0, 80);
        const merged = prev.map((l) => (lineKey(l) === key ? { ...l, inscription: next } : l));
        // Two lines that became identical are merged into one.
        return merged.reduce<CartLine[]>((acc, l) => {
          const same = acc.find((x) => lineKey(x) === lineKey(l));
          if (same) same.quantity = clamp(same.quantity + l.quantity);
          else acc.push({ ...l });
          return acc;
        }, []);
      }),
    [],
  );
  const remove = useCallback((key: string) => setLines((prev) => prev.filter((l) => lineKey(l) !== key)), []);
  const clear = useCallback(() => {
    setLines([]);
    writeOwner(null);
  }, []);

  const value = useMemo(
    () => ({ lines, count: lines.reduce((n, l) => n + l.quantity, 0), add, setQuantity, setInscription, remove, clear }),
    [lines, add, setQuantity, setInscription, remove, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
