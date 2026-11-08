import { Link } from "react-router";
import { useMoney } from "../../lib/store";
import type { ProductListItem } from "../../lib/types";

export function ProductCard({ product, headingLevel = 3 }: { product: ProductListItem; headingLevel?: 2 | 3 }) {
  const money = useMoney();
  const Heading = `h${headingLevel}` as const; // keeps heading order valid on each page
  return (
    <article className="relative overflow-hidden rounded-lg border-2 border-line bg-surface has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-[var(--focus)]">
      {product.image ? (
        <img
          src={product.image.url}
          alt={product.image.alt_text}
          loading="lazy"
          width={600}
          height={600}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="aspect-square w-full bg-bg" aria-hidden="true" />
      )}
      <div className="p-4">
        <p className="text-sm text-muted">{product.category.name}</p>
        <Heading className="font-display text-xl font-bold">
          {/* The link stretches over the whole card, so the card is one big click target. */}
          <Link to={`/products/${product.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {product.name}
          </Link>
        </Heading>
        <p className="mt-1 font-semibold">From {money(product.price_from)}</p>
      </div>
    </article>
  );
}
