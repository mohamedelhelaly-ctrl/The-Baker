import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { CartLine } from "../lib/cart";
import type { Fulfilment, Quote } from "../lib/types";

export interface QuoteChoices {
  fulfilment_type?: Fulfilment;
  zone_id?: number;
  date?: string;
  slot_id?: number;
}

/** Ask the server to price the cart and check the choices made so far (debounced, stale replies dropped). */
export function useQuote(lines: CartLine[], choices: QuoteChoices = {}) {
  const body = useMemo(
    () => ({
      items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, inscription: l.inscription || null })),
      ...choices,
    }),
    // eslint-disable-next-line
    [JSON.stringify(lines), JSON.stringify(choices)],
  );
  const key = JSON.stringify(body);
  const [result, setResult] = useState<{ key: string; quote: Quote | null; error: ApiError | null }>({ key: "", quote: null, error: null });

  useEffect(() => {
    if (body.items.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .post<Quote>("/checkout/quote", body, { signal: controller.signal })
        .then((quote) => setResult({ key, quote, error: null }))
        .catch((err) => {
          if (controller.signal.aborted) return;
          setResult({ key, quote: null, error: err instanceof ApiError ? err : null });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, body]);

  const empty = body.items.length === 0;
  const current = result.key === key;
  return {
    quote: empty ? null : (result.quote ?? null), // keep the previous quote while a new one loads
    error: empty || !current ? null : result.error,
    loading: !empty && !current,
  };
}
