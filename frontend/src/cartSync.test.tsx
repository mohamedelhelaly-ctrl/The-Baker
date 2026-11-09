import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { useCart } from "./lib/cart";
import { customer } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"] } } };
const line = (variant_id: number, quantity: number, inscription: string | null = null) => ({ variant_id, quantity, inscription });
const puts = (calls: { url: string; init?: RequestInit }[]) =>
  calls.filter((c) => c.init?.method === "PUT" && c.url.endsWith("/me/cart")).map((c) => JSON.parse(c.init!.body as string).lines as unknown[]);
const local = () => JSON.parse(localStorage.getItem("baker.cart") ?? "[]") as { variantId: number; quantity: number; inscription: string }[];

function Probe() {
  const cart = useCart();
  return (
    <>
      <p>Cart count: {cart.count}</p>
      <ul>
        {cart.lines.map((l) => (
          <li key={`${l.variantId}|${l.inscription}`}>
            variant {l.variantId} × {l.quantity}
            {l.inscription && ` “${l.inscription}”`}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => cart.add(11, 1)}>Add 11</button>
      <button type="button" onClick={() => cart.clear()}>Empty cart</button>
    </>
  );
}
const signedIn = (extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({ "/auth/me": { body: customer }, ...store, ...extra });
};

describe("the cart follows the account", () => {
  it("brings back the cart saved on the account when someone signs in", async () => {
    signedIn({ "/me/cart": { body: { lines: [line(10, 2, "Happy Birthday")] } } });
    renderApp(<Probe />);
    expect(await screen.findByText("Cart count: 2")).toBeInTheDocument();
    expect(screen.getByText(/variant 10 × 2 “Happy Birthday”/)).toBeInTheDocument();
  });

  it("saves changes to the account", async () => {
    const calls = signedIn({ "/me/cart": { body: { lines: [line(10, 2)] } }, "PUT /me/cart": { body: { lines: [] } } });
    renderApp(<Probe />);
    await screen.findByText("Cart count: 2");
    await userEvent.setup().click(screen.getByRole("button", { name: "Add 11" }));
    await waitFor(() => expect(puts(calls).at(-1)).toEqual([line(10, 2), line(11, 1)]));
  });

  it("saves an emptied cart too (after an order is placed, say)", async () => {
    const calls = signedIn({ "/me/cart": { body: { lines: [line(10, 2)] } }, "PUT /me/cart": { body: { lines: [] } } });
    renderApp(<Probe />);
    await screen.findByText("Cart count: 2");
    await userEvent.setup().click(screen.getByRole("button", { name: "Empty cart" }));
    await waitFor(() => expect(puts(calls).at(-1)).toEqual([]));
  });

  it("merges what a guest added with the account's cart", async () => {
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 1, inscription: "" }, { variantId: 12, quantity: 1, inscription: "" }]));
    const calls = signedIn({ "/me/cart": { body: { lines: [line(10, 2)] } }, "PUT /me/cart": { body: { lines: [] } } });
    renderApp(<Probe />);
    expect(await screen.findByText("Cart count: 4")).toBeInTheDocument();
    expect(screen.getByText(/variant 10 × 3/)).toBeInTheDocument();
    expect(screen.getByText(/variant 12 × 1/)).toBeInTheDocument();
    await waitFor(() => expect(puts(calls).at(-1)).toEqual([line(10, 3), line(12, 1)]));
  });

  it("never saves before the account's own cart has arrived", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    localStorage.setItem("baker.token", "tok");
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify(customer), { status: 200 });
      if (url.endsWith("/store")) return new Response(JSON.stringify(store["/store"].body), { status: 200 });
      if (url.endsWith("/me/cart") && init?.method === "PUT") return new Response(JSON.stringify({ lines: [] }), { status: 200 });
      await gate; // GET /me/cart is slow
      return new Response(JSON.stringify({ lines: [line(10, 2)] }), { status: 200 });
    }) as typeof fetch;
    renderApp(<Probe />);
    await new Promise((r) => setTimeout(r, 700)); // longer than the save delay
    expect(puts(calls)).toHaveLength(0); // an empty local cart must not wipe the saved one
    await act(async () => release?.());
    expect(await screen.findByText("Cart count: 2")).toBeInTheDocument();
  });

  it("does not save anything when the saved cart could not be loaded", async () => {
    const calls = signedIn({ "/me/cart": { status: 500, body: { error: { code: "error", message: "boom" } } }, "PUT /me/cart": { body: { lines: [] } } });
    renderApp(<Probe />);
    await new Promise((r) => setTimeout(r, 700));
    await userEvent.setup().click(screen.getByRole("button", { name: "Add 11" }));
    await new Promise((r) => setTimeout(r, 700));
    expect(puts(calls)).toHaveLength(0);
  });

  it("does not hand one account's leftover cart to a different account", async () => {
    // the browser still holds account 5's cart (its session expired), and account 6 signs in
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 4, inscription: "" }]));
    localStorage.setItem("baker.cart.owner", "5");
    localStorage.setItem("baker.token", "tok");
    const calls = mockFetch({ "/auth/me": { body: { ...customer, id: 6 } }, ...store, "/me/cart": { body: { lines: [line(12, 1)] } }, "PUT /me/cart": { body: { lines: [] } } });
    renderApp(<Probe />);
    expect(await screen.findByText("Cart count: 1")).toBeInTheDocument();
    expect(screen.queryByText(/variant 10/)).not.toBeInTheDocument();
    await waitFor(() => expect(puts(calls).at(-1)).toEqual([line(12, 1)]));
  });
});

describe("sign out and back in", () => {
  it("empties the cart on this browser but keeps it on the account", async () => {
    localStorage.setItem("baker.token", "tok");
    const calls = mockFetch({
      "/auth/me": { body: customer },
      ...store,
      "/me/cart": { body: { lines: [line(10, 2)] } },
      "PUT /me/cart": { body: { lines: [] } },
      "POST /auth/login": { body: { access_token: "tok2", user: customer } },
    });
    renderApp(<App />, "/account");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /account menu/ }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(screen.getByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument();
    await waitFor(() => expect(local()).toEqual([]));

    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(puts(calls).every((lines) => lines.length > 0)).toBe(true); // signing out never emptied the saved cart
  });
});
