import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { leadTimeText, formatMoney, parsePrice, toMajorString } from "./lib/money";
import { adminProduct, bread, cake, categories, customer, detail, occasions, owner, page } from "./test/fixtures";
import { mockFetch, renderApp } from "./test/render";

const store = { "/store": { body: { name: "The Baker", currency: "EGP", currency_exponent: 2 } } };
const taxonomy = { "/categories": { body: categories }, "/occasions": { body: occasions } };

describe("money helpers", () => {
  it("formats minor units without float surprises", () => {
    expect(formatMoney(65000, "EGP", 2)).toMatch(/650\.00/);
    expect(formatMoney(5, "EGP", 2)).toMatch(/0\.05/);
    expect(formatMoney(1500, "KWD", 3)).toMatch(/1\.500/);
  });
  it("parses prices strictly", () => {
    expect(parsePrice("450")).toBe(45000);
    expect(parsePrice("450.5")).toBe(45050);
    expect(parsePrice("0.07")).toBe(7);
    for (const bad of ["", "abc", "-5", "1.234", "0", "1,5"]) expect(parsePrice(bad)).toBeNull();
    expect(toMajorString(45050)).toBe("450.50");
  });
  it("describes lead times", () => {
    expect(leadTimeText(0)).toMatch(/same-day/);
    expect(leadTimeText(5)).toBe("Order at least 5 hours ahead");
    expect(leadTimeText(48)).toBe("Order at least 2 days ahead");
  });
});

describe("home and menu", () => {
  it("home is a photograph, the menu groups with prices, and the visit details, with no axe violations", async () => {
    mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake, bread]) } });
    const { container } = renderApp(<App />, "/");
    expect(await screen.findByRole("heading", { level: 1, name: "Bakery in Cairo, baked to order" })).toBeInTheDocument();
    expect(screen.getByAltText("Rye loaves on the stone floor of an open bread oven")).toBeInTheDocument();
    const groupLink = await screen.findByRole("link", { name: "Celebration Cakes" });
    expect(groupLink).toHaveAttribute("href", "/menu?category=celebration-cakes");
    const group = groupLink.closest("section")!;
    const product = await within(group).findByRole("link", { name: "Triple Chocolate Cake" });
    expect(product).toHaveAttribute("href", "/products/triple-chocolate-cake");
    expect(within(group).getByText("EGP 650")).toBeInTheDocument(); // the price, whole pounds, beside the name
    expect(screen.getByRole("heading", { level: 2, name: "Menu and prices" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Visit" })).toBeInTheDocument();
    expect(screen.getByText("Photographs via Wikimedia Commons")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("menu lists products with photos, alt text and prices, and has no axe violations", async () => {
    mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake, bread]) } });
    const { container } = renderApp(<App />, "/menu");
    expect(await screen.findByText("2 products")).toBeInTheDocument();
    expect(screen.getByAltText("Triple Chocolate Cake: illustration of the product")).toBeInTheDocument();
    expect(screen.getByText(/From .*650\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Triple Chocolate Cake" })).toHaveAttribute("href", "/products/triple-chocolate-cake");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("filters by category and sorts, sending the choice to the API", async () => {
    const calls = mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake, bread]) } });
    renderApp(<App />, "/menu");
    const user = userEvent.setup();
    await screen.findByText("2 products");
    await user.click(screen.getByRole("radio", { name: "Breads" })); // category pills
    await user.click(screen.getByRole("button", { name: "Filters" })); // sort lives in the Filters panel
    await user.click(screen.getByRole("radio", { name: "Price: low to high" }));
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/products?")).at(-1)!.url;
      expect(last).toContain("category=breads");
      expect(last).toContain("sort=price_asc");
    });
  });

  describe("search", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("debounces typing into a single request", async () => {
      const calls = mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake]) } });
      renderApp(<App />, "/menu");
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await screen.findByText("1 product");
      const before = calls.filter((c) => c.url.includes("q=")).length;
      await user.type(screen.getByLabelText("Search the menu"), "choc");
      expect(calls.filter((c) => c.url.includes("q=")).length).toBe(before); // nothing sent while typing
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      await waitFor(() => expect(calls.filter((c) => c.url.includes("q=choc")).length).toBe(1));
    });
  });

  it("shows a friendly empty state and can clear filters", async () => {
    mockFetch({ ...store, ...taxonomy, "/products": { body: page([]) } });
    renderApp(<App />, "/menu?q=zzz");
    expect(await screen.findByText(/Nothing matches your search/)).toBeInTheDocument();
    expect(screen.getByLabelText("Search the menu")).toHaveValue("zzz");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Search the menu")).toHaveValue("");
  });

  it("shows an error with a retry button when the API fails", async () => {
    mockFetch({ ...store, ...taxonomy, "/products": { status: 500, body: { error: { code: "error", message: "boom" } } } });
    renderApp(<App />, "/menu");
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load the menu.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("paginates with Previous and Next", async () => {
    const calls = mockFetch({ ...store, ...taxonomy, "/products": { body: page([cake], { total: 25, total_pages: 3 }) } });
    renderApp(<App />, "/menu");
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls.at(-1)!.url).toContain("page=2"));
  });
});

describe("product page", () => {
  it("shows details and switches the price when another size is chosen", async () => {
    mockFetch({ ...store, "/products/triple-chocolate-cake": { body: detail } });
    const { container } = renderApp(<App />, "/products/triple-chocolate-cake");
    expect(await screen.findByRole("heading", { level: 1, name: "Triple Chocolate Cake" })).toBeInTheDocument();
    expect(screen.getByText("Flour, cocoa, eggs")).toBeInTheDocument();
    expect(screen.getByText("Order at least 2 days ahead")).toBeInTheDocument();
    const price = screen.getByText(/650\.00/, { selector: "p" });
    await userEvent.click(screen.getByLabelText(/8-inch/));
    expect(price).toHaveTextContent(/950\.00/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("gallery thumbnails switch the main photo and expose alt text", async () => {
    mockFetch({ ...store, "/products/triple-chocolate-cake": { body: detail } });
    renderApp(<App />, "/products/triple-chocolate-cake");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByAltText("A whole chocolate cake")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Photo 2 of 2: A slice of chocolate cake/ }));
    expect(screen.getByAltText("A slice of chocolate cake")).toBeInTheDocument();
  });

  it("explains a missing product", async () => {
    mockFetch({ ...store, "/products/nope": { status: 404, body: { error: { code: "product_not_found", message: "x" } } } });
    renderApp(<App />, "/products/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "We could not find that product." })).toBeInTheDocument();
  });
});

describe("owner area", () => {
  const adminRoutes = {
    ...store,
    "/admin/products": { body: { items: [{ id: 1, slug: "x", name: "Triple Chocolate Cake", category_name: "Celebration Cakes", is_available: true, is_archived: false, is_featured: true, price_from: 65000, image: cake.image }], total: 1, page: 1, page_size: 20, total_pages: 1 } },
    "/admin/categories": { body: categories.map((c) => ({ ...c, sort_order: 0, is_archived: false })) },
    "/admin/occasions": { body: occasions.map((o) => ({ ...o, sort_order: 0, is_archived: false })) },
    "/admin/products/1": { body: adminProduct },
  };

  it("hides the manage link and blocks the pages for customers", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({ ...store, "/auth/me": { body: customer } });
    renderApp(<App />, "/admin/products");
    expect(await screen.findByRole("heading", { level: 1, name: "You do not have access to this page" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage shop" })).not.toBeInTheDocument();
  });

  it("sends signed-out visitors to sign in", async () => {
    renderApp(<App />, "/admin/products");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("lets the owner see the product table, accessibly", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({ "/auth/me": { body: owner }, ...adminRoutes });
    const { container } = renderApp(<App />, "/admin/products");
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "Triple Chocolate Cake" })).toHaveAttribute("href", "/admin/products/1");
    await userEvent.click(screen.getByRole("button", { name: /account menu/ })); // Manage shop lives in the account menu
    expect(screen.getByRole("link", { name: "Manage shop" })).toBeInTheDocument();
    expect(within(table).getByText("On the menu")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("archives a product and announces it", async () => {
    localStorage.setItem("baker.token", "tok");
    const calls = mockFetch({ "/auth/me": { body: owner }, ...adminRoutes, "/admin/products/1/archive": { body: {} } });
    renderApp(<App />, "/admin/products");
    await userEvent.click(await screen.findByRole("button", { name: "Archive Triple Chocolate Cake" }));
    expect(await screen.findByText("Triple Chocolate Cake was archived.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/admin/products/1/archive") && c.init?.method === "POST")).toBe(true);
  });

  it("validates the new-product form: server errors are linked to fields and summarised", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({
      "/auth/me": { body: owner }, ...adminRoutes,
      "/admin/products": { status: 422, body: { error: { code: "validation_error", message: "Please check the highlighted fields.", fields: { name: "This field cannot be empty." } } } },
    });
    renderApp(<App />, "/admin/products/new");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "New product" });
    await user.type(screen.getByLabelText("Size 1 name"), "6-inch");
    await user.type(screen.getByLabelText("Size 1 price"), "450");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This field cannot be empty.");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a malformed price before calling the API", async () => {
    localStorage.setItem("baker.token", "tok");
    const calls = mockFetch({ "/auth/me": { body: owner }, ...adminRoutes });
    renderApp(<App />, "/admin/products/new");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "New product" });
    await user.type(screen.getByLabelText("Name"), "Test cake");
    await user.type(screen.getByLabelText("Size 1 name"), "S");
    await user.type(screen.getByLabelText("Size 1 price"), "12,5");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter every price as a number/);
    expect(calls.some((c) => c.init?.method === "POST" && c.url.endsWith("/admin/products"))).toBe(false);
  });

  it("requires alt text before uploading a photo", async () => {
    localStorage.setItem("baker.token", "tok");
    const calls = mockFetch({ "/auth/me": { body: owner }, ...adminRoutes });
    renderApp(<App />, "/admin/products/1");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 2, name: "Photos" });
    await user.upload(screen.getByLabelText("Photo file"), new File(["x"], "cake.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByText(/cannot see it/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/images") && c.init?.method === "POST")).toBe(false);
  });

  it("edit page has no axe violations", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({ "/auth/me": { body: owner }, ...adminRoutes });
    const { container } = renderApp(<App />, "/admin/products/1");
    await screen.findByRole("heading", { level: 2, name: "Photos" });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("categories page adds a category", async () => {
    localStorage.setItem("baker.token", "tok");
    const calls = mockFetch({ "/auth/me": { body: owner }, ...adminRoutes });
    renderApp(<App />, "/admin/categories");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Categories" });
    await user.type(screen.getByLabelText("Name"), "Tarts");
    await user.click(screen.getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST" && c.url.endsWith("/admin/categories"))).toBe(true));
  });
});
