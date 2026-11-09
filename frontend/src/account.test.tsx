import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { customer, fakeQuote, orderRow, owner, POLICY, publicZones, savedAddress } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"], cancellation_window_hours: 24, policy_text: POLICY } } };
const signIn = (extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({ "/auth/me": { body: customer }, ...store, "/delivery-zones": { body: publicZones }, ...extra });
};
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(call.init!.body as string);
const page = (items: unknown[], extra = {}) => ({ items, total: items.length, page: 1, page_size: 10, total_pages: 1, ...extra });

describe("account navigation", () => {
  it("has a profile, orders and addresses section, with no axe violations", async () => {
    signIn();
    const { container } = renderApp(<App />, "/account");
    expect(await screen.findByRole("heading", { level: 1, name: "My account" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(within(nav).getByRole("link", { name: "My orders" })).toHaveAttribute("href", "/account/orders");
    expect(within(nav).getByRole("link", { name: "Saved addresses" })).toHaveAttribute("href", "/account/addresses");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("profile", () => {
  it("saves a new name and phone", async () => {
    const calls = signIn({ "PATCH /me": { body: { ...customer, full_name: "Sara A. Ali", phone: "+20 100 000 0000" } } });
    renderApp(<App />, "/account");
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Full name");
    expect(name).toHaveValue("Sara Ali");
    await user.clear(name);
    await user.type(name, "Sara A. Ali");
    await user.type(screen.getByLabelText("Phone"), "+20 100 000 0000");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("Your details were saved.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PATCH", "/me")[0])).toEqual({ full_name: "Sara A. Ali", phone: "+20 100 000 0000" });
  });

  it("shows what the server did not accept", async () => {
    signIn({ "PATCH /me": { status: 422, body: { error: { code: "validation_error", message: "Please check the highlighted fields.", fields: { phone: "String should match pattern" } } } } });
    renderApp(<App />, "/account");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Phone"), "call me");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("We could not save your details")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveAccessibleDescription(/String should match pattern/);
  });
});

describe("order history", () => {
  it("lists the orders with their status and a link to each", async () => {
    signIn({ "/me/orders": { body: page([orderRow("BK-ABC234"), orderRow("BK-XYZ789", { status: "delivered" })]) } });
    const { container } = renderApp(<App />, "/account/orders");
    const link = await screen.findByRole("link", { name: "Order BK-ABC234" });
    expect(link).toHaveAttribute("href", "/track/BK-ABC234");
    const item = link.closest("li")!;
    expect(within(item).getByText("2 × Triple Chocolate Cake")).toBeInTheDocument();
    expect(within(item).getByText("Received")).toBeInTheDocument();
    expect(within(item).getByText(/1,340\.00/)).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has a friendly empty state", async () => {
    signIn({ "/me/orders": { body: page([]) } });
    renderApp(<App />, "/account/orders");
    expect(await screen.findByText(/You have not placed an order with this account yet/)).toBeInTheDocument();
  });

  it("pages through longer histories", async () => {
    const calls = signIn({ "/me/orders": { body: page([orderRow("BK-ABC234")], { total: 12, total_pages: 2 }) } });
    renderApp(<App />, "/account/orders");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/me/orders?page=2"))).toBe(true));
  });
});

describe("saved addresses", () => {
  it("lists them and marks the default", async () => {
    signIn({ "/me/addresses": { body: [savedAddress(1, "Home", { is_default: true }), savedAddress(2, "Work", { street: "7 Nile" })] } });
    const { container } = renderApp(<App />, "/account/addresses");
    const home = (await screen.findByRole("heading", { level: 3, name: /Home/ })).closest("li")!;
    expect(within(home).getByText("(default)")).toBeInTheDocument();
    expect(within(home).getByText(/12 Road 9, building 5, floor 3, Maadi/)).toBeInTheDocument();
    expect(screen.getByText(/7 Nile, building 5/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("adds an address", async () => {
    const calls = signIn({ "/me/addresses": { body: [] }, "POST /me/addresses": { status: 201, body: savedAddress(1, "Home") } });
    renderApp(<App />, "/account/addresses");
    const user = userEvent.setup();
    expect(await screen.findByText("You have no saved addresses yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add an address" }));
    await user.type(screen.getByLabelText(/Name for this address/), "Home");
    await screen.findByRole("option", { name: /Maadi/ });
    await user.selectOptions(screen.getByLabelText("Delivery area"), "1");
    await user.type(screen.getByLabelText("Street"), "12 Road 9");
    await user.type(screen.getByLabelText("Building"), "5");
    await user.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByText("“Home” was added.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/me/addresses")[0])).toMatchObject({ label: "Home", zone_id: 1, street: "12 Road 9", building: "5", is_default: false });
  });

  it("edits an address", async () => {
    const calls = signIn({ "/me/addresses": { body: [savedAddress(1, "Home")] }, "PATCH /me/addresses/1": { body: savedAddress(1, "Home", { street: "7 Nile" }) } });
    renderApp(<App />, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Home" }));
    const street = screen.getByLabelText("Street");
    expect(street).toHaveValue("12 Road 9");
    await user.clear(street);
    await user.type(street, "7 Nile");
    await user.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByText("“Home” was saved.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PATCH", "/me/addresses/1")[0]).street).toBe("7 Nile");
  });

  it("asks before deleting", async () => {
    const calls = signIn({ "/me/addresses": { body: [savedAddress(1, "Home")] }, "DELETE /me/addresses/1": { status: 204, body: null } });
    renderApp(<App />, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete Home" }));
    expect(sent(calls, "DELETE", "/me/addresses/1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Yes, delete Home" }));
    expect(await screen.findByText("“Home” was deleted.")).toBeInTheDocument();
    expect(sent(calls, "DELETE", "/me/addresses/1")).toHaveLength(1);
  });

  it("shows field errors from the server on the field", async () => {
    signIn({ "/me/addresses": { body: [] }, "POST /me/addresses": { status: 422, body: { error: { code: "validation_error", message: "Please check the highlighted fields.", fields: { street: "This field cannot be empty." } } } } });
    renderApp(<App />, "/account/addresses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add an address" }));
    await user.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByText("We could not save this address")).toBeInTheDocument();
    expect(screen.getByLabelText("Street")).toHaveAccessibleDescription(/cannot be empty/);
  });
});

describe("checkout uses saved addresses", () => {
  const cartRoutes = (addresses: unknown[]) => ({
    "/me/addresses": { body: addresses },
    "POST /checkout/quote": { body: (req: Parameters<typeof fakeQuote>[0]) => fakeQuote(req) },
  });
  const withCart = () => localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 1, inscription: "" }]));

  it("fills in the default address and lets the customer pick another", async () => {
    withCart();
    signIn(cartRoutes([savedAddress(1, "Home", { is_default: true }), savedAddress(2, "Work", { street: "7 Nile", building: "9" })]));
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Street")).toHaveValue("12 Road 9")); // the default, once loaded
    await waitFor(() => expect(screen.getByLabelText("Delivery area")).toHaveValue("1"));
    await user.selectOptions(screen.getByLabelText("Use a saved address"), "2");
    expect(screen.getByLabelText("Street")).toHaveValue("7 Nile");
    expect(screen.getByLabelText("Building")).toHaveValue("9");
  });

  it("does not overwrite an address the customer already typed", async () => {
    withCart();
    signIn(cartRoutes([savedAddress(1, "Home", { is_default: true })]));
    renderApp(<App />, "/checkout");
    await waitFor(() => expect(screen.getByLabelText("Street")).toHaveValue("12 Road 9"));
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Street"));
    await user.type(screen.getByLabelText("Street"), "My own street");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText("Street")).toHaveValue("My own street");
  });

  it("shows no saved-address picker to a guest", async () => {
    withCart();
    mockFetch({ ...store, "/delivery-zones": { body: publicZones }, ...cartRoutes([]) });
    renderApp(<App />, "/checkout");
    await screen.findByLabelText("Street");
    expect(screen.queryByLabelText("Use a saved address")).not.toBeInTheDocument();
  });
});

describe("owner: cancellation and refunds", () => {
  const policy = { cancellation_window_hours: 24, refund_policy: "full", refund_percentage: 100, policy_note: null, preview: POLICY };
  const signInOwner = (extra: Record<string, { status?: number; body: unknown }> = {}) => {
    localStorage.setItem("baker.token", "tok");
    return mockFetch({ "/auth/me": { body: owner }, ...store, "/admin/policies": { body: policy }, ...extra });
  };

  it("shows the current policy and what customers read, with no axe violations", async () => {
    signInOwner();
    const { container } = renderApp(<App />, "/admin/policies");
    expect(await screen.findByLabelText(/Hours before the time slot/)).toHaveValue(24);
    expect(screen.getByRole("radio", { name: "Refund in full" })).toBeChecked();
    expect(screen.getByText(POLICY)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancellation and refunds" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves a percentage policy and shows the new wording", async () => {
    const saved = { ...policy, cancellation_window_hours: 12, refund_policy: "percentage", refund_percentage: 80, preview: "You can cancel until 12 hours before. 80% is refunded." };
    const calls = signInOwner({ "PUT /admin/policies": { body: saved } });
    renderApp(<App />, "/admin/policies");
    const user = userEvent.setup();
    const hours = await screen.findByLabelText(/Hours before the time slot/);
    await user.clear(hours);
    await user.type(hours, "12");
    await user.click(screen.getByRole("radio", { name: "Refund a percentage" }));
    const percent = screen.getByLabelText(/Percentage refunded/);
    await user.clear(percent);
    await user.type(percent, "80");
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    expect(await screen.findByText(/Customers see the new wording straight away/)).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PUT", "/admin/policies")[0])).toEqual({ cancellation_window_hours: 12, refund_policy: "percentage", refund_percentage: 80, policy_note: "" });
  });

  it("shows a refused policy", async () => {
    signInOwner({ "PUT /admin/policies": { status: 422, body: { error: { code: "validation_error", message: "Please check the highlighted fields.", fields: { request: "Enter a percentage between 1 and 99, or choose full or no refund." } } } } });
    renderApp(<App />, "/admin/policies");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Refund a percentage" }));
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    expect(await screen.findByText("We could not save the policy")).toBeInTheDocument();
    expect(screen.getByLabelText(/Percentage refunded/)).toHaveAccessibleDescription(/between 1 and 99/);
  });
});
