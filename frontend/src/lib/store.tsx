import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { api } from "./api";
import { formatMoney } from "./money";
import type { StoreInfo } from "./types";

const FALLBACK: StoreInfo = { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"], cancellation_window_hours: 24, policy_text: "", phone: null, whatsapp: null, email: null, address: null, pickup_location: null, pickup_instructions: null };
const StoreContext = createContext<StoreInfo>(FALLBACK);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<StoreInfo>(FALLBACK);
  const { pathname } = useLocation();

  // The owner can change payment methods, the cancellation policy and so on at any time, so look again
  // whenever the visitor opens another page or comes back to this tab, not only when the site first loads.
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setVisible((n) => n + 1);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<StoreInfo>("/store", { signal: controller.signal })
      .then((info) => setStore({ ...FALLBACK, ...info })) // tolerate an older API response
      .catch(() => undefined); // keep what we had if the API is unreachable
    return () => controller.abort();
  }, [pathname, visible]);
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
