import { useState } from "react";
import { takesInscription } from "../../lib/cake";
import { Link, useParams } from "react-router";
import { useApi } from "../../hooks/useApi";
import { useCart } from "../../lib/cart";
import { formatDate } from "../../lib/dates";
import { usePageTitle } from "../../hooks/usePageTitle";
import { leadTimeText } from "../../lib/money";
import { s } from "../../lib/strings";
import { useMoney } from "../../lib/store";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import type { DatesResponse, ProductDetail } from "../../lib/types";

export default function ProductPage() {
  const { slug = "" } = useParams();
  const { data: product, error, loading } = useApi<ProductDetail>(`/products/${encodeURIComponent(slug)}`);
  usePageTitle(product?.name ?? "Product");

  if (loading && !product) return <output>{s.loading}</output>;
  if (error || !product) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">{error?.status === 404 ? s.product.notFound : s.menu.loadError}</h1>
        <p className="mt-4">
          <Link to="/menu" className="underline">
            {s.product.back}
          </Link>
        </p>
      </section>
    );
  }
  return <ProductView product={product} />;
}

function ProductView({ product }: { product: ProductDetail }) {
  const money = useMoney();
  const cart = useCart();
  const [quantity, setQuantity] = useState("1");
  const [inscription, setInscription] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const [photo, setPhoto] = useState(0);
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  const current = product.images[photo];
  const isCake = takesInscription(product.name, product.category.name);
  // Lead time is per product, so the first size answers for all sizes.
  const first = product.variants[0]?.id;
  const delivery = useApi<DatesResponse>(`/availability/dates?fulfilment=delivery&days=60&items=${first}`);
  const pickup = useApi<DatesResponse>(`/availability/dates?fulfilment=pickup&days=60&items=${first}`);

  return (
    <article>
      <p className="mb-6">
        <Link to="/menu" className="link inline-flex min-h-11 items-center gap-1.5">
          <span aria-hidden="true">←</span>
          {s.product.back}
        </Link>
      </p>
      <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          {current ? (
            <img src={current.url} alt={current.alt_text} width={900} height={900} className="aspect-square w-full rounded-3xl border border-hairline object-cover shadow-[var(--shadow-card)]" />
          ) : (
            <div className="aspect-square w-full rounded-3xl bg-tint" aria-hidden="true" />
          )}
          {product.images.length > 1 && (
            <ul aria-label={s.product.photos} className="mt-4 flex flex-wrap gap-3">
              {product.images.map((img, i) => (
                <li key={img.id}>
                  <button
                    type="button"
                    aria-pressed={i === photo}
                    aria-label={`Photo ${i + 1} of ${product.images.length}: ${img.alt_text}`}
                    onClick={() => setPhoto(i)}
                    className={`size-16 overflow-hidden rounded-xl border-2 transition ${i === photo ? "border-primary" : "border-hairline hover:border-line"}`}
                  >
                    <img src={img.url} alt="" className="size-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="eyebrow">
            <Link to={`/menu?category=${product.category.slug}`} className="hover:underline">
              {product.category.name}
            </Link>
          </p>
          <h1 className="mt-1 font-display text-4xl font-bold leading-tight">{product.name}</h1>
          {product.occasions.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Occasions">
              {product.occasions.map((o) => (
                <li key={o.id} className="pill">
                  {o.name}
                </li>
              ))}
            </ul>
          )}

          <fieldset className="mt-7">
            <legend className="mb-2 font-semibold">{s.product.size}</legend>
            <div className="grid gap-2">
              {product.variants.map((v) => (
                <label key={v.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 transition hover:border-ink has-[:checked]:border-primary has-[:checked]:bg-tint has-[:checked]:shadow-[inset_0_0_0_1px_var(--primary)] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]">
                  <input type="radio" name="size" value={v.id} checked={v.id === variant?.id} onChange={() => setVariantId(v.id)} className="size-5 accent-[var(--primary)]" />
                  <span className="flex-1">{v.name}</span>
                  <span className="font-semibold">{money(v.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="mt-6 font-display text-3xl font-bold" aria-live="polite">
            <span className="sr-only">{s.product.price}: </span>
            {variant && money(variant.price)}
          </p>
          <div className="mt-3 rounded-xl bg-tint px-4 py-3 text-sm">
            <p className="font-semibold">{leadTimeText(product.lead_time_hours)}</p>
            {(delivery.data || pickup.data) && (
              <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-y-0.5 text-muted" aria-label="Earliest dates">
                <dt>Earliest delivery</dt>
                <dd className="text-ink">{delivery.data?.earliest_date ? formatDate(delivery.data.earliest_date) : "No dates available soon"}</dd>
                <dt>Earliest pickup</dt>
                <dd className="text-ink">{pickup.data?.earliest_date ? formatDate(pickup.data.earliest_date) : "No dates available soon"}</dd>
              </dl>
            )}
          </div>

          <form
            className="mt-6"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!variant) return;
              const qty = Math.min(100, Math.max(1, Math.floor(Number(quantity)) || 1));
              cart.add(variant.id, qty, isCake ? inscription : "");
              setQuantity("1");
              setAdded(`Added ${qty} × ${product.name} (${variant.name}) to your cart.`);
            }}
          >
            {isCake && (
              <TextField label="Message on the cake (optional)" hint="For example “Happy Birthday Sara”. Up to 80 characters." maxLength={80} value={inscription} onChange={(e) => setInscription(e.target.value)} />
            )}
            <div className="flex items-end gap-3">
              <div className="w-24 shrink-0">
                <TextField label="Quantity" type="number" min={1} max={100} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <Button type="submit" className="mb-5 flex-1">
                Add to cart
              </Button>
            </div>
            <div aria-live="polite">
              {added && (
                <p className="rounded-xl bg-success-bg px-4 py-3 font-semibold text-success">
                  <span aria-hidden="true">✓ </span>
                  {added}{" "}
                  <Link to="/cart" className="underline">
                    View cart
                  </Link>
                </p>
              )}
            </div>
          </form>
        </div>
      </div>

      {(product.description || product.ingredients) && (
        <section className="mt-14 grid gap-10 border-t border-hairline pt-10 md:grid-cols-2">
          {product.description && (
            <div>
              <h2 className="mb-2 font-display text-2xl font-bold">{s.product.about}</h2>
              <p className="max-w-prose text-lg">{product.description}</p>
            </div>
          )}
          {product.ingredients && (
            <div>
              <h2 className="mb-2 font-display text-2xl font-bold">{s.product.ingredients}</h2>
              <p className="max-w-prose text-muted">{product.ingredients}</p>
            </div>
          )}
        </section>
      )}
    </article>
  );
}
