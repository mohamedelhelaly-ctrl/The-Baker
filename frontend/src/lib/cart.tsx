import { MAX_QTY, lineKey } from "./cartKeys";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  const clear = useCallback(() => setLines([]), []);

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
