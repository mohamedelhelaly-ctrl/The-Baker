import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { changeable, customer, fakeQuote, owner, publicZones, staff } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const storeBody = (extra = {}) => ({
  name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"], cancellation_window_hours: 24, policy_text: "",
  phone: null, whatsapp: null, email: null, address: null, pickup_location: null, pickup_instructions: null, ...extra,
});
const store = { "/store": { body: storeBody() } };
const sent = (calls: { url: string; init?: RequestInit }[], method: string, suffix: string) =>
  calls.filter((c) => c.init?.method === method && c.url.split("?")[0].endsWith(suffix));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(call.init!.body as string);
const signIn = (who: unknown, extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({ "/auth/me": { body: who }, ...store, ...extra });
};
const member = (id: number, name: string, extra = {}) => ({
  id, email: `${name.toLowerCase().split(" ")[0]}@example.com`, full_name: name, phone: null, role: "staff", is_active: true,
  last_login_at: "2030-12-01T10:30:00Z", created_at: "2030-11-01T10:30:00Z", ...extra,
});
const team = [member(9, "Baker Owner", { role: "owner" }), member(10, "Omar Baker"), member(11, "Laila Hassan", { is_active: false, last_login_at: null })];

describe("owner: team", () => {
  it("lists the team with roles and status, and no actions on your own account", async () => {
    signIn(owner, { "/admin/team": { body: team } });
    const { container } = renderApp(<App />, "/admin/team");
    const omar = (await screen.findByRole("rowheader", { name: /Omar Baker/ })).closest("tr")!;
    expect(within(omar).getByText("Staff")).toBeInTheDocument();
    expect(within(omar).getByText("Active")).toBeInTheDocument();
    const me = screen.getByRole("rowheader", { name: /Baker Owner/ }).closest("tr")!;
    expect(within(me).getByText("This is your account")).toBeInTheDocument();
    expect(within(me).queryByRole("button")).not.toBeInTheDocument();
    const laila = screen.getByRole("rowheader", { name: /Laila Hassan/ }).closest("tr")!;
    expect(within(laila).getByText("Removed")).toBeInTheDocument();
    expect(within(laila).getByText("Never")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("href", "/admin/team");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("adds a staff member and tells the owner what to hand over", async () => {
    const calls = signIn(owner, { "/admin/team": { body: team }, "POST /admin/team": { status: 201, body: member(12, "Nour Ali") } });
    renderApp(<App />, "/admin/team");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Full name"), "Nour Ali");
    await user.type(screen.getByLabelText("Email"), "nour@example.com");
    await user.type(screen.getByLabelText(/Temporary password/), "temporary-pass-1");
    await user.click(screen.getByRole("button", { name: "Add team member" }));
    expect(await screen.findByText(/Nour Ali was added/)).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/admin/team")[0])).toEqual({ full_name: "Nour Ali", email: "nour@example.com", role: "staff", password: "temporary-pass-1" });
    expect(screen.getByLabelText("Full name")).toHaveValue(""); // ready for the next one, password not kept
    expect(screen.getByLabelText(/Temporary password/)).toHaveValue("");
  });

  it("shows why an account could not be added", async () => {
    signIn(owner, { "/admin/team": { body: team }, "POST /admin/team": { status: 409, body: { error: { code: "email_taken", message: "An account with this email already exists.", fields: { email: "An account with this email already exists." } } } } });
    renderApp(<App />, "/admin/team");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Full name"), "Omar");
    await user.type(screen.getByLabelText("Email"), "omar@example.com");
    await user.type(screen.getByLabelText(/Temporary password/), "temporary-pass-1");
    await user.click(screen.getByRole("button", { name: "Add team member" }));
    expect(await screen.findByText("We could not add this person")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(/already exists/);
  });

  it("changes a role", async () => {
    const calls = signIn(owner, { "/admin/team": { body: team }, "PATCH /admin/team/10": { body: member(10, "Omar Baker", { role: "owner" }) } });
    renderApp(<App />, "/admin/team");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Make owner for Omar Baker" }));
    expect(await screen.findByText("Omar Baker is now an owner.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PATCH", "/admin/team/10")[0])).toEqual({ role: "owner" });
  });

  it("asks before removing someone, then removes them", async () => {
    const calls = signIn(owner, { "/admin/team": { body: team }, "DELETE /admin/team/10": { body: member(10, "Omar Baker", { is_active: false }) } });
    renderApp(<App />, "/admin/team");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Omar Baker" }));
    expect(sent(calls, "DELETE", "/admin/team/10")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Yes, remove Omar Baker" }));
    expect(await screen.findByText(/Omar Baker was removed and can no longer sign in/)).toBeInTheDocument();
    expect(sent(calls, "DELETE", "/admin/team/10")).toHaveLength(1);
  });

  it("switches a removed account back on", async () => {
    const calls = signIn(owner, { "/admin/team": { body: team }, "PATCH /admin/team/11": { body: member(11, "Laila Hassan") } });
    renderApp(<App />, "/admin/team");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch back on for Laila Hassan" }));
    expect(await screen.findByText("Laila Hassan can sign in again.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PATCH", "/admin/team/11")[0])).toEqual({ is_active: true });
  });

  it("shows the server's reason when a change is refused", async () => {
    signIn(owner, { "/admin/team": { body: team }, "DELETE /admin/team/10": { status: 409, body: { error: { code: "last_owner", message: "This is the only active owner. Make someone else an owner first." } } } });
    renderApp(<App />, "/admin/team");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Omar Baker" }));
    await user.click(screen.getByRole("button", { name: "Yes, remove Omar Baker" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only active owner");
  });

  it("is closed to staff, who do not even see the link", async () => {
    signIn(staff);
    renderApp(<App />, "/admin/team");
    expect(await screen.findByRole("heading", { level: 1, name: /not allowed|access|permission/i })).toBeInTheDocument();
  });
});

describe("owner: shop details", () => {
  const empty = { business_name: null, phone: null, whatsapp: null, email: null, address: null, pickup_location: null, pickup_instructions: null };

  it("loads and saves the details", async () => {
    const calls = signIn(owner, { "/admin/settings": { body: empty }, "PUT /admin/settings": { body: empty } });
    const { container } = renderApp(<App />, "/admin/shop");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Shop name/), "Cairo Crumbs");
    await user.type(screen.getByLabelText("Phone"), "+20 2 2345 6789");
    await user.type(screen.getByLabelText("Where customers collect"), "Side door on Road 9");
    await user.type(screen.getByLabelText("Pickup instructions"), "Ring the bell.");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText(/Customers see the new details straight away/)).toBeInTheDocument();
    expect(bodyOf(sent(calls, "PUT", "/admin/settings")[0])).toMatchObject({ business_name: "Cairo Crumbs", phone: "+20 2 2345 6789", pickup_location: "Side door on Road 9", pickup_instructions: "Ring the bell." });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a refused value on its field", async () => {
    signIn(owner, { "/admin/settings": { body: empty }, "PUT /admin/settings": { status: 422, body: { error: { code: "validation_error", message: "Please check the highlighted fields.", fields: { phone: "String should match pattern" } } } } });
    renderApp(<App />, "/admin/shop");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Phone"), "call us");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("We could not save the details")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveAccessibleDescription(/String should match pattern/);
  });
});

describe("customers see the shop details", () => {
  const details = { name: "Cairo Crumbs", phone: "+20 2 2345 6789", whatsapp: "+20 100 123 4567", email: "hello@cairocrumbs.example", address: "12 Road 9, Maadi", pickup_location: "Side door on Road 9", pickup_instructions: "Ring the bell." };

  it("shows contact details in the footer and the shop's own name", async () => {
    mockFetch({ "/store": { body: storeBody(details) }, "/delivery-zones": { body: publicZones } });
    renderApp(<App />, "/delivery");
    expect(await screen.findByRole("link", { name: "Cairo Crumbs" })).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo");
    expect(await within(footer).findByText("12 Road 9, Maadi")).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "+20 2 2345 6789" })).toHaveAttribute("href", "tel:+20223456789");
    expect(within(footer).getByRole("link", { name: "+20 100 123 4567" })).toHaveAttribute("href", "https://wa.me/201001234567");
    expect(within(footer).getByRole("link", { name: "hello@cairocrumbs.example" })).toHaveAttribute("href", "mailto:hello@cairocrumbs.example");
  });

  it("shows no contact section while the owner has not filled it in", async () => {
    mockFetch({ ...store, "/delivery-zones": { body: publicZones } });
    renderApp(<App />, "/delivery");
    await screen.findByRole("link", { name: "The Baker" });
    expect(screen.queryByRole("heading", { name: "Contact" })).not.toBeInTheDocument();
  });

  it("tells a pickup customer where to collect, at checkout and on the order page", async () => {
    localStorage.setItem("baker.cart", JSON.stringify([{ variantId: 10, quantity: 1, inscription: "" }]));
    mockFetch({
      "/store": { body: storeBody(details) }, "/delivery-zones": { body: publicZones },
      "POST /checkout/quote": { body: (req: Parameters<typeof fakeQuote>[0]) => fakeQuote(req) },
      "/orders/BK-ABC234": { body: { ...changeable, fulfilment_type: "pickup", zone_name: null, delivery_address: null } },
    });
    renderApp(<App />, "/checkout");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Pickup from the bakery/ }));
    expect(screen.getByText(/Where to collect:/)).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByText("Ring the bell.")).toBeInTheDocument();
  });

  it("shows the pickup place on the order page", async () => {
    mockFetch({ "/store": { body: storeBody(details) }, "/orders/BK-ABC234": { body: { ...changeable, fulfilment_type: "pickup", zone_name: null, delivery_address: null } } });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    expect(await screen.findByText(/Collect your order from: Side door on Road 9/)).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByText("Ring the bell.")).toBeInTheDocument();
  });
});

describe("changing your password", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, current: string, next: string) => {
    await user.type(await screen.findByLabelText("Current password"), current);
    await user.type(screen.getByLabelText("New password"), next);
    await user.click(screen.getByRole("button", { name: "Change password" }));
  };

  it("changes it and clears the fields", async () => {
    const calls = signIn(customer, { "POST /auth/change-password": { body: { message: "Your password was changed." } } });
    renderApp(<App />, "/account");
    await fill(userEvent.setup(), "old-password-1", "brand-new-pass-1");
    expect(await screen.findByText("Your password was changed.")).toBeInTheDocument();
    expect(bodyOf(sent(calls, "POST", "/auth/change-password")[0])).toEqual({ current_password: "old-password-1", new_password: "brand-new-pass-1" });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("shows a wrong current password on its field", async () => {
    signIn(customer, { "POST /auth/change-password": { status: 422, body: { error: { code: "wrong_password", message: "Your current password is not correct.", fields: { current_password: "Your current password is not correct." } } } } });
    renderApp(<App />, "/account");
    await fill(userEvent.setup(), "nope-nope-nope", "brand-new-pass-1");
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveAccessibleDescription(/not correct/));
    expect(screen.getByText("We could not change your password")).toBeInTheDocument();
  });
});
