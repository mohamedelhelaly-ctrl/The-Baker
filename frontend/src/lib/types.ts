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
