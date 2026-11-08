import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { formatMoney } from "./money";
import type { StoreInfo } from "./types";

const FALLBACK: StoreInfo = { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"] };
const StoreContext = createContext<StoreInfo>(FALLBACK);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<StoreInfo>(FALLBACK);
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<StoreInfo>("/store", { signal: controller.signal })
      .then((info) => setStore({ ...FALLBACK, ...info })) // tolerate an older API response
      .catch(() => undefined); // keep the fallback if the API is unreachable
    return () => controller.abort();
  }, []);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useStore(): StoreInfo {
  return useContext(StoreContext);
}

// oxlint-disable-next-line react/only-export-components
export function useMoney(): (minor: number) => string {
  const { currency, currency_exponent } = useStore();
  return (minor) => formatMoney(minor, currency, currency_exponent);
}
