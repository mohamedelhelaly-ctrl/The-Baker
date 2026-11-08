import type { AdminProduct, Page, ProductDetail, ProductListItem } from "../lib/types";

export const image = (id: number, alt: string) => ({ id, url: `http://api.test/media/p${id}.webp`, alt_text: alt, sort_order: id });

export const cake: ProductListItem = {
  id: 1, slug: "triple-chocolate-cake", name: "Triple Chocolate Cake", is_featured: true, price_from: 65000,
  category: { id: 1, name: "Celebration Cakes", slug: "celebration-cakes" },
  image: image(1, "Triple Chocolate Cake: illustration of the product"),
};
export const bread: ProductListItem = {
  id: 2, slug: "country-sourdough", name: "Country Sourdough", is_featured: false, price_from: 9000,
  category: { id: 2, name: "Breads", slug: "breads" },
  image: image(2, "Country Sourdough: illustration of the product"),
};

export const page = (items: ProductListItem[], extra: Partial<Page<ProductListItem>> = {}): Page<ProductListItem> => ({
  items, total: items.length, page: 1, page_size: 12, total_pages: 1, ...extra,
});

export const categories = [
  { id: 1, name: "Celebration Cakes", slug: "celebration-cakes", description: null },
  { id: 2, name: "Breads", slug: "breads", description: null },
];
export const occasions = [{ id: 1, name: "Birthday", slug: "birthday" }];

export const detail: ProductDetail = {
  id: 1, slug: "triple-chocolate-cake", name: "Triple Chocolate Cake",
  description: "Three layers of dark chocolate sponge.", ingredients: "Flour, cocoa, eggs",
  lead_time_hours: 48, category: cake.category, occasions,
  variants: [
    { id: 10, name: "6-inch, serves 8", price: 65000, sort_order: 0 },
    { id: 11, name: "8-inch, serves 14", price: 95000, sort_order: 1 },
  ],
  images: [image(1, "A whole chocolate cake"), image(3, "A slice of chocolate cake")],
};

export const owner = {
  id: 9, email: "owner@demo.thebaker", full_name: "Baker Owner", phone: null, role: "owner",
  permissions: { account: { read: true, write: true }, catalog_admin: { read: true, write: true }, schedule_admin: { read: true, write: true }, orders_queue: { read: true, write: true } },
};
export const customer = {
  id: 5, email: "sara@example.com", full_name: "Sara Ali", phone: null, role: "customer",
  permissions: { account: { read: true, write: true }, catalog_admin: { read: false, write: false } },
};

export const adminProduct: AdminProduct = {
  id: 1, slug: "triple-chocolate-cake", name: "Triple Chocolate Cake", description: "Three layers", ingredients: "Flour",
  lead_time_hours: 48, daily_capacity: null, is_available: true, is_archived: false, is_featured: true,
  available_weekdays: [0, 1, 2, 3, 4, 5, 6],
  category: cake.category, occasions,
  variants: [{ id: 10, name: "6-inch", price: 65000, sort_order: 0, is_active: true }],
  images: [image(1, "A whole chocolate cake")],
};

const t = (h: number) => `${String(h).padStart(2, "0")}:00:00`;
export const hours = Array.from({ length: 7 }, (_, d) => ({
  weekday: d, opens_at: d === 4 ? t(13) : t(9), closes_at: t(21), is_closed: false,
}));
export const slot = (id: number, weekday: number, start: number, extra = {}) => ({
  id, weekday, starts_at: t(start), ends_at: t(start + 2), fulfilment_type: "both", max_orders: 6, is_active: true, ...extra,
});
export const slotList = [slot(1, 0, 10), slot(2, 0, 12), slot(3, 4, 14, { fulfilment_type: "pickup", max_orders: 3 })];
export const closures = [{ id: 1, date: "2030-12-25", reason: "Holiday" }];
export const zones = [
  { id: 1, name: "Maadi", fee: 4000, min_order_amount: 30000, sort_order: 0, is_active: true },
  { id: 2, name: "Zamalek", fee: 0, min_order_amount: 0, sort_order: 1, is_active: false },
];
export const staff = {
  id: 7, email: "staff@demo.thebaker", full_name: "Baker Staff", phone: null, role: "staff",
  permissions: {
    account: { read: true, write: true }, orders_queue: { read: true, write: true },
    catalog_admin: { read: false, write: false }, schedule_admin: { read: true, write: false },
  },
};
