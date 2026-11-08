import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { formatTime, hhmm, parseDate, WEEKDAYS } from "./lib/dates";
import { parseAmount } from "./lib/money";
import { adminProduct, categories, closures, customer, detail, hours, occasions, owner, slotList, staff, zones } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: hours } } };
const adminRoutes = {
  ...store,
  "/admin/opening-hours": { body: hours },
  "/admin/time-slots": { body: slotList },
  "/admin/closures": { body: closures },
  "/admin/delivery-zones": { body: zones },
};
const signIn = (who: unknown, extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({ "/auth/me": { body: who }, ...adminRoutes, ...extra });
};
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));

describe("date helpers", () => {
  it("parses ISO dates without a timezone shift and formats times", () => {
    const d = parseDate("2026-11-09");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 9]);
    expect(WEEKDAYS[0]).toBe("Monday");
    expect(formatTime("14:00:00")).toBe("2:00 PM");
    expect(formatTime("09:30")).toBe("9:30 AM");
    expect(hhmm("14:00:00")).toBe("14:00");
  });
  it("accepts zero for amounts like free delivery", () => {
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("50.5")).toBe(5050);
    expect(parseAmount("-1")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
  });
});

describe("owner schedule page", () => {
  it("shows hours, slots grouped by day and closed dates, with no axe violations", async () => {
    signIn(owner);
    const { container } = renderApp(<App />, "/admin/schedule");
    expect(await screen.findByRole("heading", { level: 1, name: "Schedule" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Monday opens")).toHaveValue("09:00");
    expect(screen.getByLabelText("Friday opens")).toHaveValue("13:00");
    expect(await screen.findByRole("heading", { level: 3, name: "Monday" })).toBeInTheDocument();
    const friday = (await screen.findByRole("heading", { level: 3, name: "Friday" })).parentElement!;
    expect(within(friday).getByText(/Pickup only/)).toBeInTheDocument();
    expect(await screen.findByText(/^\s*· Holiday\s*$/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves opening hours as seven day entries", async () => {
    const calls = signIn(owner, { "PUT /admin/opening-hours": { body: hours } });
    renderApp(<App />, "/admin/schedule");
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("Tuesday closed"));
    await user.click(screen.getByRole("button", { name: "Save opening hours" }));
    expect(await screen.findByText("Opening hours saved.")).toBeInTheDocument();
    const body = JSON.parse(sent(calls, "PUT", "/admin/opening-hours")[0].init!.body as string);
    expect(body.days).toHaveLength(7);
    expect(body.days[1]).toMatchObject({ weekday: 1, is_closed: true });
    expect(body.days[0]).toMatchObject({ weekday: 0, opens_at: "09:00", closes_at: "21:00", is_closed: false });
  });

  it("refuses opening times that are not before closing times, without calling the API", async () => {
    const calls = signIn(owner);
    renderApp(<App />, "/admin/schedule");
    const user = userEvent.setup();
    const closes = await screen.findByLabelText("Wednesday closes");
    await user.clear(closes);
    await user.type(closes, "08:00");
    await user.click(screen.getByRole("button", { name: "Save opening hours" }));
    expect(await screen.findByText(/Wednesday: opening time must be before closing time/)).toBeInTheDocument();
    expect(sent(calls, "PUT", "/admin/opening-hours")).toHaveLength(0);
  });

  it("adds a time slot and shows the server's overlap message", async () => {
    const calls = signIn(owner, {
      "POST /admin/time-slots": { status: 409, body: { error: { code: "slot_overlap", message: "This overlaps the existing slot 10:00 to 12:00." } } },
    });
    renderApp(<App />, "/admin/schedule");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add time slot" }));
    expect(await screen.findByText(/This overlaps the existing slot/)).toBeInTheDocument();
    const body = JSON.parse(sent(calls, "POST", "/admin/time-slots")[0].init!.body as string);
    expect(body).toEqual({ weekday: 0, starts_at: "10:00", ends_at: "12:00", fulfilment_type: "both", max_orders: 6 });
  });

  it("edits a slot's capacity and asks before deleting", async () => {
    const calls = signIn(owner, { "PATCH /admin/time-slots/1": { body: slotList[0] }, "DELETE /admin/time-slots/1": { status: 204, body: null } });
    renderApp(<App />, "/admin/schedule");
    const user = userEvent.setup();
    const max = await screen.findByLabelText("Max orders, Monday 10:00 AM to 12:00 PM");
    await user.clear(max);
    await user.type(max, "9");
    await user.click(screen.getByRole("button", { name: "Save Monday 10:00 AM to 12:00 PM" }));
    await waitFor(() => expect(sent(calls, "PATCH", "/admin/time-slots/1")).toHaveLength(1));
    expect(JSON.parse(sent(calls, "PATCH", "/admin/time-slots/1")[0].init!.body as string)).toEqual({ max_orders: 9, is_active: true });

    await user.click(screen.getByRole("button", { name: "Delete Monday 10:00 AM to 12:00 PM" }));
    expect(sent(calls, "DELETE", "/admin/time-slots/1")).toHaveLength(0); // not yet: needs confirmation
    await user.click(screen.getByRole("button", { name: "Confirm delete Monday 10:00 AM to 12:00 PM" }));
    await waitFor(() => expect(sent(calls, "DELETE", "/admin/time-slots/1")).toHaveLength(1));
  });

  it("adds and removes closed dates", async () => {
    const calls = signIn(owner, { "POST /admin/closures": { body: closures[0] }, "DELETE /admin/closures/1": { status: 204, body: null } });
    renderApp(<App />, "/admin/schedule");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add closed date" }));
    expect(await screen.findByText("Choose a date.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Date"), "2030-12-31");
    await user.type(screen.getByLabelText("Reason (optional)"), "New Year");
    await user.click(screen.getByRole("button", { name: "Add closed date" }));
    await waitFor(() => expect(sent(calls, "POST", "/admin/closures")).toHaveLength(1));
    expect(JSON.parse(sent(calls, "POST", "/admin/closures")[0].init!.body as string)).toEqual({ date: "2030-12-31", reason: "New Year" });
    await user.click(await screen.findByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(sent(calls, "DELETE", "/admin/closures/1")).toHaveLength(1));
  });
});

describe("roles", () => {
  it("staff can see the schedule but not change it, and do not see catalog links", async () => {
    signIn(staff);
    renderApp(<App />, "/admin");
    expect(await screen.findByRole("heading", { level: 1, name: "Schedule" })).toBeInTheDocument(); // /admin redirects to the first area they may open
    expect(screen.getByText(/Only the owner can change it/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Monday opens")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save opening hours" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add time slot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add closed date" })).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Shop management" });
    expect(within(nav).getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
  });

  it("staff are blocked from the catalog pages", async () => {
    signIn(staff);
    renderApp(<App />, "/admin/products");
    expect(await screen.findByRole("heading", { level: 1, name: "You do not have access to this page" })).toBeInTheDocument();
  });

  it("customers are blocked from the schedule", async () => {
    signIn(customer);
    renderApp(<App />, "/admin/schedule");
    expect(await screen.findByRole("heading", { level: 1, name: "You do not have access to this page" })).toBeInTheDocument();
  });

  it("the owner is sent to Products from /admin and sees every area in the nav", async () => {
    signIn(owner, { "/admin/products": { body: { items: [], total: 0, page: 1, page_size: 20, total_pages: 1 } }, "/admin/categories": { body: [] } });
    renderApp(<App />, "/admin");
    expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Shop management" });
    for (const name of ["Products", "Categories", "Occasions", "Schedule", "Delivery zones"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
  });
});

describe("delivery zones (owner)", () => {
  it("lists zones with fees and inactive state, with no axe violations", async () => {
    signIn(owner);
    const { container } = renderApp(<App />, "/admin/delivery-zones");
    expect(await screen.findByText(/Fee .*40\.00/)).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("adds a zone with free delivery (fee 0) in minor units", async () => {
    const calls = signIn(owner, { "POST /admin/delivery-zones": { body: zones[0] } });
    renderApp(<App />, "/admin/delivery-zones");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Zone name"), "Dokki");
    await user.type(screen.getByLabelText("Delivery fee (EGP)"), "0");
    await user.clear(screen.getByLabelText("Minimum order (EGP)"));
    await user.type(screen.getByLabelText("Minimum order (EGP)"), "250.50");
    await user.click(screen.getByRole("button", { name: "Add zone" }));
    await waitFor(() => expect(sent(calls, "POST", "/admin/delivery-zones")).toHaveLength(1));
    expect(JSON.parse(sent(calls, "POST", "/admin/delivery-zones")[0].init!.body as string)).toMatchObject({
      name: "Dokki", fee: 0, min_order_amount: 25050, is_active: true,
    });
  });

  it("rejects malformed amounts before calling the API", async () => {
    const calls = signIn(owner);
    renderApp(<App />, "/admin/delivery-zones");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Zone name"), "Dokki");
    await user.type(screen.getByLabelText("Delivery fee (EGP)"), "5,5");
    await user.click(screen.getByRole("button", { name: "Add zone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter amounts as numbers/);
    expect(sent(calls, "POST", "/admin/delivery-zones")).toHaveLength(0);
  });

  it("staff see zones read-only", async () => {
    signIn(staff);
    renderApp(<App />, "/admin/delivery-zones");
    expect(await screen.findByText(/Only the owner can change zones/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add zone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });
});

describe("customer-facing schedule", () => {
  it("shows opening hours in the footer", async () => {
    mockFetch({ ...store, "/categories": { body: categories }, "/occasions": { body: occasions }, "/products": { body: { items: [], total: 0, page: 1, page_size: 4, total_pages: 1 } } });
    renderApp(<App />, "/");
    const footer = await screen.findByRole("contentinfo");
    expect(await within(footer).findByText("Friday")).toBeInTheDocument();
    expect(within(footer).getAllByText("9:00 AM to 9:00 PM")).toHaveLength(6);
    expect(within(footer).getByText("1:00 PM to 9:00 PM")).toBeInTheDocument(); // Friday opens later
    expect(within(footer).getByRole("link", { name: "Delivery areas and fees" })).toHaveAttribute("href", "/delivery");
  });

  it("the delivery page lists areas, fees and minimums, including free delivery", async () => {
    mockFetch({ ...store, "/delivery-zones": { body: [zones[0], { ...zones[1], is_active: true }] } });
    const { container } = renderApp(<App />, "/delivery");
    const table = await screen.findByRole("table", { name: /Delivery areas/ });
    expect(within(table).getByRole("rowheader", { name: "Maadi" })).toBeInTheDocument();
    expect(within(table).getByText("Free")).toBeInTheDocument();
    expect(within(table).getByText("None")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("product page shows the earliest delivery and pickup dates for the cart", async () => {
    const calls = mockFetch({
      ...store,
      "/products/triple-chocolate-cake": { body: detail },
      "/availability/dates": { body: { earliest_date: "2030-12-04", days: [] } },
    });
    renderApp(<App />, "/products/triple-chocolate-cake");
    expect(await screen.findByText("Earliest delivery")).toBeInTheDocument();
    expect(screen.getAllByText("Wednesday 4 December")).toHaveLength(2);
    const urls = calls.map((c) => c.url).filter((u) => u.includes("/availability/dates"));
    expect(urls.some((u) => u.includes("fulfilment=delivery") && u.includes("items=10"))).toBe(true);
    expect(urls.some((u) => u.includes("fulfilment=pickup"))).toBe(true);
  });

  it("product page says so when there are no dates soon", async () => {
    mockFetch({ ...store, "/products/triple-chocolate-cake": { body: detail }, "/availability/dates": { body: { earliest_date: null, days: [] } } });
    renderApp(<App />, "/products/triple-chocolate-cake");
    expect(await screen.findAllByText("No dates available soon")).toHaveLength(2);
  });
});

describe("product days on sale", () => {
  it("saves the weekdays a product is sold", async () => {
    const calls = signIn(owner, {
      "/admin/products/1": { body: adminProduct },
      "PATCH /admin/products/1": { body: adminProduct },
      "PUT /admin/products/1/availability": { body: adminProduct },
      "/admin/categories": { body: categories.map((c) => ({ ...c, sort_order: 0, is_archived: false })) },
      "/admin/occasions": { body: occasions.map((o) => ({ ...o, sort_order: 0, is_archived: false })) },
    });
    renderApp(<App />, "/admin/products/1");
    const user = userEvent.setup();
    const tuesday = await screen.findByLabelText("Tuesday");
    expect(tuesday).toBeChecked();
    await user.click(tuesday);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent(calls, "PUT", "/admin/products/1/availability")).toHaveLength(1));
    expect(JSON.parse(sent(calls, "PUT", "/admin/products/1/availability")[0].init!.body as string)).toEqual({ available_weekdays: [0, 2, 3, 4, 5, 6] });
  });
});
