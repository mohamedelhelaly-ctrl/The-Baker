// Mirrors backend/app/schemas. Keep in sync in the same pull request as the API change.
export type UserRole = "customer" | "staff" | "owner";

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
}

export interface ModuleAccess {
  read: boolean;
  write: boolean;
}

export interface Me extends User {
  permissions: Record<string, ModuleAccess>;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface MessageResponse {
  message: string;
}

// ---- catalog (mirrors backend/app/schemas/catalog.py and admin_catalog.py) ----
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface StoreInfo {
  name: string;
  currency: string;
  currency_exponent: number;
  opening_hours: HoursEntry[];
}

export interface CategoryBrief {
  id: number;
  name: string;
  slug: string;
}
export interface Category extends CategoryBrief {
  description: string | null;
}
export interface Occasion {
  id: number;
  name: string;
  slug: string;
}
export interface ProductImage {
  id: number;
  url: string;
  alt_text: string;
  sort_order: number;
}
export interface Variant {
  id: number;
  name: string;
  price: number; // minor units
  sort_order: number;
}
export interface ProductListItem {
  id: number;
  slug: string;
  name: string;
  category: CategoryBrief;
  price_from: number;
  image: ProductImage | null;
  is_featured: boolean;
}
export interface ProductDetail {
  id: number;
  slug: string;
  name: string;
  description: string;
  ingredients: string;
  lead_time_hours: number;
  category: CategoryBrief;
  occasions: Occasion[];
  variants: Variant[];
  images: ProductImage[];
}

export interface AdminCategory extends Category {
  sort_order: number;
  is_archived: boolean;
}
export interface AdminOccasion extends Occasion {
  sort_order: number;
  is_archived: boolean;
}
export interface AdminVariant extends Variant {
  is_active: boolean;
}
export interface AdminProduct {
  id: number;
  slug: string;
  name: string;
  description: string;
  ingredients: string;
  lead_time_hours: number;
  daily_capacity: number | null;
  is_available: boolean;
  is_archived: boolean;
  is_featured: boolean;
  available_weekdays: number[];
  category: CategoryBrief;
  occasions: Occasion[];
  variants: AdminVariant[];
  images: ProductImage[];
}
export interface AdminProductListItem {
  id: number;
  slug: string;
  name: string;
  category_name: string;
  is_available: boolean;
  is_archived: boolean;
  is_featured: boolean;
  price_from: number | null;
  image: ProductImage | null;
}

// ---- schedule and availability (mirrors backend/app/schemas/schedule.py) ----
export interface HoursEntry {
  weekday: number; // 0 = Monday
  opens_at: string; // "HH:MM:SS"
  closes_at: string;
  is_closed: boolean;
}
export type SlotFulfilment = "delivery" | "pickup" | "both";
export interface TimeSlot {
  id: number;
  weekday: number;
  starts_at: string;
  ends_at: string;
  fulfilment_type: SlotFulfilment;
  max_orders: number;
  is_active: boolean;
}
export interface Closure {
  id: number;
  date: string; // YYYY-MM-DD
  reason: string;
}
export interface DeliveryZone {
  id: number;
  name: string;
  fee: number; // minor units
  min_order_amount: number;
}
export interface AdminDeliveryZone extends DeliveryZone {
  sort_order: number;
  is_active: boolean;
}
export interface DayAvailability {
  date: string;
  available: boolean;
  reason: string | null;
  message: string | null;
}
export interface DatesResponse {
  earliest_date: string | null;
  days: DayAvailability[];
}

// ---- cart, checkout and orders (mirrors backend/app/schemas/checkout.py) ----
export interface QuoteLine {
  variant_id: number;
  product_id: number | null;
  slug: string | null;
  product_name: string;
  variant_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  inscription: string | null;
  image: ProductImage | null;
  available: boolean;
  message: string | null;
}
export interface Problem {
  field: "items" | "zone" | "date" | "slot" | string;
  code: string;
  message: string;
}
export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  currency: string;
  currency_exponent: number;
  zone_minimum: number | null;
  problems: Problem[];
  ready: boolean;
}
export type Fulfilment = "delivery" | "pickup";
export interface SlotOption {
  slot_id: number;
  starts_at: string;
  ends_at: string;
  available: boolean;
  reason: string | null;
  message: string | null;
  remaining_orders: number;
}
export interface SlotsResponse {
  date: string;
  available: boolean;
  reason: string | null;
  message: string | null;
  slots: SlotOption[];
}
export type OrderStatus =
  | "pending_payment" | "received" | "accepted" | "rejected" | "preparing"
  | "ready" | "out_for_delivery" | "delivered" | "picked_up" | "cancelled";
export interface OrderItem {
  product_name: string;
  variant_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  inscription: string | null;
}
export interface OrderEvent {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  reason: string | null;
  created_at: string;
}
export interface Order {
  code: string;
  status: OrderStatus;
  payment_method: "cod" | "card";
  payment_status: string;
  fulfilment_type: Fulfilment;
  fulfilment_date: string;
  slot_starts_at: string;
  slot_ends_at: string;
  zone_name: string | null;
  delivery_address: { street: string; building: string; floor?: string; apartment?: string; landmark?: string } | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  currency: string;
  customer_notes: string | null;
  is_delayed: boolean;
  delay_note: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  placed_at: string;
  items: OrderItem[];
  events: OrderEvent[];
}
export interface OrderCreated extends Order {
  tracking_token: string;
}
