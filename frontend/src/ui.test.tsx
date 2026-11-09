import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { bread, cake, categories, customer, occasions, owner, page, staff } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [] } } };
const taxonomy = { "/categories": { body: categories }, "/occasions": { body: occasions } };
const signIn = (who: unknown, extra: Record<string, { status?: number; body: unknown }> = {}) => {
  localStorage.setItem("baker.token", "tok");
  return mockFetch({ "/auth/me": { body: who }, ...store, ...taxonomy, "/products": { body: page([cake, bread]) }, ...extra });
};

describe("the header", () => {
  it("is short for a visitor: three words, the name, cart, sign in and display", async () => {
    mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake]) } });
    renderApp(<App />, "/menu");
    const header = await screen.findByRole("banner");
    const words = within(within(header).getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(words.map((l) => l.textContent)).toEqual(["Menu", "Delivery", "Visit"]);
    expect(words[2]).toHaveAttribute("href", "/#visit");
    expect(within(header).getByRole("link", { name: "The Baker" })).toHaveAttribute("href", "/");
    expect(within(header).getByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Display" })).toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: /account menu/ })).not.toBeInTheDocument();
  });

  it("keeps everything about the signed-in person in one account menu", async () => {
    signIn(customer);
    renderApp(<App />, "/menu");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Sara, account menu" });
    expect(screen.queryByRole("link", { name: "My account" })).not.toBeInTheDocument(); // closed
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "My orders" })).toHaveAttribute("href", "/account/orders");
    expect(screen.getByText("sara@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage shop" })).not.toBeInTheDocument(); // customers have no shop to manage
  });

  it("offers staff and owners their extra areas, and keeps Orders one click away", async () => {
    signIn(owner);
    renderApp(<App />, "/menu");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Orders" })).toHaveAttribute("href", "/staff/orders"); // in the header itself
    await user.click(screen.getByRole("button", { name: /account menu/ }));
    expect(screen.getByRole("link", { name: "Manage shop" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Prep sheet" })).toHaveAttribute("href", "/staff/prep-sheet");
  });

  it("staff see the queue but not the shop settings they cannot change", async () => {
    signIn(staff);
    renderApp(<App />, "/menu");
    expect(await screen.findByRole("link", { name: "Orders" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /account menu/ }));
    expect(screen.getByRole("link", { name: "Manage shop" })).toBeInTheDocument(); // they can read the schedule
  });

  it("closes the menu with Escape and puts focus back on its button", async () => {
    signIn(customer);
    renderApp(<App />, "/menu");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /account menu/ });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("link", { name: "My account" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes the menu when the visitor clicks elsewhere or follows a link", async () => {
    signIn(customer, { "/me/orders": { body: { items: [], total: 0, page: 1, page_size: 10, total_pages: 1 } } });
    renderApp(<App />, "/menu");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /account menu/ });
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("link", { name: "My orders" })).not.toBeInTheDocument();
    await user.click(button);
    await user.click(screen.getByRole("link", { name: "My orders" }));
    expect(await screen.findByRole("heading", { level: 2, name: "My orders" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My account" })).not.toBeInTheDocument(); // closed after the click
  });

  it("has no axe violations with the account menu and the display menu open", async () => {
    signIn(owner);
    const { container } = renderApp(<App />, "/menu");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /account menu/ }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Display" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("menu search and filters", () => {
  const open = (route = "/menu") => {
    const calls = mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake, bread]) } });
    return { calls, ...renderApp(<App />, route) };
  };

  it("shows a search bar, category pills and one Filters button, nothing else", async () => {
    open();
    expect(await screen.findByLabelText("Search the menu")).toHaveAttribute("placeholder", "Search cakes, bakes, kahk…");
    const categoriesGroup = screen.getByRole("group", { name: "Category" });
    expect(within(categoriesGroup).getAllByRole("radio").map((r) => (r.closest("label") as HTMLElement).textContent)).toEqual(["All", "Celebration Cakes", "Breads"]);
    expect(within(categoriesGroup).getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Occasion")).not.toBeInTheDocument(); // tucked into the panel
    expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();
  });

  it("opens the panel with occasion and sort, and counts what is active", async () => {
    open("/menu?occasion=birthday&sort=price_asc");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Filters, 2 active" });
    await user.click(button);
    const panel = screen.getByRole("group", { name: "Occasion" }).closest("div")!.parentElement!;
    expect(within(panel).getByRole("radio", { name: "Birthday" })).toBeChecked();
    expect(within(panel).getByRole("radio", { name: "Price: low to high" })).toBeChecked();
    expect(await screen.findByText(/Birthday · Price: low to high/)).toBeInTheDocument(); // the summary under the bar
  });

  it("picking a category narrows the request, and the pill shows it is selected", async () => {
    const { calls } = open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Breads" }));
    expect(screen.getByRole("radio", { name: "Breads" })).toBeChecked();
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/products?")).at(-1)!.url).toContain("category=breads"));
  });

  it("clears everything with one button, and the button only appears when something is set", async () => {
    open("/menu?q=cake&category=breads");
    const user = userEvent.setup();
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    await user.click(clear);
    expect(screen.getByLabelText("Search the menu")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("closes the panel with Escape", async () => {
    open();
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Filters" });
    await user.click(button);
    expect(screen.getByRole("radio", { name: "Newest" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radio", { name: "Newest" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("has no axe violations with the panel open", async () => {
    const { container } = open("/menu?occasion=birthday");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Filters/ }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("shared look", () => {
  it("the 404 page offers one way home", async () => {
    mockFetch(store);
    renderApp(<App />, "/nowhere");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("the home page lists up to five products with a price in each group", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...cake, id: 100 + i, slug: `cake-${i}`, name: `Cake ${i}` }));
    mockFetch({ ...store, ...taxonomy, "/products": { body: page(many) } });
    renderApp(<App />, "/");
    const group = (await screen.findByRole("link", { name: "Celebration Cakes" })).closest("section")!;
    await within(group).findByRole("link", { name: "Cake 0" });
    expect(within(group).getAllByRole("listitem")).toHaveLength(5);
  });

  it("the home page says whether the bakery is open, from the hours the owner set", async () => {
    const hours = Array.from({ length: 7 }, (_, d) => ({ weekday: d, opens_at: "00:00:00", closes_at: "23:59:00", is_closed: false }));
    mockFetch({ "/store": { body: { ...store["/store"].body, opening_hours: hours } }, ...taxonomy, "/products": { body: page([cake]) } });
    renderApp(<App />, "/");
    expect(await screen.findByText(/Open now, until/)).toBeInTheDocument();
  });

  it("the order page shows progress as a list with done, current and not-yet steps", async () => {
    const order = { code: "BK-ABC234", status: "preparing", payment_method: "cod", payment_status: "unpaid", fulfilment_type: "pickup", fulfilment_date: "2030-12-04", slot_starts_at: "2030-12-04T08:00:00Z", slot_ends_at: "2030-12-04T10:00:00Z", time_slot_id: 1, zone_id: null, zone_name: null, delivery_address: null, contact_name: "Sara", contact_email: "s@e.com", contact_phone: "1", subtotal: 100, delivery_fee: 0, total: 100, currency: "EGP", customer_notes: null, is_delayed: false, delay_note: null, rejection_reason: null, cancellation_reason: null, placed_at: "2030-12-01T10:30:00Z", items: [], events: [], can_change: false, can_modify_until: null, cancel_refund: null };
    mockFetch({ ...store, "/orders/BK-ABC234": { body: order } });
    renderApp(<App />, "/track/BK-ABC234?t=tok");
    const list = await screen.findByRole("list", { name: "Order progress" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[0]).toHaveTextContent("Received (done)");
    expect(items[2]).toHaveTextContent("Being prepared (current)");
    expect(items[4]).toHaveTextContent("Picked up (not yet)");
  });
});
