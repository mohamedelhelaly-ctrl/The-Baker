import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { SelectField } from "../../components/ui/Field";
import { Pagination } from "../../components/ui/Pagination";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useDebounce } from "../../hooks/useDebounce";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { useMoney } from "../../lib/store";
import type { AdminCategory, AdminProductListItem, Page } from "../../lib/types";
import { StatusBadge } from "./StatusBadge";

export default function AdminProductsPage() {
  usePageTitle("Products");
  const money = useMoney();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("active");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const q = useDebounce(search, 300);

  const query = new URLSearchParams({ page: String(page), page_size: "20" });
  if (q) query.set("q", q);
  if (category) query.set("category_id", category);
  if (state !== "all") query.set("archived", String(state === "archived"));
  const products = useApi<Page<AdminProductListItem>>(`/admin/products?${query}`);
  const categories = useApi<AdminCategory[]>("/admin/categories");

  async function toggleArchive(p: AdminProductListItem) {
    try {
      await api.post(`/admin/products/${p.id}/${p.is_archived ? "restore" : "archive"}`);
      setMessage({ kind: "success", text: `${p.name} was ${p.is_archived ? "restored" : "archived"}.` });
      products.reload();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Products</h1>
        <Link to="/admin/products/new" className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-semibold text-primary-ink">
          New product
        </Link>
      </div>

      <search aria-label="Filter products"><form onSubmit={(e) => e.preventDefault()} className="mb-4 grid gap-x-4 sm:grid-cols-3">
        <TextField label="Search products" type="search" value={search} autoComplete="off" onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <SelectField label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Show" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </SelectField>
      </form>
      </search>

      <div aria-live="polite">{message && <Alert kind={message.kind}>{message.text}</Alert>}</div>
      {products.error && <Alert kind="error">{products.error.message}</Alert>}

      {products.data && (
        <>
          <p className="mb-2" aria-live="polite">
            {products.data.total} {products.data.total === 1 ? "product" : "products"}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">Products</caption>
              <thead>
                <tr className="border-b-2 border-line text-start">
                  <th scope="col" className="p-2 text-start">Photo</th>
                  <th scope="col" className="p-2 text-start">Name</th>
                  <th scope="col" className="p-2 text-start">Category</th>
                  <th scope="col" className="p-2 text-start">From</th>
                  <th scope="col" className="p-2 text-start">Status</th>
                  <th scope="col" className="p-2 text-start">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((p) => (
                  <tr key={p.id} className="border-b border-line">
                    <td className="p-2">
                      {p.image ? <img src={p.image.url} alt={p.image.alt_text} className="size-14 rounded-md object-cover" /> : <span className="text-muted">No photo</span>}
                    </td>
                    <th scope="row" className="p-2 text-start">
                      <Link to={`/admin/products/${p.id}`} className="underline">
                        {p.name}
                      </Link>
                    </th>
                    <td className="p-2">{p.category_name}</td>
                    <td className="p-2">{p.price_from === null ? "No active size" : money(p.price_from)}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {p.is_archived ? <StatusBadge kind="off">Archived</StatusBadge> : p.is_available ? <StatusBadge kind="ok">On the menu</StatusBadge> : <StatusBadge kind="warn">Hidden</StatusBadge>}
                        {p.is_featured && <StatusBadge kind="ok">Featured</StatusBadge>}
                      </div>
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => toggleArchive(p)} className="min-h-11 rounded-md border-2 border-line px-3 font-semibold">
                        {p.is_archived ? "Restore" : "Archive"}
                        {" "}<span className="sr-only">{p.name}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {products.data.items.length === 0 && <p className="py-6">No products match these filters.</p>}
          <Pagination page={page} totalPages={products.data.total_pages} onChange={setPage} />
        </>
      )}
    </>
  );
}
