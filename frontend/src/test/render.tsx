import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../lib/auth";
import { CartProvider } from "../lib/cart";
import { DisplayProvider } from "../lib/display";
import { StoreProvider } from "../lib/store";

export function renderApp(ui: ReactElement, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DisplayProvider>
        <AuthProvider>
          <StoreProvider>
            <CartProvider>{ui}</CartProvider>
          </StoreProvider>
        </AuthProvider>
      </DisplayProvider>
    </MemoryRouter>,
  );
}

type Body = unknown | ((request: any) => unknown); // eslint-disable-line
export function mockFetch(routes: Record<string, { status?: number; body: Body }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const keys = Object.keys(routes);
    // "POST /admin/x" keys win over plain "/admin/x" keys, so one path can answer differently per method.
    const key =
      keys.find((k) => k.startsWith(`${method} `) && path.endsWith(k.slice(method.length + 1))) ??
      keys.find((k) => !/^[A-Z]+ /.test(k) && (url.endsWith(k) || path.endsWith(k)));
    if (!key) throw new Error(`unmocked ${url}`);
    const { status = 200, body } = routes[key];
    const payload = typeof body === "function" ? (body as (r: unknown) => unknown)(init?.body ? JSON.parse(String(init.body)) : undefined) : body;
    return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
