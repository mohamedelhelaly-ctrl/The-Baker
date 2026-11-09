import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { categories, changeable, customer, occasions, owner } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

// Pages and states not covered by the per-feature tests. Colour contrast cannot be measured in jsdom
// (see tokens.test.ts, which checks the design tokens instead), so this is about structure and names.
const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"], cancellation_window_hours: 24, policy_text: "Policy.", phone: null, whatsapp: null, email: null, address: null, pickup_location: null, pickup_instructions: null } } };
const taxonomy = (items: unknown[]) => items.map((c) => ({ ...(c as object), sort_order: 0, is_archived: false }));

describe("accessibility of remaining pages and states", () => {
  it("the not-found page", async () => {
    mockFetch(store);
    const { container } = renderApp(<App />, "/no/such/page");
    await screen.findByRole("heading", { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the not-allowed page", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({ "/auth/me": { body: customer }, ...store });
    const { container } = renderApp(<App />, "/admin/team");
    await screen.findByRole("heading", { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });

  for (const kind of ["categories", "occasions"] as const) {
    it(`the owner's ${kind} page`, async () => {
      localStorage.setItem("baker.token", "tok");
      mockFetch({ "/auth/me": { body: owner }, ...store, "/admin/categories": { body: taxonomy(categories) }, "/admin/occasions": { body: taxonomy(occasions) } });
      const { container } = renderApp(<App />, `/admin/${kind}`);
      await screen.findByRole("heading", { level: 1 });
      await screen.findAllByRole("listitem");
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  const states: [string, Record<string, unknown>][] = [
    ["waiting for payment", { status: "pending_payment", payment_method: "card", payment_status: "pending", can_change: false }],
    ["running late", { status: "preparing", is_delayed: true, delay_note: "About 30 minutes", can_change: false }],
    ["cancelled", { status: "cancelled", cancellation_reason: "You cancelled this order.", can_change: false }],
    ["declined", { status: "rejected", rejection_reason: "Fully booked.", can_change: false }],
    ["delivered", { status: "delivered", can_change: false }],
    ["still changeable", {}],
  ];
  for (const [name, patch] of states) {
    it(`the order page, ${name}`, async () => {
      mockFetch({ ...store, "/orders/BK-ABC234": { body: { ...changeable, ...patch } } });
      const { container } = renderApp(<App />, "/track/BK-ABC234?t=tok");
      await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("the display menu, open", async () => {
    mockFetch(store);
    const { container } = renderApp(<App />, "/login");
    await userEvent.setup().click(await screen.findByRole("button", { name: /Display/ }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("keyboard use", () => {
  it("the skip link is the first thing a keyboard user reaches and it targets the main content", async () => {
    mockFetch(store);
    renderApp(<App />, "/login");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    await user.tab();
    const skip = screen.getByRole("link", { name: /skip to/i });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")).not.toBeNull();
  });

  it("every page has exactly one level-one heading", async () => {
    for (const route of ["/login", "/register", "/forgot-password", "/no/such/page"]) {
      mockFetch(store);
      const { unmount } = renderApp(<App />, route);
      await screen.findByRole("heading", { level: 1 });
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      unmount();
    }
  });
});
