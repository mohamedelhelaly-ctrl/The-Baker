import { Link } from "react-router";
import { ProductCard } from "../../components/catalog/ProductCard";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { s } from "../../lib/strings";
import type { Category, Occasion, Page, ProductListItem } from "../../lib/types";

export default function HomePage() {
  usePageTitle("Fresh cakes and bakes");
  const categories = useApi<Category[]>("/categories");
  const occasions = useApi<Occasion[]>("/occasions");
  const featured = useApi<Page<ProductListItem>>("/products?sort=featured&page_size=4");
  const chip = "inline-flex min-h-11 items-center rounded-full border-2 border-line bg-surface px-4 font-semibold hover:bg-primary hover:text-primary-ink";

  return (
    <>
      <section className="mb-12">
        <h1 className="font-display text-4xl font-bold">Fresh from our oven to your table</h1>
        <p className="mt-4 max-w-prose text-lg text-muted">
          Cakes, pastries and breads, baked to order in Cairo for birthdays, weddings, Eid and every day in between.
        </p>
        <p className="mt-6">
          <Link to="/menu" className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 py-2 font-semibold text-primary-ink hover:bg-primary-hover">
            {s.menu.title}
          </Link>
        </p>
      </section>

      {categories.data && categories.data.length > 0 && (
        <section aria-labelledby="by-category" className="mb-10">
          <h2 id="by-category" className="mb-3 font-display text-2xl font-bold">
            Shop by category
          </h2>
          <ul className="flex flex-wrap gap-3">
            {categories.data.map((c) => (
              <li key={c.id}>
                <Link to={`/menu?category=${c.slug}`} className={chip}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {occasions.data && occasions.data.length > 0 && (
        <section aria-labelledby="by-occasion" className="mb-10">
          <h2 id="by-occasion" className="mb-3 font-display text-2xl font-bold">
            Shop by occasion
          </h2>
          <ul className="flex flex-wrap gap-3">
            {occasions.data.map((o) => (
              <li key={o.id}>
                <Link to={`/menu?occasion=${o.slug}`} className={chip}>
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featured.data && featured.data.items.length > 0 && (
        <section aria-labelledby="featured">
          <h2 id="featured" className="mb-4 font-display text-2xl font-bold">
            Our favourites
          </h2>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featured.data.items.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
