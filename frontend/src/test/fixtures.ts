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
  permissions: { account: { read: true, write: true }, catalog_admin: { read: true, write: true }, schedule_admin: { read: true, write: true }, settings: { read: true, write: true }, orders_queue: { read: true, write: true }, team: { read: true, write: true } },
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

// ---- checkout ----
const PRICES: Record<number, number> = { 10: 65000, 11: 95000 };
const VARIANT_NAMES: Record<number, string> = { 10: "6-inch", 11: "8-inch" };
interface FakeReq {
  items: { variant_id: number; quantity: number; inscription: string | null }[];
  fulfilment_type?: string; zone_id?: number; date?: string; slot_id?: number;
}
export function fakeQuote(req: FakeReq, problems: { field: string; code: string; message: string }[] = [], unavailable: number[] = []) {
  const lines = req.items.map((i) => {
    const ok = !unavailable.includes(i.variant_id);
    return {
      variant_id: i.variant_id, product_id: 1, slug: "triple-chocolate-cake", product_name: "Triple Chocolate Cake",
      variant_name: VARIANT_NAMES[i.variant_id] ?? "", unit_price: PRICES[i.variant_id] ?? 0, quantity: i.quantity,
      line_total: ok ? (PRICES[i.variant_id] ?? 0) * i.quantity : 0, inscription: i.inscription,
      image: image(1, "A whole chocolate cake"), available: ok, message: ok ? null : "Triple Chocolate Cake is no longer available.",
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.line_total, 0);
  const fee = req.fulfilment_type === "delivery" && req.zone_id ? 4000 : 0;
  const all = [...problems, ...unavailable.map(() => ({ field: "items", code: "item_unavailable", message: "Triple Chocolate Cake is no longer available." }))];
  const complete = Boolean(subtotal && req.fulfilment_type && (req.fulfilment_type === "pickup" || req.zone_id) && req.date && req.slot_id);
  return { lines, subtotal, delivery_fee: fee, total: subtotal + fee, currency: "EGP", currency_exponent: 2, zone_minimum: null, problems: all, ready: complete && all.length === 0 };
}
export const datesBody = {
  earliest_date: "2030-12-04",
  days: [
    { date: "2030-12-03", available: false, reason: "lead_time", message: "Needs at least 2 days notice." },
    { date: "2030-12-04", available: true, reason: null, message: null },
    { date: "2030-12-05", available: true, reason: null, message: null },
  ],
};
export const slotsBody = {
  date: "2030-12-04", available: true, reason: null, message: null,
  slots: [
    { slot_id: 1, starts_at: "10:00:00", ends_at: "12:00:00", available: true, reason: null, message: null, remaining_orders: 6 },
    { slot_id: 2, starts_at: "12:00:00", ends_at: "14:00:00", available: false, reason: "slot_full", message: "Fully booked.", remaining_orders: 0 },
    { slot_id: 3, starts_at: "14:00:00", ends_at: "16:00:00", available: true, reason: null, message: null, remaining_orders: 1 },
  ],
};
export const publicZones = [
  { id: 1, name: "Maadi", fee: 4000, min_order_amount: 30000 },
  { id: 2, name: "Zamalek", fee: 0, min_order_amount: 0 },
];
export const placedOrder = {
  code: "BK-ABC234", status: "received", payment_method: "cod", payment_status: "unpaid", fulfilment_type: "delivery",
  fulfilment_date: "2030-12-04", slot_starts_at: "2030-12-04T08:00:00Z", slot_ends_at: "2030-12-04T10:00:00Z",
  zone_name: "Maadi", delivery_address: { street: "12 Road 9", building: "5", floor: "3", landmark: "Next to the mosque" },
  contact_name: "Sara Ali", contact_email: "sara@example.com", contact_phone: "+20 100 123 4567",
  subtotal: 130000, delivery_fee: 4000, total: 134000, currency: "EGP", customer_notes: "Ring twice",
  is_delayed: false, delay_note: null, rejection_reason: null, cancellation_reason: null,
  placed_at: "2030-12-01T10:30:00Z",
  items: [{ product_name: "Triple Chocolate Cake", variant_name: "6-inch", unit_price: 65000, quantity: 2, line_total: 130000, inscription: "Happy Birthday" }],
  events: [{ from_status: null, to_status: "received", reason: null, created_at: "2030-12-01T10:30:00Z" }],
};

// ---- staff order queue ----
export const queueRow = {
  id: 7, code: "BK-ABC234", status: "received", fulfilment_type: "delivery", fulfilment_date: "2030-12-04",
  slot_starts_at: "2030-12-04T08:00:00Z", slot_ends_at: "2030-12-04T10:00:00Z", zone_name: "Maadi",
  contact_name: "Sara Ali", contact_phone: "+20 100 123 4567", total: 134000, currency: "EGP",
  payment_method: "cod", payment_status: "unpaid", is_delayed: false, delay_note: null, item_count: 2,
};
export const queuePage = (items: unknown[] = [queueRow]) => ({ items, total: items.length, page: 1, page_size: 25, total_pages: 1 });
export const queueSummary = {
  counts: { received: 1, accepted: 2, preparing: 0, ready: 0, out_for_delivery: 0, delivered: 1, picked_up: 0, rejected: 0, cancelled: 1 },
  total: 5, delayed: 1,
};
export const staffOrder = {
  ...placedOrder, id: 7, can_mark_paid: true, can_delay: true, messages: [],
  actions: [{ to: "accepted", needs_reason: false }, { to: "rejected", needs_reason: true }, { to: "cancelled", needs_reason: true }],
};
export const prepSheet = {
  date: "2030-12-04", order_count: 3, total_units: 4,
  lines: [{ product_name: "Triple Chocolate Cake", variant_name: "6-inch", quantity: 3, orders: 2 }, { product_name: "Triple Chocolate Cake", variant_name: "8-inch", quantity: 1, orders: 1 }],
  messages: [{ order_code: "BK-ABC234", slot_starts_at: "2030-12-04T08:00:00Z", product_name: "Triple Chocolate Cake", variant_name: "6-inch", quantity: 1, text: "Happy Birthday Sara" }],
};

// ---- M6: change, cancel and account ----
export const POLICY = "You can cancel or change an order until 24 hours before its time slot, as long as we have not started preparing it. A cancelled order paid by card is refunded in full.";
export const changeable = {
  ...placedOrder, time_slot_id: 1, zone_id: 1,
  can_change: true, can_modify_until: "2030-12-03T08:00:00Z", cancel_refund: null,
};
export const savedAddress = (id: number, label: string, extra = {}) => ({
  id, label, zone_id: 1, zone_name: "Maadi", street: "12 Road 9", building: "5", floor: "3", apartment: null, landmark: "Next to the mosque", is_default: false, ...extra,
});
export const orderRow = (code: string, extra = {}) => ({
  code, status: "received", fulfilment_type: "delivery", fulfilment_date: "2030-12-04",
  slot_starts_at: "2030-12-04T08:00:00Z", slot_ends_at: "2030-12-04T10:00:00Z", total: 134000, currency: "EGP",
  payment_method: "cod", payment_status: "unpaid", placed_at: "2030-12-01T10:30:00Z", summary: "2 × Triple Chocolate Cake", ...extra,
});
