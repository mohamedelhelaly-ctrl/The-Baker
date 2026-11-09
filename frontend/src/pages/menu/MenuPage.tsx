import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ProductCard } from "../../components/catalog/ProductCard";
import { Pagination } from "../../components/ui/Pagination";
import { SelectField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { s } from "../../lib/strings";
import type { Category, Occasion, Page, ProductListItem } from "../../lib/types";

const SORTS = ["featured", "name", "price_asc", "price_desc", "newest"] as const;

export default function MenuPage() {
  usePageTitle(s.menu.title);
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const occasion = params.get("occasion") ?? "";
  const sort = params.get("sort") ?? "featured";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  function update(changes: Record<string, string>, keepPage = false) {
    // Functional update: a delayed search must not overwrite filters changed in the meantime.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!keepPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  // The URL is the source of truth (shareable, back button works). Typing is debounced into it.
  const [search, setSearch] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function onSearchChange(value: string) {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ q: value.trim() }), 300);
  }

  const categories = useApi<Category[]>("/categories");
  const occasions = useApi<Occasion[]>("/occasions");
  const query = new URLSearchParams({ sort, page: String(page), page_size: "12" });
  if (category) query.set("category", category);
  if (occasion) query.set("occasion", occasion);
  if (q) query.set("q", q);
  const products = useApi<Page<ProductListItem>>(`/products?${query}`);
  const filtered = Boolean(category || occasion || q);

  return (
    <>
      <h1 className="mb-6 font-display text-3xl font-bold">{s.menu.title}</h1>

      <search aria-label={s.menu.title}><form onSubmit={(e) => e.preventDefault()} className="mb-6 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label={s.menu.search}
          type="search"
          name="q"
          autoComplete="off"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <SelectField label={s.menu.category} value={category} onChange={(e) => update({ category: e.target.value })}>
          <option value="">{s.menu.all}</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={s.menu.occasion} value={occasion} onChange={(e) => update({ occasion: e.target.value })}>
          <option value="">{s.menu.all}</option>
          {occasions.data?.map((o) => (
            <option key={o.id} value={o.slug}>
              {o.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={s.menu.sort} value={sort} onChange={(e) => update({ sort: e.target.value === "featured" ? "" : e.target.value })}>
          {SORTS.map((k) => (
            <option key={k} value={k}>
              {s.menu.sorts[k]}
            </option>
          ))}
        </SelectField>
      </form>
      </search>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite">{products.data ? s.menu.results(products.data.total) : s.loading}</p>
        {filtered && (
          <button
            type="button"
            className="min-h-11 rounded-md border-2 border-line px-4 font-semibold"
            onClick={() => {
              clearTimeout(timer.current);
              setSearch("");
              setParams({}, { replace: true });
            }}
          >
            {s.menu.clear}
          </button>
        )}
      </div>

      {products.error && (
        <div role="alert" className="mb-5 rounded-md border-2 border-danger bg-danger-bg p-4 text-danger">
          <p>
            <span aria-hidden="true">⚠ </span>
            {s.menu.loadError}
          </p>
          <button type="button" onClick={products.reload} className="mt-2 min-h-11 rounded-md border-2 border-danger px-4 font-semibold">
            {s.menu.retry}
          </button>
        </div>
      )}

      {products.data && products.data.items.length === 0 && <p className="py-8 text-lg">{s.menu.none}</p>}
      {products.data && products.data.items.length > 0 && (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy={products.loading}>
          {products.data.items.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} headingLevel={2} />
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} totalPages={products.data?.total_pages ?? 1} onChange={(n) => update({ page: String(n) }, true)} />
    </>
  );
}
