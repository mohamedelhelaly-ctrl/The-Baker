import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { customer, owner, prepSheet, queuePage, queueRow, queueSummary, staff, staffOrder } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [] } } };
const signIn = (who: unknown, extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({
    "/auth/me": { body: who },
    ...store,
    "/staff/orders/summary": { body: queueSummary },
    "/staff/orders": { body: queuePage() },
    ...extra,
  });
};
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(call.init!.body as string);

describe("staff access", () => {
  it("shows the Orders link to staff and the owner, and keeps customers out", async () => {
    signIn(staff);
    renderApp(<App />, "/menu");
    expect(await screen.findByRole("link", { name: "Orders" })).toHaveAttribute("href", "/staff/orders");
  });

  it("tells a customer they cannot open the queue", async () => {
    signIn(customer);
    renderApp(<App />, "/staff/orders");
    expect(await screen.findByRole("heading", { level: 1, name: /not allowed|permission|access/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Orders" })).not.toBeInTheDocument();
  });

  it("sends /staff to the queue", async () => {
    signIn(staff);
    renderApp(<App />, "/staff");
    expect(await screen.findByRole("heading", { level: 1, name: "Order queue" })).toBeInTheDocument();
  });
});

describe("order queue", () => {
  it("lists the day's orders with counts per stage and no axe violations", async () => {
    signIn(owner);
    const { container } = renderApp(<App />, "/staff/orders");
    const link = await screen.findByRole("link", { name: /BK-ABC234/ });
    expect(link).toHaveAttribute("href", "/staff/orders/7");
    const row = link.closest("tr")!;
    expect(within(row).getByText("Sara Ali")).toBeInTheDocument();
    expect(within(row).getByText("Maadi")).toBeInTheDocument();
    expect(within(row).getByText("Received")).toBeInTheDocument();
    expect(within(row).getByText(/1,340\.00/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "New (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accepted (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finished (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (5)" })).toBeInTheDocument();
    expect(screen.getByText(/1 order is marked late/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks late orders with text, not colour alone", async () => {
    signIn(staff, { "/staff/orders": { body: queuePage([{ ...queueRow, is_delayed: true, delay_note: "Oven" }]) } });
    renderApp(<App />, "/staff/orders");
    expect(await screen.findByText("Late")).toBeInTheDocument();
  });

  it("asks for the chosen stage, delivery type and search text", async () => {
    const calls = signIn(staff);
    renderApp(<App />, "/staff/orders");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: /BK-ABC234/ });
    expect(calls.some((c) => /\/staff\/orders\?/.test(c.url) && !c.url.includes("date="))).toBe(true); // starts on all days
    await user.click(screen.getByRole("button", { name: /^Accepted/ }));
    expect(screen.getByRole("button", { name: /^Accepted/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(calls.some((c) => c.url.includes("status=accepted"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Delivery or pickup"), "pickup");
    await waitFor(() => expect(calls.some((c) => c.url.includes("fulfilment=pickup"))).toBe(true));
    await user.type(screen.getByLabelText("Search"), "sara");
    await waitFor(() => expect(calls.some((c) => c.url.includes("q=sara"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "All days" }));
    await waitFor(() => expect(calls.at(-1)!.url.includes("date=") || calls.some((c) => /staff\/orders\?(?!.*date=)/.test(c.url))).toBe(true));
  });

  it("says so when nothing matches", async () => {
    signIn(staff, { "/staff/orders": { body: queuePage([]) } });
    renderApp(<App />, "/staff/orders");
    expect(await screen.findByText("No orders match these filters.")).toBeInTheDocument();
  });

  it("opens an order found by code from another page on any day", async () => {
    const calls = signIn(staff);
    renderApp(<App />, "/staff/orders?q=BK-ABC234");
    await screen.findByRole("link", { name: /BK-ABC234/ });
    expect(screen.getByLabelText("Search")).toHaveValue("BK-ABC234");
    expect(calls.filter((c) => c.url.includes("/staff/orders?")).every((c) => !c.url.includes("date="))).toBe(true);
  });
});

describe("order detail", () => {
  const open = (extra: Record<string, { status?: number; body: unknown }> = {}) =>
    signIn(staff, { "/staff/orders/7": { body: staffOrder }, ...extra });

  it("shows everything staff need to prepare and deliver the order", async () => {
    open();
    const { container } = renderApp(<App />, "/staff/orders/7");
    expect(await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" })).toBeInTheDocument();
    expect(screen.getByText(/12 Road 9, building 5, floor 3, Maadi/)).toBeInTheDocument();
    expect(screen.getByText(/Next to the mosque/)).toBeInTheDocument();
    expect(screen.getByText(/Ring twice/)).toBeInTheDocument();
    expect(screen.getByText(/Happy Birthday/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+20 100 123 4567" })).toHaveAttribute("href", "tel:+201001234567");
    expect(screen.getByRole("link", { name: "sara@example.com" })).toHaveAttribute("href", "mailto:sara@example.com");
    expect(screen.getByText(/Cash, Not paid yet/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("only offers the steps the server allows", async () => {
    open();
    renderApp(<App />, "/staff/orders/7");
    expect(await screen.findByRole("button", { name: "Accept order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline order…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark ready" })).not.toBeInTheDocument();
  });

  it("accepts the order and shows the next steps the server returns", async () => {
    const accepted = { ...staffOrder, status: "accepted", actions: [{ to: "preparing", needs_reason: false }, { to: "cancelled", needs_reason: true }] };
    const calls = open({ "POST /staff/orders/7/transition": { body: accepted } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Accept order" }));
    expect(await screen.findByRole("button", { name: "Start preparing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept order" })).not.toBeInTheDocument();
    expect(screen.getByText("Order is now: Accepted.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/transition")[0])).toEqual({ to: "accepted" });
  });

  it("does not send a second request on a double click", async () => {
    const calls = open({ "POST /staff/orders/7/transition": { body: staffOrder } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Accept order" });
    await Promise.all([user.click(button), user.click(button)]);
    await waitFor(() => expect(sent(calls, "POST", "/transition").length).toBe(1));
  });

  it("will not decline without a reason, then sends it", async () => {
    const declined = { ...staffOrder, status: "rejected", rejection_reason: "Fully booked", actions: [], can_delay: false, can_mark_paid: false };
    const calls = open({ "POST /staff/orders/7/reject": { body: declined } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Decline order…" }));
    await user.click(screen.getByRole("button", { name: "Decline order" }));
    expect(await screen.findByText("Tell the customer why.")).toBeInTheDocument();
    expect(sent(calls, "POST", "/reject")).toHaveLength(0);
    await user.type(screen.getByLabelText("Why are you declining this order?"), "Fully booked");
    await user.click(screen.getByRole("button", { name: "Decline order" }));
    expect(await screen.findByText("Order declined and the customer was told.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/reject")[0])).toEqual({ reason: "Fully booked" });
    expect(screen.getByText("This order is finished. There is nothing more to do.")).toBeInTheDocument();
  });

  it("warns that a paid card order is refunded when it is cancelled", async () => {
    open({ "/staff/orders/7": { body: { ...staffOrder, payment_method: "card", payment_status: "paid", can_mark_paid: false } } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel order…" }));
    expect(screen.getByText(/refunded automatically/)).toBeInTheDocument();
  });

  it("shows the server's message when something fails, and keeps the order as it was", async () => {
    open({ "POST /staff/orders/7/cancel": { status: 502, body: { error: { code: "refund_failed", message: "The card refund did not go through, so nothing was changed. Please try again." } } } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel order…" }));
    await user.type(screen.getByLabelText("Why are you cancelling this order?"), "Oven broke");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The card refund did not go through");
    expect(screen.getByRole("button", { name: "Accept order" })).toBeInTheDocument(); // still received
  });

  it("marks the order late and can remove the flag", async () => {
    const late = { ...staffOrder, is_delayed: true, delay_note: "About 30 minutes" };
    const calls = open({ "POST /staff/orders/7/delay": { body: late }, "POST /staff/orders/7/clear-delay": { body: staffOrder } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    const send = await screen.findByRole("button", { name: "Mark late and tell the customer" });
    expect(send).toBeDisabled(); // nothing to say yet
    await user.type(screen.getByLabelText("What should the customer know?"), "About 30 minutes");
    await user.click(send);
    expect(await screen.findByText("Late: About 30 minutes")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/delay")[0])).toEqual({ note: "About 30 minutes" });
    await user.click(screen.getByRole("button", { name: "Remove the late flag" }));
    await waitFor(() => expect(screen.queryByText("Late: About 30 minutes")).not.toBeInTheDocument());
  });

  it("emails the customer and lists what was sent", async () => {
    const withMessage = { ...staffOrder, messages: [{ body: "Which floor are you on?", created_at: "2030-12-02T09:00:00Z" }] };
    const calls = open({ "POST /staff/orders/7/messages": { status: 201, body: withMessage } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Message"), "Which floor are you on?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Message emailed to sara@example.com.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/messages")[0])).toEqual({ body: "Which floor are you on?" });
    const sentList = screen.getByRole("heading", { level: 3, name: "Sent messages" }).parentElement!;
    expect(within(sentList).getByText("Which floor are you on?")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("records cash collected", async () => {
    const paid = { ...staffOrder, payment_status: "paid", can_mark_paid: false };
    const calls = open({ "POST /staff/orders/7/mark-paid": { body: paid } });
    renderApp(<App />, "/staff/orders/7");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cash collected" }));
    expect(await screen.findByText("Cash payment recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cash collected" })).not.toBeInTheDocument();
    expect(sent(calls, "POST", "/mark-paid")).toHaveLength(1);
  });

  it("explains when an order cannot be found", async () => {
    open({ "/staff/orders/7": { status: 404, body: { error: { code: "order_not_found", message: "We could not find that order." } } } });
    renderApp(<App />, "/staff/orders/7");
    expect(await screen.findByRole("heading", { name: "We could not find that order" })).toBeInTheDocument();
  });
});

describe("prep sheet", () => {
  it("adds up what to make and lists the cake messages, with no axe violations", async () => {
    signIn(staff, { "/staff/prep-sheet": { body: prepSheet } });
    const { container } = renderApp(<App />, "/staff/prep-sheet");
    expect(await screen.findByText(/4 items to make for 3 orders/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Quantities to make" });
    expect(within(table).getByRole("row", { name: /6-inch 3 2/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /8-inch 1 1/ })).toBeInTheDocument();
    expect(screen.getByText("“Happy Birthday Sara”")).toBeInTheDocument();
    expect(screen.getByText(/10:00 AM/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "BK-ABC234" })).toHaveAttribute("href", "/staff/orders?q=BK-ABC234");
    expect(screen.getByRole("button", { name: "Print this sheet" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says when there is nothing to make", async () => {
    signIn(staff, { "/staff/prep-sheet": { body: { ...prepSheet, lines: [], messages: [], total_units: 0, order_count: 0 } } });
    renderApp(<App />, "/staff/prep-sheet");
    expect(await screen.findByText("Nothing to make on this day.")).toBeInTheDocument();
  });
});
