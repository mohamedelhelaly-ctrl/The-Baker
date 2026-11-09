import { Link } from "react-router";
import { useMoney } from "../../lib/store";
import type { ProductListItem } from "../../lib/types";

export function ProductCard({ product, headingLevel = 3 }: { product: ProductListItem; headingLevel?: 2 | 3 }) {
  const money = useMoney();
  const Heading = `h${headingLevel}` as const; // keeps heading order valid on each page
  return (
    <article className="group relative">
      <div className="lift overflow-hidden rounded-2xl border border-hairline bg-tint shadow-[var(--shadow-card)] group-hover:-translate-y-0.5">
        {product.image ? (
          <img
            src={product.image.url}
            alt={product.image.alt_text}
            loading="lazy"
            width={600}
            height={600}
            className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="aspect-square w-full bg-tint" aria-hidden="true" />
        )}
      </div>
      <div className="px-1 pt-3">
        <p className="eyebrow">{product.category.name}</p>
        <Heading className="mt-0.5 font-display text-xl font-bold leading-snug">
          {/* The link stretches over the whole card, so the card is one big click target. */}
          <Link to={`/products/${product.slug}`} className="link-bare after:absolute after:inset-0">
            {product.name}
          </Link>
        </Heading>
        <p className="mt-1 font-semibold">From {money(product.price_from)}</p>
      </div>
    </article>
  );
}
