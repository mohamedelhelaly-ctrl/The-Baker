import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ProductCard } from "../../components/catalog/ProductCard";
import { Pagination } from "../../components/ui/Pagination";
import { Popover } from "../../components/ui/Popover";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { s } from "../../lib/strings";
import type { Category, Occasion, Page, ProductListItem } from "../../lib/types";

const SORTS = ["featured", "name", "price_asc", "price_desc", "newest"] as const;

/** A radio that looks like a chip: one tab stop per group, arrow keys to move, a clear selected state. */
function Choice({ name, value, checked, onSelect, children }: { name: string; value: string; checked: boolean; onSelect: () => void; children: string }) {
  return (
    <label className="chip">
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

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

  const sortLabel = s.menu.sorts[sort as (typeof SORTS)[number]] ?? s.menu.sorts.featured;
  const occasionName = occasions.data?.find((o) => o.slug === occasion)?.name;
  const panelActive = (occasion ? 1 : 0) + (sort !== "featured" ? 1 : 0); // what is tucked into the Filters panel
  const filtered = Boolean(category || occasion || q || sort !== "featured");
  const summary = [occasionName, sort !== "featured" ? sortLabel : null].filter(Boolean).join(" · ");

  function clearAll() {
    clearTimeout(timer.current);
    setSearch("");
    setParams({}, { replace: true });
  }

  return (
    <>
      <h1 className="mb-6 font-display text-4xl font-bold">{s.menu.title}</h1>

      <search aria-label={s.menu.title} className="mb-8 grid gap-4">
        <form onSubmit={(e) => e.preventDefault()} className="flex items-center gap-3">
          <div className="relative flex-1">
            <label htmlFor="menu-search" className="sr-only">
              {s.menu.search}
            </label>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="menu-search"
              type="search"
              name="q"
              autoComplete="off"
              placeholder="Search cakes, bakes, kahk…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="control ps-12"
            />
          </div>
          <Popover
            button={
              <>
                Filters
                {panelActive > 0 && (
                  <span aria-hidden="true" className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-bold leading-5 text-primary-ink">
                    {panelActive}
                  </span>
                )}
              </>
            }
            label={panelActive > 0 ? `Filters, ${panelActive} active` : "Filters"}
            width="w-[22rem]"
          >
            <fieldset className="mb-5">
              <legend className="eyebrow mb-2">{s.menu.occasion}</legend>
              <div className="flex flex-wrap gap-2">
                <Choice name="occasion" value="" checked={occasion === ""} onSelect={() => update({ occasion: "" })}>
                  {s.menu.all}
                </Choice>
                {occasions.data?.map((o) => (
                  <Choice key={o.id} name="occasion" value={o.slug} checked={occasion === o.slug} onSelect={() => update({ occasion: o.slug })}>
                    {o.name}
                  </Choice>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="eyebrow mb-2">{s.menu.sort}</legend>
              <div className="flex flex-wrap gap-2">
                {SORTS.map((k) => (
                  <Choice key={k} name="sort" value={k} checked={sort === k} onSelect={() => update({ sort: k === "featured" ? "" : k })}>
                    {s.menu.sorts[k]}
                  </Choice>
                ))}
              </div>
            </fieldset>
          </Popover>
        </form>

        <fieldset>
          <legend className="sr-only">{s.menu.category}</legend>
          <div className="flex flex-wrap gap-2">
            <Choice name="category" value="" checked={category === ""} onSelect={() => update({ category: "" })}>
              {s.menu.all}
            </Choice>
            {categories.data?.map((c) => (
              <Choice key={c.id} name="category" value={c.slug} checked={category === c.slug} onSelect={() => update({ category: c.slug })}>
                {c.name}
              </Choice>
            ))}
          </div>
        </fieldset>
      </search>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p aria-live="polite" className="text-muted">
          {products.data ? s.menu.results(products.data.total) : s.loading}
          {summary && <span> · {summary}</span>}
        </p>
        {filtered && !(products.data && products.data.items.length === 0) && (
          <button type="button" className="btn btn-quiet" onClick={clearAll}>
            {s.menu.clear}
          </button>
        )}
      </div>

      {products.error && (
        <div role="alert" className="mb-5 rounded-xl border border-l-4 border-danger bg-danger-bg p-4 text-danger">
          <p>
            <span aria-hidden="true">⚠ </span>
            {s.menu.loadError}
          </p>
          <button type="button" onClick={products.reload} className="btn btn-secondary mt-3">
            {s.menu.retry}
          </button>
        </div>
      )}

      {products.data && products.data.items.length === 0 && (
        <div className="card mx-auto max-w-md px-6 py-10 text-center">
          <p className="text-lg">{s.menu.none}</p>
          <button type="button" className="btn btn-secondary mt-5" onClick={clearAll}>
            {s.menu.clear}
          </button>
        </div>
      )}
      {products.data && products.data.items.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-10 min-[480px]:grid-cols-2 lg:grid-cols-3" aria-busy={products.loading}>
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
