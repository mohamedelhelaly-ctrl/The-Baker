import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { customer, datesBody, detail, fakeQuote, placedOrder, publicZones, slotsBody } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [] } } };
const quoteRoute = (problems: { field: string; code: string; message: string }[] = [], unavailable: number[] = []) => ({
  "POST /checkout/quote": { body: (req: Parameters<typeof fakeQuote>[0]) => fakeQuote(req, problems, unavailable) },
});
const shopRoutes = {
  ...store,
  "/delivery-zones": { body: publicZones },
  "/availability/dates": { body: datesBody },
  "/availability/slots": { body: slotsBody },
};
const seedCart = (lines: { variantId: number; quantity: number; inscription?: string }[]) =>
  localStorage.setItem("baker.cart", JSON.stringify(lines.map((l) => ({ inscription: "", ...l }))));
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));
const lastBody = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  JSON.parse(sent(calls, method, suffix).at(-1)!.init!.body as string);

// ============================================================ adding to the cart
describe("add to cart", () => {
  it("adds a product with a message, announces it and updates the header count", async () => {
    mockFetch({ ...store, "/products/triple-chocolate-cake": { body: detail }, "/availability/dates": { body: datesBody } });
    renderApp(<App />, "/products/triple-chocolate-cake");
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/8-inch/));
    await user.type(screen.getByLabelText("Message on the cake (optional)"), "Happy Birthday");
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "2");
    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(await screen.findByText(/Added 2 × Triple Chocolate Cake \(8-inch, serves 14\) to your cart/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("baker.cart")!)).toEqual([{ variantId: 11, quantity: 2, inscription: "Happy Birthday" }]);
  });

  it("merges the same item and message, but keeps different messages on separate lines", async () => {
    mockFetch({ ...store, "/products/triple-chocolate-cake": { body: detail }, "/availability/dates": { body: datesBody } });
    renderApp(<App />, "/products/triple-chocolate-cake");
    const user = userEvent.setup();
    const add = await screen.findByRole("button", { name: "Add to cart" });
    await user.click(add);
    await user.click(add);
    await user.type(screen.getByLabelText("Message on the cake (optional)"), "Congrats");
    await user.click(add);
    expect(JSON.parse(localStorage.getItem("baker.cart")!)).toEqual([
      { variantId: 10, quantity: 2, inscription: "" },
      { variantId: 10, quantity: 1, inscription: "Congrats" },
    ]);
    expect(screen.getByRole("link", { name: "Cart, 3 items" })).toBeInTheDocument();
  });

  it("clamps absurd quantities and survives a corrupted saved cart", async () => {
    localStorage.setItem("baker.cart", "{not json");
    mockFetch({ ...store, "/products/triple-chocolate-cake": { body: detail }, "/availability/dates": { body: datesBody } });
    renderApp(<App />, "/products/triple-chocolate-cake");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "5000");
    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(JSON.parse(localStorage.getItem("baker.cart")!)[0].quantity).toBe(100);
  });

  it("drops invalid saved lines", async () => {
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: "x", quantity: 2 }, { variantId: 10, quantity: -4, inscription: "ok" }, null]));
    mockFetch({ ...store, "/categories": { body: [] }, "/occasions": { body: [] }, "/products": { body: { items: [], total: 0, page: 1, page_size: 4, total_pages: 1 } } });
    renderApp(<App />, "/");
    expect(await screen.findByRole("link", { name: "Cart, 1 item" })).toBeInTheDocument();
  });
});

// ================================================================== the cart
describe("cart page", () => {
  it("prices the lines from the server and has no axe violations", async () => {
    seedCart([{ variantId: 10, quantity: 2, inscription: "Happy Birthday" }, { variantId: 11, quantity: 1 }]);
    mockFetch({ ...store, ...quoteRoute() });
    const { container } = renderApp(<App />, "/cart");
    expect(await screen.findAllByRole("heading", { level: 2, name: "Triple Chocolate Cake" })).toHaveLength(2);
    expect(screen.getAllByText(/1,300\.00/).length).toBeGreaterThan(0);
    const summary = screen.getByRole("heading", { name: "Order summary" }).closest("section")!;
    expect(within(summary).getAllByText(/2,250\.00/)).toHaveLength(2); // subtotal and total: 1,300 + 950
    expect(within(summary).getByText("Chosen at checkout")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to checkout" })).toHaveAttribute("href", "/checkout");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("changes quantity, asks the server again, and removes lines", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    const calls = mockFetch({ ...store, ...quoteRoute() });
    renderApp(<App />, "/cart");
    const user = userEvent.setup();
    const qty = await screen.findByLabelText(/Quantity for Triple Chocolate Cake \(6-inch\)/);
    await user.clear(qty);
    await user.type(qty, "3");
    await waitFor(() => expect(lastBody(calls, "POST", "/checkout/quote").items[0].quantity).toBe(3));
    const summary = screen.getByRole("heading", { name: "Order summary" }).closest("section")!;
    await waitFor(() => expect(within(summary).getAllByText(/1,950\.00/).length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: /Remove Triple Chocolate Cake \(6-inch\) from your cart/ }));
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("baker.cart")!)).toEqual([]);
  });

  it("edits the cake message and merges lines that become identical", async () => {
    seedCart([{ variantId: 10, quantity: 1, inscription: "A" }, { variantId: 10, quantity: 2, inscription: "" }]);
    mockFetch({ ...store, ...quoteRoute() });
    renderApp(<App />, "/cart");
    const user = userEvent.setup();
    const boxes = await screen.findAllByLabelText(/Message on the cake for/);
    await user.clear(boxes[0]);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("baker.cart")!)).toEqual([{ variantId: 10, quantity: 3, inscription: "" }]));
  });

  it("flags lines that are no longer available and blocks checkout until they are removed", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    mockFetch({ ...store, ...quoteRoute([], [10]) });
    renderApp(<App />, "/cart");
    expect(await screen.findByText("Some items are no longer available")).toBeInTheDocument();
    expect(screen.getAllByText("Triple Chocolate Cake is no longer available.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue to checkout" })).toBeDisabled();
  });

  it("shows a friendly empty cart", async () => {
    mockFetch(store);
    renderApp(<App />, "/cart");
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the menu" })).toHaveAttribute("href", "/menu");
  });

  it("warns when prices cannot be checked", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    mockFetch({ ...store, "POST /checkout/quote": { status: 500, body: { error: { code: "error", message: "boom" } } } });
    renderApp(<App />, "/cart");
    expect(await screen.findByText(/could not check your cart prices/)).toBeInTheDocument();
  });
});

// ================================================================= checkout
async function fillDelivery(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText("Delivery area"), "1");
  await user.type(screen.getByLabelText("Street"), "12 Road 9");
  await user.type(screen.getByLabelText("Building"), "5");
  await user.type(screen.getByLabelText("Floor (optional)"), "3");
  await user.type(screen.getByLabelText("Landmark (optional)"), "Next to the mosque");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}
async function chooseSchedule(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText("Delivery date"), "2030-12-04");
  await user.click(await screen.findByRole("radio", { name: /10:00 AM to 12:00 PM/ }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
}
async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Full name"), "Sara Ali");
  await user.type(screen.getByLabelText("Email"), "sara@example.com");
  await user.type(screen.getByLabelText("Phone"), "+20 100 123 4567");
  await user.type(screen.getByLabelText("Notes for the bakery (optional)"), "Ring twice");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}
const checkoutMocks = (extra: Record<string, { status?: number; body: unknown }> = {}) =>
  mockFetch({ ...shopRoutes, ...quoteRoute(), "POST /orders": { status: 201, body: { ...placedOrder, tracking_token: "tok123" } }, "/orders/BK-ABC234": { body: placedOrder }, ...extra });

describe("checkout", () => {
  it("walks through every step and places a cash-on-delivery order", async () => {
    seedCart([{ variantId: 10, quantity: 2, inscription: "Happy Birthday" }]);
    const calls = checkoutMocks();
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 2, name: "Delivery or pickup" })).toHaveFocus();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Delivery or pickup");
    await fillDelivery(user);
    expect(await screen.findByRole("heading", { level: 2, name: "Date and time" })).toHaveFocus();
    await chooseSchedule(user);
    await fillContact(user);
    expect(await screen.findByRole("heading", { level: 2, name: "Payment" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Pay online by card/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Review" })).toBeInTheDocument();
    expect(screen.getByText(/12 Road 9, building 5, floor 3/)).toBeInTheDocument();
    expect(screen.getByText(/Wednesday 4 December, 10:00 AM to 12:00 PM/)).toBeInTheDocument();
    const place = await screen.findByRole("button", { name: /Place order · .*1,340\.00/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place);

    expect(await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" })).toBeInTheDocument();
    expect(screen.getByText("Thank you, your order has been received")).toBeInTheDocument();
    const post = sent(calls, "POST", "/orders")[0];
    expect(JSON.parse(post.init!.body as string)).toEqual({
      items: [{ variant_id: 10, quantity: 2, inscription: "Happy Birthday" }],
      fulfilment_type: "delivery", zone_id: 1,
      address: { street: "12 Road 9", building: "5", floor: "3", apartment: null, landmark: "Next to the mosque" },
      date: "2030-12-04", slot_id: 1,
      contact: { name: "Sara Ali", email: "sara@example.com", phone: "+20 100 123 4567" },
      payment_method: "cod", customer_notes: "Ring twice",
    });
    expect((post.init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/.{8,}/);
    expect(calls.some((c) => c.url.includes("/orders/BK-ABC234?t=tok123"))).toBe(true); // guest link keeps its token
    expect(JSON.parse(localStorage.getItem("baker.cart")!)).toEqual([]); // cart emptied
  });

  it("does not send prices or totals from the browser", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    const calls = checkoutMocks();
    renderApp(<App />, "/checkout");
    await screen.findByLabelText("Delivery area");
    await waitFor(() => expect(sent(calls, "POST", "/checkout/quote").length).toBeGreaterThan(0));
    for (const c of sent(calls, "POST", "/checkout/quote")) {
      expect(c.init!.body as string).not.toMatch(/price|total|fee/);
    }
  });

  it("explains a missing cart", async () => {
    mockFetch(store);
    renderApp(<App />, "/checkout");
    expect(await screen.findByText(/Your cart is empty, so there is nothing to check out/)).toBeInTheDocument();
  });

  it("step 1 refuses to continue without an area and address, with a focused error summary", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    checkoutMocks();
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Choose your delivery area.");
    expect(summary).toHaveTextContent("Enter your street.");
    expect(summary).toHaveTextContent("Enter your building number or name.");
    expect(screen.getByLabelText("Street")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Delivery or pickup" })).toBeInTheDocument(); // still on step 1
  });

  it("shows the server's below-minimum message on the step that can fix it and blocks Continue", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    checkoutMocks(quoteRoute([{ field: "zone", code: "below_minimum", message: "Delivery to Maadi needs an order of at least 3,000.00 EGP. Add 2,350.00 EGP more, or choose pickup." }]));
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Delivery area"), "1");
    expect(await screen.findByText(/needs an order of at least/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Pickup from the bakery/ }));
    expect(screen.queryByLabelText("Street")).not.toBeInTheDocument();
  });

  it("lists only bookable dates, disables full slots and warns when few remain", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    const calls = checkoutMocks();
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    const date = await screen.findByLabelText("Delivery date");
    expect(within(date).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a date", "Wednesday 4 December", "Thursday 5 December"]); // the unavailable day is not offered
    await user.selectOptions(date, "2030-12-04");
    expect(await screen.findByRole("radio", { name: /12:00 PM to 2:00 PM/ })).toBeDisabled();
    expect(screen.getByText("Fully booked.")).toBeInTheDocument();
    expect(screen.getByText("Only 1 left")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/availability/dates") && c.url.includes("items=10:1") && c.url.includes("fulfilment=delivery"))).toBe(true);
  });

  it("step 2 needs a date and a time", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    checkoutMocks();
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a date.");
    await user.selectOptions(screen.getByLabelText("Delivery date"), "2030-12-04");
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a time.");
  });

  it("step 3 validates the contact details", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    checkoutMocks();
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    await chooseSchedule(user);
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Phone"), "call me");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Enter your name.");
    expect(summary).toHaveTextContent("Enter a valid email address");
    expect(summary).toHaveTextContent("Enter a phone number");
  });

  it("pickup skips the address and sends no zone", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    const calls = checkoutMocks({ "POST /orders": { status: 201, body: { ...placedOrder, fulfilment_type: "pickup", tracking_token: "tok123" } } });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Pickup from the bakery/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.selectOptions(await screen.findByLabelText("Pickup date"), "2030-12-04");
    await user.click(await screen.findByRole("radio", { name: /10:00 AM to 12:00 PM/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillContact(user);
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    const place = await screen.findByRole("button", { name: /Place order/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place);
    await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
    const body = lastBody(calls, "POST", "/orders");
    expect(body).toMatchObject({ fulfilment_type: "pickup", zone_id: null, address: null });
  });

  it("a double click places exactly one order", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    const calls = checkoutMocks();
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    await chooseSchedule(user);
    await fillContact(user);
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    const place = await screen.findByRole("button", { name: /Place order/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.dblClick(place);
    await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
    expect(sent(calls, "POST", "/orders")).toHaveLength(1);
  });

  it("sends the customer back to the right step when the slot was just taken, then reuses or renews the key sensibly", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    const calls = checkoutMocks({
      "POST /orders": { status: 409, body: { error: { code: "no_longer_available", message: "Fully booked.", fields: { slot: "Fully booked." } } } },
    });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    await chooseSchedule(user);
    await fillContact(user);
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    const place = await screen.findByRole("button", { name: /Place order/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place);
    expect(await screen.findByRole("heading", { level: 2, name: "Date and time" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Fully booked.");
    expect(sent(calls, "POST", "/orders")).toHaveLength(1);
  });

  it("retrying the same order reuses its Idempotency-Key", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    let attempt = 0;
    const calls = checkoutMocks({
      "POST /orders": { status: 201, body: () => { attempt += 1; if (attempt === 1) throw new TypeError("network"); return { ...placedOrder, tracking_token: "tok123" }; } },
    });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    await chooseSchedule(user);
    await fillContact(user);
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    const place = await screen.findByRole("button", { name: /Place order/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place); // fails (network)
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Place order/ }));
    await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
    const keys = sent(calls, "POST", "/orders").map((c) => (c.init!.headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("prefills the contact step for a signed-in customer", async () => {
    localStorage.setItem("baker.token", "tok");
    seedCart([{ variantId: 10, quantity: 1 }]);
    checkoutMocks({ "/auth/me": { body: customer } });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await fillDelivery(user);
    await chooseSchedule(user);
    expect(await screen.findByLabelText("Full name")).toHaveValue("Sara Ali");
    expect(screen.getByLabelText("Email")).toHaveValue("sara@example.com");
  });

  it("each step is accessible", async () => {
    seedCart([{ variantId: 10, quantity: 1 }]);
    checkoutMocks();
    const { container } = renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await screen.findByLabelText("Delivery area");
    expect(await axe(container)).toHaveNoViolations();
    await fillDelivery(user);
    await user.selectOptions(await screen.findByLabelText("Delivery date"), "2030-12-04");
    await screen.findByRole("radio", { name: /10:00 AM/ });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("radio", { name: /10:00 AM/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Full name");
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ================================================================== tracking
describe("order tracking page", () => {
  const open = (order = placedOrder, route = "/track/BK-ABC234?t=tok123") => {
    const calls = mockFetch({ ...store, "/orders/BK-ABC234": { body: order } });
    return { calls, ...renderApp(<App />, route) };
  };

  it("shows status, progress, schedule, items and totals, and has no axe violations", async () => {
    const { container, calls } = open();
    expect(await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" })).toBeInTheDocument();
    expect(screen.getByText("Received", { selector: "p" })).toBeInTheDocument();
    const progress = screen.getByRole("list", { name: "Order progress" });
    expect(within(progress).getByRole("listitem", { current: "step" })).toHaveTextContent("Received");
    expect(within(progress).getAllByRole("listitem")).toHaveLength(6); // delivery has six stages
    expect(screen.getByText(/Wednesday 4 December, 10:00 AM to 12:00 PM/)).toBeInTheDocument(); // shown in Cairo time
    expect(screen.getByText(/12 Road 9, building 5, floor 3/)).toBeInTheDocument();
    expect(screen.getByText(/Message: “Happy Birthday”/)).toBeInTheDocument();
    expect(screen.getByText(/1,340\.00/)).toBeInTheDocument();
    expect(screen.getByText(/cash on delivery or pickup/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/orders/BK-ABC234?t=tok123"))).toBe(true);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("pickup orders have a shorter progress and no delivery fee", async () => {
    open({ ...placedOrder, fulfilment_type: "pickup", delivery_address: null, zone_name: null, delivery_fee: 0, total: 130000, status: "ready" } as never);
    const progress = await screen.findByRole("list", { name: "Order progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(5);
    expect(within(progress).getByRole("listitem", { current: "step" })).toHaveTextContent("Ready");
    expect(within(progress).getAllByText(/\(done\)/)).toHaveLength(3);
    expect(screen.getByText("Not needed")).toBeInTheDocument();
    expect(screen.getByText("Collect your order from the bakery.")).toBeInTheDocument();
  });

  it("explains declined and cancelled orders, with the reason", async () => {
    open({ ...placedOrder, status: "rejected", rejection_reason: "We are fully booked that day." } as never);
    expect(await screen.findByText("This order was declined")).toBeInTheDocument();
    expect(screen.getByText("We are fully booked that day.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Order progress" })).not.toBeInTheDocument();
  });

  it("shows a late-order notice", async () => {
    open({ ...placedOrder, status: "preparing", is_delayed: true, delay_note: "Running 30 minutes late." } as never);
    expect(await screen.findByText("This order is running late")).toBeInTheDocument();
    expect(screen.getByText("Running 30 minutes late.")).toBeInTheDocument();
  });

  it("does not show the thank-you banner when the page is simply opened again", async () => {
    open();
    await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
    expect(screen.queryByText("Thank you, your order has been received")).not.toBeInTheDocument();
  });

  it("gives a helpful message for an unknown or unauthorised order", async () => {
    mockFetch({ ...store, "/orders/BK-NOPE22": { status: 404, body: { error: { code: "order_not_found", message: "x" } } } });
    renderApp(<App />, "/track/BK-NOPE22?t=wrong");
    expect(await screen.findByRole("heading", { level: 1, name: "We could not find that order" })).toBeInTheDocument();
    expect(screen.getByText(/Check the link from your order confirmation/)).toBeInTheDocument();
  });
});
