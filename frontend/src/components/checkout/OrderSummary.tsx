import { useMoney } from "../../lib/store";
import type { Quote } from "../../lib/types";

/** Running totals. Everything here comes from the server quote, never from the browser. */
export function OrderSummary({ quote, loading, deliveryChosen }: { quote: Quote | null; loading: boolean; deliveryChosen: boolean }) {
  const money = useMoney();
  if (!quote) return null;
  return (
    <section aria-labelledby="summary-h" className="card p-5">
      <h2 id="summary-h" className="mb-4 font-display text-xl font-bold">
        Order summary
      </h2>
      <ul className="mb-4 grid gap-3">
        {quote.lines.map((l) => (
          <li key={`${l.variant_id}-${l.inscription ?? ""}`} className="flex justify-between gap-3">
            <span>
              {l.quantity} × {l.product_name}
              {l.variant_name && <span className="text-muted"> ({l.variant_name})</span>}
              {!l.available && <span className="block text-danger">{l.message}</span>}
            </span>
            <span className="shrink-0">{l.available ? money(l.line_total) : "–"}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-hairline pt-4" aria-live="polite" aria-busy={loading}>
        <dt>Subtotal</dt>
        <dd>{money(quote.subtotal)}</dd>
        <dt>Delivery</dt>
        <dd>{deliveryChosen ? (quote.delivery_fee === 0 ? "Free" : money(quote.delivery_fee)) : "Chosen at checkout"}</dd>
        <dt className="text-lg font-bold">Total</dt>
        <dd className="text-lg font-bold">{money(quote.total)}</dd>
      </dl>
    </section>
  );
}
