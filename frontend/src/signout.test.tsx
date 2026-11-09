import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { customer, fakeQuote } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"] } } };
const cartInStorage = () => JSON.parse(localStorage.getItem("baker.cart") ?? "[]") as unknown[];

describe("signing out", () => {
  it("goes straight to the sign-in page, ends the session and empties the cart", async () => {
    localStorage.setItem("baker.token", "tok");
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 2, inscription: "" }]));
    mockFetch({ "/auth/me": { body: customer }, ...store });
    renderApp(<App />, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("baker.token")).toBeNull();
    await waitFor(() => expect(cartInStorage()).toEqual([]));
    expect(screen.getByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument();
  });

  it("also leaves a public page, where nothing else would send the visitor away", async () => {
    localStorage.setItem("baker.token", "tok");
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 1, inscription: "" }]));
    mockFetch({ "/auth/me": { body: customer }, ...store, "POST /checkout/quote": { body: (req: Parameters<typeof fakeQuote>[0]) => fakeQuote(req) } });
    renderApp(<App />, "/cart");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => expect(cartInStorage()).toEqual([]));
  });

  it("does not hand the previous account's cart to the next person who signs in", async () => {
    localStorage.setItem("baker.token", "tok");
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 1, inscription: "" }]));
    mockFetch({ "/auth/me": { body: customer }, ...store });
    renderApp(<App />, "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    mockFetch({
      ...store,
      "POST /auth/login": { body: { access_token: "tok2", user: { ...customer, id: 6, full_name: "Omar" } } },
      "/auth/me": { body: { ...customer, id: 6, full_name: "Omar" } },
    });
    await user.type(screen.getByLabelText("Email"), "omar@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { level: 1, name: "My account" });
    expect(screen.getByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument();
  });
});
