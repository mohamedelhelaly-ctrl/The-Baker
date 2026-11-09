import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { changeable, customer, datesBody, POLICY, publicZones, slotsBody } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"], cancellation_window_hours: 24, policy_text: POLICY } } };
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(call.init!.body as string);
const open = (order: unknown, extra: Record<string, { status?: number; body: unknown }> = {}) =>
  mockFetch({ ...store, "/orders/BK-ABC234": { body: order }, ...extra });

describe("change or cancel on the order page", () => {
  it("tells the customer until when they can change the order and what the rules are", async () => {
    open(changeable);
    const { container } = renderApp(<App />, "/track/BK-ABC234?t=tok");
    const section = (await screen.findByRole("heading", { level: 2, name: "Change or cancel this order" })).closest("section")!;
    expect(within(section).getByText(/You can change or cancel it until/)).toBeInTheDocument();
    expect(within(section).getByText(/refunded in full/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Change date, time or address" })).toHaveAttribute("href", "/track/BK-ABC234/change?t=tok");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains that the time has passed instead of offering buttons", async () => {
    open({ ...changeable, can_change: false });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    expect(await screen.findByText(/time to change or cancel this order online has passed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel this order/ })).not.toBeInTheDocument();
  });

  it("offers nothing once the bakery is preparing the order", async () => {
    open({ ...changeable, status: "preparing", can_change: false });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
    expect(screen.queryByRole("heading", { name: /Change or cancel|Need to change/ })).not.toBeInTheDocument();
  });

  it("asks for confirmation, then cancels and shows the result", async () => {
    const cancelled = { ...changeable, status: "cancelled", can_change: false, cancellation_reason: "You cancelled this order. Your note: Plans changed" };
    const calls = open(changeable, { "POST /orders/BK-ABC234/cancel": { body: cancelled } });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this order…" }));
    expect(screen.getByText("Are you sure you want to cancel?")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), "Plans changed");
    await user.click(screen.getByRole("button", { name: "Yes, cancel my order" }));
    expect(await screen.findByText("This order was cancelled")).toBeInTheDocument();
    expect(screen.getByText(/Plans changed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel this order/ })).not.toBeInTheDocument();
    const [call] = sent(calls, "POST", "/cancel");
    expect(call.url).toContain("t=tok");
    expect(bodyOf(call)).toEqual({ reason: "Plans changed" });
  });

  it("says how much of a card payment comes back before the customer decides", async () => {
    open({ ...changeable, payment_method: "card", payment_status: "paid", cancel_refund: 80000, total: 100000 });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this order…" }));
    expect(screen.getByText(/800\.00.*will be refunded, as our policy says/)).toBeInTheDocument();
  });

  it("says plainly when the policy keeps the payment", async () => {
    open({ ...changeable, payment_method: "card", payment_status: "paid", cancel_refund: 0 });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this order…" }));
    expect(screen.getByText(/not refunded when you cancel/)).toBeInTheDocument();
  });

  it("shows the server's reason when cancelling fails, and keeps the order", async () => {
    open(changeable, { "POST /orders/BK-ABC234/cancel": { status: 409, body: { error: { code: "window_closed", message: "The time to change or cancel this order has passed. Please contact the bakery." } } } });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this order…" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel my order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The time to change or cancel this order has passed");
    expect(screen.getByRole("heading", { level: 1, name: "Order BK-ABC234" })).toBeInTheDocument();
  });

  it("does not send a second cancel on a double click", async () => {
    const calls = open(changeable, { "POST /orders/BK-ABC234/cancel": { body: { ...changeable, status: "cancelled", can_change: false } } });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this order…" }));
    const confirm = screen.getByRole("button", { name: "Yes, cancel my order" });
    await Promise.all([user.click(confirm), user.click(confirm)]);
    await waitFor(() => expect(sent(calls, "POST", "/cancel")).toHaveLength(1));
  });
});

describe("change order page", () => {
  const dateRoutes = { "/delivery-zones": { body: publicZones }, "/availability/dates": { body: datesBody }, "/availability/slots": { body: slotsBody } };
  const openChange = (order: unknown = changeable, extra: Record<string, { status?: number; body: unknown }> = {}) =>
    open(order, { ...dateRoutes, ...extra });

  it("shows the current details and keeps the items out of reach", async () => {
    openChange();
    const { container } = renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    expect(await screen.findByRole("heading", { level: 1, name: "Change order BK-ABC234" })).toBeInTheDocument();
    expect(screen.getByLabelText("Street")).toHaveValue("12 Road 9");
    expect(screen.getByLabelText("Building")).toHaveValue("5");
    expect(screen.getByLabelText(/Notes for the bakery/)).toHaveValue("Ring twice");
    expect(await screen.findByRole("option", { name: /Maadi/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Zamalek/ })).toBeInTheDocument(); // cash orders may change the fee
    expect(screen.getByText(/The items stay as ordered/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves new notes and address, then returns to the order with a confirmation", async () => {
    const calls = openChange(changeable, { "PATCH /orders/BK-ABC234": { body: { ...changeable, customer_notes: "Call me" } } });
    renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    const user = userEvent.setup();
    await screen.findByRole("option", { name: /Maadi/ });
    await user.clear(await screen.findByLabelText("Street"));
    await user.type(screen.getByLabelText("Street"), "7 Nile Corniche");
    await user.clear(screen.getByLabelText(/Notes for the bakery/));
    await user.type(screen.getByLabelText(/Notes for the bakery/), "Call me");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Your order was updated")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Order BK-ABC234" })).toBeInTheDocument();
    const [call] = sent(calls, "PATCH", "/orders/BK-ABC234");
    expect(call.url).toContain("t=tok");
    const body = bodyOf(call);
    expect(body.customer_notes).toBe("Call me");
    expect(body.zone_id).toBe(1);
    expect(body.address.street).toBe("7 Nile Corniche");
    expect(body).not.toHaveProperty("slot_id"); // the time was not touched
  });

  it("sends the new date and time when the customer picks them", async () => {
    const calls = openChange(changeable, { "PATCH /orders/BK-ABC234": { body: changeable } });
    renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/Delivery date/), "2030-12-05");
    await user.click(await screen.findByRole("radio", { name: /10:00 AM to 12:00 PM/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent(calls, "PATCH", "/orders/BK-ABC234")).toHaveLength(1));
    expect(bodyOf(sent(calls, "PATCH", "/orders/BK-ABC234")[0])).toMatchObject({ date: "2030-12-05", slot_id: 1 });
  });

  it("asks for a time when only a new date was chosen", async () => {
    const calls = openChange();
    renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/Delivery date/), "2030-12-05");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a time for the new date.");
    expect(sent(calls, "PATCH", "/orders/BK-ABC234")).toHaveLength(0);
  });

  it("shows why the bakery cannot make the change", async () => {
    openChange(changeable, { "PATCH /orders/BK-ABC234": { status: 409, body: { error: { code: "cannot_change_to_that", message: "That time slot is fully booked.", fields: { slot: "That time slot is fully booked." } } } } });
    renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/Delivery date/), "2030-12-05");
    await user.click(await screen.findByRole("radio", { name: /10:00 AM to 12:00 PM/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("We could not save your changes")).toBeInTheDocument();
    expect(screen.getAllByText("That time slot is fully booked.").length).toBeGreaterThan(0);
  });

  it("only offers areas with the same delivery fee to a customer who has paid", async () => {
    openChange({ ...changeable, payment_method: "card", payment_status: "paid", delivery_fee: 4000, zone_id: 1 });
    renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    expect(await screen.findByText(/same delivery fee/)).toBeInTheDocument();
    const area = await screen.findByLabelText("Delivery area");
    await screen.findByRole("option", { name: /Maadi/ });
    const names = within(area).getAllByRole("option").map((o) => o.textContent);
    expect(names.some((n) => /Zamalek/.test(n ?? ""))).toBe(false); // a different fee
  });

  it("says the order cannot be changed any more", async () => {
    openChange({ ...changeable, can_change: false });
    renderApp(<App />, "/track/BK-ABC234/change?t=tok");
    expect(await screen.findByText(/can no longer be changed online/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("a signed-in customer can change their order without the link token", async () => {
    localStorage.setItem("baker.token", "tok");
    const calls = openChange(changeable, { "/auth/me": { body: customer }, "PATCH /orders/BK-ABC234": { body: changeable } });
    renderApp(<App />, "/track/BK-ABC234/change");
    const user = userEvent.setup();
    await screen.findByRole("option", { name: /Maadi/ });
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent(calls, "PATCH", "/orders/BK-ABC234")).toHaveLength(1));
    expect(sent(calls, "PATCH", "/orders/BK-ABC234")[0].url).not.toContain("t=");
  });
});
