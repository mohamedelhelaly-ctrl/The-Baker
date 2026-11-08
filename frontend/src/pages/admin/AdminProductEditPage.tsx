import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { CheckboxField, SelectField, TextAreaField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { WEEKDAYS } from "../../lib/dates";
import { parsePrice } from "../../lib/money";
import { useStore } from "../../lib/store";
import type { AdminCategory, AdminOccasion, AdminProduct } from "../../lib/types";
import { ErrorSummary } from "../auth/ErrorSummary";
import { ImagesEditor } from "./ImagesEditor";
import { SizesEditor } from "./SizesEditor";
import { StatusBadge } from "./StatusBadge";

export default function AdminProductEditPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const product = useApi<AdminProduct>(isNew ? null : `/admin/products/${id}`);
  const categories = useApi<AdminCategory[]>("/admin/categories");
  const occasions = useApi<AdminOccasion[]>("/admin/occasions");
  usePageTitle(isNew ? "New product" : (product.data?.name ?? "Edit product"));

  if (!categories.data || !occasions.data || (!isNew && !product.data)) {
    return product.error ? <Alert kind="error">{product.error.message}</Alert> : <output>Loading…</output>;
  }
  return (
    <>
      <p className="mb-4">
        <Link to="/admin/products" className="underline">
          Back to products
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">{isNew ? "New product" : product.data!.name}</h1>
        {product.data?.is_archived && <StatusBadge kind="off">Archived</StatusBadge>}
        {product.data && (
          <ArchiveButton product={product.data} onDone={product.reload} />
        )}
      </div>
      <ProductForm
        key={product.data ? `${product.data.id}-${JSON.stringify([product.data.name, product.data.category.id])}` : "new"}
        product={product.data}
        categories={categories.data.filter((c) => !c.is_archived || c.id === product.data?.category.id)}
        occasions={occasions.data.filter((o) => !o.is_archived || product.data?.occasions.some((x) => x.id === o.id))}
        onSaved={product.reload}
      />
      {product.data && (
        <>
          <SizesEditor product={product.data} onChanged={product.reload} />
          <ImagesEditor product={product.data} onChanged={product.reload} />
        </>
      )}
    </>
  );
}

function ArchiveButton({ product, onDone }: { product: AdminProduct; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="min-h-11 rounded-md border-2 border-line px-4 font-semibold"
        onClick={async () => {
          try {
            await api.post(`/admin/products/${product.id}/${product.is_archived ? "restore" : "archive"}`);
            onDone();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Something went wrong.");
          }
        }}
      >
        {product.is_archived ? "Restore product" : "Archive product"}
      </button>
      {error && <span role="alert" className="text-danger">{error}</span>}
    </>
  );
}

interface SizeRow {
  name: string;
  price: string;
}

function ProductForm({ product, categories, occasions, onSaved }: {
  product?: AdminProduct | null;
  categories: AdminCategory[];
  occasions: AdminOccasion[];
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const { currency, currency_exponent } = useStore();
  const [f, setF] = useState({
    name: product?.name ?? "",
    category_id: String(product?.category.id ?? categories[0]?.id ?? ""),
    description: product?.description ?? "",
    ingredients: product?.ingredients ?? "",
    lead_time_hours: String(product?.lead_time_hours ?? 24),
    daily_capacity: product?.daily_capacity ? String(product.daily_capacity) : "",
    is_available: product?.is_available ?? true,
    is_featured: product?.is_featured ?? false,
    occasion_ids: product?.occasions.map((o) => o.id) ?? [],
    weekdays: product?.available_weekdays ?? [0, 1, 2, 3, 4, 5, 6],
  });
  const [sizes, setSizes] = useState<SizeRow[]>([{ name: "", price: "" }]);
  const [saved, setSaved] = useState(false);

  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    setSaved(false);
    const base = {
      category_id: Number(f.category_id),
      name: f.name,
      description: f.description,
      ingredients: f.ingredients,
      lead_time_hours: Number(f.lead_time_hours),
      daily_capacity: f.daily_capacity ? Number(f.daily_capacity) : null,
      is_available: f.is_available,
      is_featured: f.is_featured,
      occasion_ids: f.occasion_ids,
    };
    if (product) {
      await api.patch(`/admin/products/${product.id}`, base);
      await api.put(`/admin/products/${product.id}/availability`, { available_weekdays: f.weekdays });
      setSaved(true);
      onSaved();
      return;
    }
    const variants = sizes.map((row, i) => ({ name: row.name, price: parsePrice(row.price, currency_exponent), sort_order: i }));
    if (variants.some((v) => v.price === null)) {
      throw new ApiError(422, "validation_error", "Check the prices.", { sizes: `Enter every price as a number such as 450 or 450.50 (${currency}).` });
    }
    const created = await api.post<AdminProduct>("/admin/products", { ...base, variants });
    if (f.weekdays.length < 7) {
      await api.put(`/admin/products/${created.id}/availability`, { available_weekdays: f.weekdays });
    }
    navigate(`/admin/products/${created.id}`, { replace: true });
  });

  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((s) => ({ ...s, [key]: value }));
  const fieldError = (name: string) => error?.fields[name];

  return (
    <form onSubmit={onSubmit} noValidate className="mb-12 max-w-2xl">
      <ErrorSummary error={error} summaryRef={summaryRef} />
      {saved && <Alert kind="success">Changes saved.</Alert>}

      <TextField label="Name" required value={f.name} onChange={(e) => set("name", e.target.value)} error={fieldError("name")} />
      <SelectField label="Category" required value={f.category_id} onChange={(e) => set("category_id", e.target.value)} error={fieldError("category_id")}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextAreaField label="Description" value={f.description} onChange={(e) => set("description", e.target.value)} error={fieldError("description")} />
      <TextAreaField label="Ingredients" rows={3} hint="Shown to customers on the product page." value={f.ingredients} onChange={(e) => set("ingredients", e.target.value)} error={fieldError("ingredients")} />

      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField label="Lead time (hours)" type="number" min={0} hint="How far ahead customers must order." value={f.lead_time_hours} onChange={(e) => set("lead_time_hours", e.target.value)} error={fieldError("lead_time_hours")} />
        <TextField label="Daily capacity" type="number" min={1} hint="Maximum units per day. Leave empty for no limit." value={f.daily_capacity} onChange={(e) => set("daily_capacity", e.target.value)} error={fieldError("daily_capacity")} />
      </div>

      <fieldset className="mb-5">
        <legend className="mb-1 font-semibold">Occasions</legend>
        {occasions.map((o) => (
          <CheckboxField
            key={o.id}
            label={o.name}
            checked={f.occasion_ids.includes(o.id)}
            onChange={(e) => set("occasion_ids", e.target.checked ? [...f.occasion_ids, o.id] : f.occasion_ids.filter((x) => x !== o.id))}
          />
        ))}
        {occasions.length === 0 && <p className="text-muted">No occasions yet. Add some under Occasions.</p>}
      </fieldset>

      <fieldset className="mb-5">
        <legend className="mb-1 font-semibold">Days on sale</legend>
        <p className="mb-1 text-sm text-muted">Customers cannot choose a delivery or pickup day this product is not sold.</p>
        <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
          {WEEKDAYS.map((day, i) => (
            <CheckboxField
              key={day}
              label={day}
              checked={f.weekdays.includes(i)}
              onChange={(e) => set("weekdays", e.target.checked ? [...f.weekdays, i].sort() : f.weekdays.filter((x) => x !== i))}
            />
          ))}
        </div>
      </fieldset>

      <CheckboxField label="Show on the menu" hint="Untick to hide the product without archiving it." checked={f.is_available} onChange={(e) => set("is_available", e.target.checked)} />
      <CheckboxField label="Featured" hint="Featured products appear first and on the home page." checked={f.is_featured} onChange={(e) => set("is_featured", e.target.checked)} />

      {!product && (
        <fieldset className="mb-6">
          <legend className="mb-2 font-semibold">Sizes and prices ({currency})</legend>
          {fieldError("sizes") && <p className="mb-2 font-medium text-danger"><span aria-hidden="true">⚠ </span>{fieldError("sizes")}</p>}
          {sizes.map((row, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_8rem_auto] items-end gap-2">
              <TextField label={`Size ${i + 1} name`} placeholder="6-inch, serves 8" value={row.name} onChange={(e) => setSizes(sizes.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} />
              <TextField label={`Size ${i + 1} price`} inputMode="decimal" placeholder="450.00" value={row.price} onChange={(e) => setSizes(sizes.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)))} />
              {sizes.length > 1 && (
                <button type="button" onClick={() => setSizes(sizes.filter((_, j) => j !== i))} className="mb-5 min-h-11 rounded-md border-2 border-line px-3 font-semibold">
                  Remove{" "}<span className="sr-only">size {i + 1}</span>
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setSizes([...sizes, { name: "", price: "" }])} className="min-h-11 rounded-md border-2 border-line px-4 font-semibold">
            Add another size
          </button>
        </fieldset>
      )}

      <Button type="submit" disabled={pending}>
        {product ? "Save changes" : "Create product"}
      </Button>
      {!product && <p className="mt-3 text-muted">You can add photos after the product is created.</p>}
    </form>
  );
}
