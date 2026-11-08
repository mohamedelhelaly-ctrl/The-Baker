import { useState } from "react";
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
  // Lead time is per product, so the first size answers for all sizes.
  const first = product.variants[0]?.id;
  const delivery = useApi<DatesResponse>(`/availability/dates?fulfilment=delivery&days=60&items=${first}`);
  const pickup = useApi<DatesResponse>(`/availability/dates?fulfilment=pickup&days=60&items=${first}`);

  return (
    <article>
      <p className="mb-4">
        <Link to="/menu" className="underline">
          {s.product.back}
        </Link>
      </p>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          {current ? (
            <img src={current.url} alt={current.alt_text} width={900} height={900} className="aspect-square w-full rounded-lg border-2 border-line object-cover" />
          ) : (
            <div className="aspect-square w-full rounded-lg border-2 border-line bg-surface" aria-hidden="true" />
          )}
          {product.images.length > 1 && (
            <ul aria-label={s.product.photos} className="mt-3 flex flex-wrap gap-2">
              {product.images.map((img, i) => (
                <li key={img.id}>
                  <button
                    type="button"
                    aria-pressed={i === photo}
                    aria-label={`Photo ${i + 1} of ${product.images.length}: ${img.alt_text}`}
                    onClick={() => setPhoto(i)}
                    className={`size-16 overflow-hidden rounded-md border-2 ${i === photo ? "border-primary" : "border-line"}`}
                  >
                    <img src={img.url} alt="" className="size-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-muted">
            <Link to={`/menu?category=${product.category.slug}`} className="underline">
              {product.category.name}
            </Link>
          </p>
          <h1 className="font-display text-4xl font-bold">{product.name}</h1>
          {product.occasions.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Occasions">
              {product.occasions.map((o) => (
                <li key={o.id} className="rounded-full border-2 border-line px-3 py-0.5 text-sm">
                  {o.name}
                </li>
              ))}
            </ul>
          )}

          <fieldset className="mt-6">
            <legend className="mb-2 font-semibold">{s.product.size}</legend>
            {product.variants.map((v) => (
              <label key={v.id} className="mb-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border-2 border-line bg-surface px-3 has-[:checked]:border-primary has-[:checked]:bg-bg">
                <input type="radio" name="size" value={v.id} checked={v.id === variant?.id} onChange={() => setVariantId(v.id)} className="size-5" />
                <span className="flex-1">{v.name}</span>
                <span className="font-semibold">{money(v.price)}</span>
              </label>
            ))}
          </fieldset>

          <p className="mt-4 text-2xl font-bold" aria-live="polite">
            <span className="sr-only">{s.product.price}: </span>
            {variant && money(variant.price)}
          </p>
          <p className="mt-1 text-muted">{leadTimeText(product.lead_time_hours)}</p>
          {(delivery.data || pickup.data) && (
            <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1" aria-label="Earliest dates">
              <dt className="font-semibold">Earliest delivery</dt>
              <dd>{delivery.data?.earliest_date ? formatDate(delivery.data.earliest_date) : "No dates available soon"}</dd>
              <dt className="font-semibold">Earliest pickup</dt>
              <dd>{pickup.data?.earliest_date ? formatDate(pickup.data.earliest_date) : "No dates available soon"}</dd>
            </dl>
          )}
          <form
            className="mt-6 rounded-lg border-2 border-line bg-surface p-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!variant) return;
              const qty = Math.min(100, Math.max(1, Math.floor(Number(quantity)) || 1));
              cart.add(variant.id, qty, inscription);
              setQuantity("1");
              setAdded(`Added ${qty} × ${product.name} (${variant.name}) to your cart.`);
            }}
          >
            <TextField label="Message on the cake (optional)" hint="For example “Happy Birthday Sara”. Up to 80 characters." maxLength={80} value={inscription} onChange={(e) => setInscription(e.target.value)} />
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-28">
                <TextField label="Quantity" type="number" min={1} max={100} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <Button type="submit" className="mb-5">
                Add to cart
              </Button>
            </div>
            <div aria-live="polite">
              {added && (
                <p className="font-semibold text-success">
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

      <section className="mt-10 grid gap-8 md:grid-cols-2">
        {product.description && (
          <div>
            <h2 className="mb-2 font-display text-2xl font-bold">{s.product.about}</h2>
            <p className="max-w-prose">{product.description}</p>
          </div>
        )}
        {product.ingredients && (
          <div>
            <h2 className="mb-2 font-display text-2xl font-bold">{s.product.ingredients}</h2>
            <p className="max-w-prose">{product.ingredients}</p>
          </div>
        )}
      </section>
    </article>
  );
}
