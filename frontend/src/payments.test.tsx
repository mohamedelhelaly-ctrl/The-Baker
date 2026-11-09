import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { redirectTo } from "./lib/navigation";
import { datesBody, fakeQuote, owner, placedOrder, publicZones, slotsBody, staff } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

vi.mock("./lib/navigation", () => ({ redirectTo: vi.fn() }));

const storeWith = (payment_methods: string[]) => ({
  "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods } },
});
const cardOrder = { ...placedOrder, status: "pending_payment", payment_method: "card", payment_status: "pending", events: [{ from_status: null, to_status: "pending_payment", reason: null, created_at: "2030-12-01T10:30:00Z" }] };
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(call.init!.body as string);

beforeEach(() => vi.mocked(redirectTo).mockReset());

// ================================================================ choosing how to pay
async function reachPayment(user: ReturnType<typeof userEvent.setup>) {
  const area = await screen.findByLabelText("Delivery area");
  await screen.findByRole("option", { name: /Maadi/ }); // the list loads after the field appears
  await user.selectOptions(area, "1");
  await user.type(screen.getByLabelText("Street"), "12 Road 9");
  await user.type(screen.getByLabelText("Building"), "5");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.selectOptions(await screen.findByLabelText("Delivery date"), "2030-12-04");
  await user.click(await screen.findByRole("radio", { name: /10:00 AM to 12:00 PM/ }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(await screen.findByLabelText("Full name"), "Sara Ali");
  await user.type(screen.getByLabelText("Email"), "sara@example.com");
  await user.type(screen.getByLabelText("Phone"), "+20 100 123 4567");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { level: 2, name: "Payment" });
}
const checkoutMocks = (methods: string[], extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 1, inscription: "" }]));
  return mockFetch({
    ...storeWith(methods),
    "/delivery-zones": { body: publicZones },
    "/availability/dates": { body: datesBody },
    "/availability/slots": { body: slotsBody },
    "POST /checkout/quote": { body: (req: Parameters<typeof fakeQuote>[0]) => fakeQuote(req) },
    "/orders/BK-ABC234": { body: cardOrder },
    ...extra,
  });
};

describe("payment choice at checkout", () => {
  it("offers card when the shop supports it, and sends the customer to the payment page", async () => {
    const calls = checkoutMocks(["cod", "card"], {
      "POST /orders": { status: 201, body: { ...cardOrder, tracking_token: "tok123", payment_url: "https://pay.example/session_1" } },
    });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await reachPayment(user);
    expect(screen.getByRole("radio", { name: "Cash on delivery or pickup" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Pay online by card" }));
    expect(screen.getByText(/taken to a secure payment page/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Online by card")).toBeInTheDocument();
    const place = await screen.findByRole("button", { name: /Place order and pay · .*690\.00/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place);
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://pay.example/session_1"));
    expect(bodyOf(sent(calls, "POST", "/orders")[0]).payment_method).toBe("card");
    expect(JSON.parse(localStorage.getItem("baker.cart")!)).toEqual([]); // the order exists now; the cart is spent
    expect(screen.queryByRole("heading", { level: 1, name: /Order BK/ })).not.toBeInTheDocument(); // we left the app, no tracking page yet
  });

  it("explains when card is not available and keeps cash selectable", async () => {
    checkoutMocks(["cod"]);
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await reachPayment(user);
    expect(screen.getByRole("radio", { name: /Pay online by card \(not available right now\)/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Cash on delivery or pickup" })).toBeChecked();
  });

  it("when cash is switched off, only card is offered and selected", async () => {
    const calls = checkoutMocks(["card"], {
      "POST /orders": { status: 201, body: { ...cardOrder, tracking_token: "tok123", payment_url: "https://pay.example/s2" } },
    });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await reachPayment(user);
    expect(screen.queryByRole("radio", { name: "Cash on delivery or pickup" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pay online by card" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const place = await screen.findByRole("button", { name: /Place order and pay/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place);
    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    expect(bodyOf(sent(calls, "POST", "/orders")[0]).payment_method).toBe("card");
  });

  it("shows a payment-start failure and lets the customer try again", async () => {
    checkoutMocks(["cod", "card"], {
      "POST /orders": { status: 502, body: { error: { code: "payment_unavailable", message: "We could not start the card payment. Please try again, or choose cash on delivery." } } },
    });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await reachPayment(user);
    await user.click(screen.getByRole("radio", { name: "Pay online by card" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const place = await screen.findByRole("button", { name: /Place order and pay/ });
    await waitFor(() => expect(place).toBeEnabled());
    await user.click(place);
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not start the card payment");
    expect(redirectTo).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /Place order and pay/ })).toBeEnabled()); // can try again
  });
});

// ================================================================== the order page
describe("order page while payment is pending", () => {
  const open = (extra: Record<string, { status?: number; body: unknown }> = {}, route = "/track/BK-ABC234?t=tok123") => {
    const calls = mockFetch({ ...storeWith(["cod", "card"]), "/orders/BK-ABC234": { body: cardOrder }, ...extra });
    return { calls, ...renderApp(<App />, route) };
  };

  it("invites the customer to pay and opens a payment page on request", async () => {
    const { calls } = open({ "POST /orders/BK-ABC234/payment-link": { body: { payment_url: "https://pay.example/again" } } });
    const user = userEvent.setup();
    expect(await screen.findByText("This order is waiting for payment")).toBeInTheDocument();
    expect(screen.getByText("Waiting for payment", { selector: "p" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pay by card" }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://pay.example/again"));
    expect(sent(calls, "POST", "/orders/BK-ABC234/payment-link")[0].url).toContain("?t=tok123");
  });

  it("says so when the time to pay has run out", async () => {
    open({ "POST /orders/BK-ABC234/payment-link": { status: 409, body: { error: { code: "payment_expired", message: "The time to pay for this order has run out." } } } });
    await userEvent.click(await screen.findByRole("button", { name: "Pay by card" }));
    expect(await screen.findByText("The time to pay for this order has run out.")).toBeInTheDocument();
    expect(redirectTo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pay by card" })).toBeEnabled();
  });

  it("treats a failed payment reported by Paymob on the way back as not completed, even if the link says paid", async () => {
    open({}, "/track/BK-ABC234?t=tok123&paid=1&success=false&id=42");
    expect(await screen.findByText("Your payment was not completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay by card" })).toBeInTheDocument();
    expect(screen.queryByText("Confirming your payment…")).not.toBeInTheDocument();
  });

  it("a successful return from Paymob waits for the confirmation instead of trusting the link", async () => {
    open({}, "/track/BK-ABC234?t=tok123&paid=1&success=true&id=42");
    expect(await screen.findByText("Confirming your payment…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay by card" })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for payment", { selector: "p" })).toBeInTheDocument(); // still unconfirmed
  });

  it("after cancelling on the payment page it explains and offers to pay again", async () => {
    open({}, "/track/BK-ABC234?t=tok123&cancelled=1");
    expect(await screen.findByText("Your payment was not completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay by card" })).toBeInTheDocument();
  });

  describe("coming back from paying", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("keeps checking until the confirmation arrives, without asking to pay again", async () => {
      let polls = 0;
      const calls = mockFetch({
        ...storeWith(["cod", "card"]),
        "/orders/BK-ABC234": { body: () => (++polls >= 3 ? { ...placedOrder, payment_method: "card", payment_status: "paid", status: "received" } : cardOrder) },
      });
      renderApp(<App />, "/track/BK-ABC234?t=tok123&paid=1");
      expect(await screen.findByText("Confirming your payment…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pay by card" })).not.toBeInTheDocument(); // never pay twice
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(await screen.findByText("Payment received, thank you")).toBeInTheDocument();
      expect(screen.queryByText("Confirming your payment…")).not.toBeInTheDocument();
      expect(screen.getByText(/Payment: card \(paid\)/)).toBeInTheDocument();
      const before = calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(calls.length).toBe(before); // stops polling once the order is confirmed
    });
  });

  it("shows refunds and cancellation for an order whose payment arrived too late", async () => {
    open({ "/orders/BK-ABC234": { body: { ...cardOrder, status: "cancelled", payment_status: "refunded", cancellation_reason: "Your payment arrived after the order expired, so it was refunded." } } });
    expect(await screen.findByText("This order was cancelled")).toBeInTheDocument();
    expect(screen.getByText(/Payment: card \(refunded\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay by card" })).not.toBeInTheDocument();
  });
});

// ============================================================== the demo payment page
describe("demo payment page", () => {
  const open = () => {
    const calls = mockFetch({
      ...storeWith(["cod", "card"]),
      "/orders/BK-ABC234": { body: cardOrder },
      "POST /payments/fake/BK-ABC234/complete": { body: { outcome: "paid" } },
    });
    return { calls, ...renderApp(<App />, "/fake-pay/BK-ABC234?t=tok123") };
  };

  it("makes clear it is practice, shows the amount, and completes the payment", async () => {
    const { calls, container } = open();
    expect(await screen.findByText("This is a practice payment")).toBeInTheDocument();
    expect(await screen.findByText(/1,340\.00/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Pay now (test)" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" })).toBeInTheDocument(); // back on the order page
    const post = sent(calls, "POST", "/payments/fake/BK-ABC234/complete")[0];
    expect(bodyOf(post)).toEqual({ outcome: "paid" });
    expect(post.url).toContain("?t=tok123");
    expect(calls.some((c) => c.url.includes("/orders/BK-ABC234?t=tok123"))).toBe(true);
  });

  it("cancelling reports an expired payment", async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel payment" }));
    await screen.findByRole("heading", { level: 1, name: "Order BK-ABC234" });
    expect(bodyOf(sent(calls, "POST", "/payments/fake/BK-ABC234/complete")[0])).toEqual({ outcome: "expired" });
  });

  it("shows server problems", async () => {
    mockFetch({ ...storeWith(["card"]), "/orders/BK-ABC234": { body: cardOrder },
      "POST /payments/fake/BK-ABC234/complete": { status: 409, body: { error: { code: "not_awaiting_payment", message: "This order is not waiting for a payment." } } } });
    renderApp(<App />, "/fake-pay/BK-ABC234?t=tok123");
    await userEvent.click(await screen.findByRole("button", { name: "Pay now (test)" }));
    expect(await screen.findByText("This order is not waiting for a payment.")).toBeInTheDocument();
  });
});

// =========================================================== owner: payments and emails
const settingsBody = { card_enabled: true, cod_enabled: true, provider: "paymob", mode: "test", card_available: true, webhook_path: "/api/v1/payments/paymob/webhook", email_provider: "log", email_from: "The Baker <baker@gmail.com>" };
const templates = [
  { key: "order_confirmed", title: "Order confirmed", description: "Sent when an order is placed.", subject: "We received your order {{ order_code }}", body: "Hi {{ customer_name }},\nThanks!", is_active: true, is_customised: false, variables: ["customer_name", "order_code", "order_total"] },
  { key: "order_rejected", title: "Order declined", description: "Sent when an order is declined.", subject: "Declined {{ order_code }}", body: "Reason: {{ reason }}", is_active: true, is_customised: true, variables: ["customer_name", "order_code", "reason"] },
];
const logItems = {
  items: [
    { id: 1, order_code: "BK-AAAAAA", template_key: "order_confirmed", to_email: "sara@example.com", subject: "We received your order BK-AAAAAA", status: "failed", attempts: 5, last_error: "Brevo answered 400", created_at: "2030-12-01T10:30:00Z", sent_at: null },
    { id: 2, order_code: null, template_key: "password_reset", to_email: "omar@example.com", subject: "Reset your password", status: "sent", attempts: 1, last_error: null, created_at: "2030-12-01T10:00:00Z", sent_at: "2030-12-01T10:00:02Z" },
  ],
  total: 2, page: 1, page_size: 10, total_pages: 1,
};
const adminMocks = (extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({
    ...storeWith(["cod", "card"]),
    "/auth/me": { body: owner },
    "/admin/payments": { body: settingsBody },
    "/admin/notification-templates": { body: templates },
    "/admin/notifications": { body: logItems },
    ...extra,
  });
};

describe("owner: payments and emails", () => {
  it("is for the owner only", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({ ...storeWith(["cod"]), "/auth/me": { body: staff } });
    renderApp(<App />, "/admin/payments");
    expect(await screen.findByRole("heading", { level: 1, name: "You do not have access to this page" })).toBeInTheDocument();
  });

  it("shows the provider status and webhook address, and has no axe violations", async () => {
    adminMocks();
    const { container } = renderApp(<App />, "/admin/payments");
    expect(await screen.findByText("Paymob (test mode)")).toBeInTheDocument();
    expect(screen.getByText("Available to customers")).toBeInTheDocument();
    expect(screen.getByText(/\/api\/v1\/payments\/paymob\/webhook/)).toBeInTheDocument();
    expect(screen.getByText(/Email is not connected yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Payments and emails" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves the payment switches and reports server refusals", async () => {
    const calls = adminMocks({ "PATCH /admin/payments": { body: settingsBody } });
    renderApp(<App />, "/admin/payments");
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("Pay online by card"));
    await user.click(screen.getByRole("button", { name: "Save payment methods" }));
    expect(await screen.findByText("Payment methods saved.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PATCH", "/admin/payments")[0])).toEqual({ card_enabled: false, cod_enabled: true });
  });

  it("shows the server's message when both methods are switched off", async () => {
    adminMocks({ "PATCH /admin/payments": { status: 422, body: { error: { code: "no_payment_method", message: "Keep at least one payment method switched on." } } } });
    renderApp(<App />, "/admin/payments");
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("Pay online by card"));
    await user.click(screen.getByLabelText("Cash on delivery or pickup"));
    await user.click(screen.getByRole("button", { name: "Save payment methods" }));
    expect(await screen.findByText("Keep at least one payment method switched on.")).toBeInTheDocument();
  });

  it("explains when card is not set up on the server", async () => {
    adminMocks({ "/admin/payments": { body: { ...settingsBody, provider: "none", mode: null, card_available: false } } });
    renderApp(<App />, "/admin/payments");
    expect(await screen.findByText("Not set up")).toBeInTheDocument();
    expect(screen.getByText(/customers can only pay cash/)).toBeInTheDocument();
  });

  it("sends a test email and reports the result either way", async () => {
    adminMocks({ "POST /admin/email-test": { body: { sent: true, to: "owner@demo.thebaker", error: null } } });
    renderApp(<App />, "/admin/payments");
    await userEvent.click(await screen.findByRole("button", { name: "Send me a test email" }));
    expect(await screen.findByText("A test email was sent to owner@demo.thebaker. Check your inbox.")).toBeInTheDocument();
  });

  it("shows why a test email failed", async () => {
    adminMocks({ "POST /admin/email-test": { body: { sent: false, to: "owner@demo.thebaker", error: "Brevo answered 400: sender not valid" } } });
    renderApp(<App />, "/admin/payments");
    await userEvent.click(await screen.findByRole("button", { name: "Send me a test email" }));
    expect(await screen.findByText("The test email could not be sent")).toBeInTheDocument();
    expect(screen.getByText(/sender not valid/)).toBeInTheDocument();
  });

  it("describes a connected email service", async () => {
    adminMocks({ "/admin/payments": { body: { ...settingsBody, email_provider: "brevo", email_from: "The Baker <orders@thebaker.test>" } } });
    renderApp(<App />, "/admin/payments");
    expect(await screen.findByText("The Baker <orders@thebaker.test>")).toBeInTheDocument();
  });

  it("names Brevo when that is the connected service", async () => {
    adminMocks({ "/admin/payments": { body: { ...settingsBody, email_provider: "brevo", email_from: "The Baker <baker@gmail.com>" } } });
    renderApp(<App />, "/admin/payments");
    expect(await screen.findByText(/sent through Brevo from/)).toBeInTheDocument();
  });
});

describe("owner: email wording", () => {
  it("lists the insertable details for the chosen email and saves edits", async () => {
    const calls = adminMocks({ "PATCH /admin/notification-templates/order_confirmed": { body: templates[0] } });
    renderApp(<App />, "/admin/payments");
    const user = userEvent.setup();
    const subject = await screen.findByLabelText("Subject");
    expect(subject).toHaveValue("We received your order {{ order_code }}");
    for (const v of ["customer_name", "order_code", "order_total"]) expect(screen.getByText(`{{ ${v} }}`)).toBeInTheDocument();
    await user.clear(subject);
    await user.type(subject, "Thanks!");
    await user.click(screen.getByRole("button", { name: "Save wording" }));
    expect(await screen.findByText("Email wording saved.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PATCH", "/admin/notification-templates/order_confirmed")[0])).toMatchObject({ subject: "Thanks!", is_active: true });
  });

  it("switches to another email and offers to restore an edited one", async () => {
    const calls = adminMocks({ "POST /admin/notification-templates/order_rejected/reset": { body: { ...templates[1], is_customised: false } } });
    renderApp(<App />, "/admin/payments");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Which email"), "order_rejected");
    expect(screen.getByLabelText("Message")).toHaveValue("Reason: {{ reason }}");
    expect(screen.getByText("{{ reason }}")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore original wording" }));
    expect(await screen.findByText("Restored the original wording.")).toBeInTheDocument();
    expect(sent(calls, "POST", "/admin/notification-templates/order_rejected/reset")).toHaveLength(1);
  });

  it("previews with sample details and shows wording the server refuses", async () => {
    adminMocks({ "POST /admin/notification-templates/order_confirmed/preview": { body: { subject: "We received your order BK-7F3K2Q", body: "Hi Sara Ali,\nThanks!" } } });
    renderApp(<App />, "/admin/payments");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Subject: We received your order BK-7F3K2Q")).toBeInTheDocument();
    expect(screen.getByText(/Hi Sara Ali,/)).toBeInTheDocument();
  });

  it("shows why wording cannot be saved", async () => {
    adminMocks({ "PATCH /admin/notification-templates/order_confirmed": { status: 422, body: { error: { code: "invalid_template", message: "This wording cannot be used: 'typo' is undefined" } } } });
    renderApp(<App />, "/admin/payments");
    await userEvent.click(await screen.findByRole("button", { name: "Save wording" }));
    expect(await screen.findByText(/This wording cannot be used/)).toBeInTheDocument();
  });
});

describe("owner: email log", () => {
  it("lists emails, filters by status and retries a failed one", async () => {
    const calls = adminMocks({ "POST /admin/notifications/1/retry": { body: logItems.items[0] } });
    renderApp(<App />, "/admin/payments");
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "Emails sent and queued" });
    expect(within(table).getByText("Brevo answered 400")).toBeInTheDocument();
    expect(within(table).getByText("Order BK-AAAAAA")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("Sent")).toBeInTheDocument();
    expect(within(table).getAllByRole("button")).toHaveLength(1); // only the failed one can be retried
    await user.selectOptions(screen.getByLabelText("Show"), "failed");
    await waitFor(() => expect(calls.some((c) => c.url.includes("/admin/notifications?") && c.url.includes("status=failed"))).toBe(true));
    await user.click(await screen.findByRole("button", { name: /Retry the email to sara@example.com/ }));
    expect(await screen.findByText("The email will be sent again shortly.")).toBeInTheDocument();
    expect(sent(calls, "POST", "/admin/notifications/1/retry")).toHaveLength(1);
  });

  it("says when there is nothing to show", async () => {
    adminMocks({ "/admin/notifications": { body: { items: [], total: 0, page: 1, page_size: 10, total_pages: 1 } } });
    renderApp(<App />, "/admin/payments");
    expect(await screen.findByText("No emails to show.")).toBeInTheDocument();
  });
});
