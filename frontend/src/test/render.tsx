import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../lib/auth";
import { DisplayProvider } from "../lib/display";

export function renderApp(ui: ReactElement, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DisplayProvider>
        <AuthProvider>{ui}</AuthProvider>
      </DisplayProvider>
    </MemoryRouter>,
  );
}

export function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) throw new Error(`unmocked ${url}`);
    const { status = 200, body } = routes[key];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
