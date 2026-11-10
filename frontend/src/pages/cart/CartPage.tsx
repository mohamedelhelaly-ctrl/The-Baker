import { useState } from "react";
import { Link } from "react-router";
import { OrderSummary } from "../../components/checkout/OrderSummary";
import { Alert } from "../../components/ui/Alert";
import { buttonClass } from "../../components/ui/buttonClass";
import { QuantityField } from "../../components/cart/QuantityField";
import { useQuote } from "../../hooks/useQuote";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useCart } from "../../lib/cart";
import { lineKey } from "../../lib/cartKeys";
import { useMoney } from "../../lib/store";

export default function CartPage() {
  usePageTitle("Your cart");
  const cart = useCart();
  const money = useMoney();
  const { quote, error, loading } = useQuote(cart.lines);
  const [notice, setNotice] = useState("");

  if (cart.lines.length === 0) {
    return (
      <section className="mx-auto max-w-md py-10 text-center">
        <h1 className="font-display text-4xl font-bold">Your cart</h1>
        <p className="mt-4 text-lg text-muted">Your cart is empty.</p>
        <p className="mt-8">
          <Link to="/menu" className={buttonClass("primary", "px-8")}>
            Browse the menu
          </Link>
        </p>
      </section>
    );
  }

  const unavailable = quote?.lines.some((l) => !l.available) ?? false;

  return (
    <>
      <h1 className="mb-8 font-display text-4xl font-bold">Your cart</h1>
      <div aria-live="polite" className="sr-only">
        {notice}
      </div>
      {error && <Alert kind="error">We could not check your cart prices. Check your connection and try again.</Alert>}
      {unavailable && (
        <Alert kind="error" title="Some items are no longer available">
          Remove them to continue.
        </Alert>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <ul className="card divide-y divide-hairline px-5">
          {cart.lines.map((line) => {
            const key = lineKey(line);
            const q =
              quote?.lines.find((l) => l.variant_id === line.variantId && (l.inscription ?? "") === line.inscription) ??
              quote?.lines.find((l) => l.variant_id === line.variantId && !l.inscription); // a saved message on a non-cake is dropped by the server
            const name = q ? `${q.product_name}${q.variant_name ? ` (${q.variant_name})` : ""}` : "this item";
            return (
              <li key={key} className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-2 py-5 sm:grid-cols-[6rem_1fr_auto]">
                {q?.image ? <img src={q.image.url} alt={q.image.alt_text} className="size-20 rounded-xl object-cover sm:size-24" /> : <div className="size-20 rounded-xl bg-tint sm:size-24" aria-hidden="true" />}
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-bold leading-snug">
                    {q?.slug ? (
                      <Link to={`/products/${q.slug}`} className="hover:underline">
                        {q.product_name}
                      </Link>
                    ) : (
                      (q?.product_name ?? "Loading…")
                    )}
                  </h2>
                  {q?.variant_name && <p className="text-muted">{q.variant_name}</p>}
                  {q?.inscription && (
                    <p className="mt-1 text-sm">
                      <span className="font-semibold">Message on the cake:</span> “{q.inscription}”
                    </p>
                  )}
                  {q && !q.available && (
                    <p className="mt-1 font-semibold text-danger">
                      <span aria-hidden="true">⚠ </span>
                      {q.message}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <span aria-hidden="true" className="text-sm text-muted">
                      Qty
                    </span>
                    <div className="w-20 [&>div]:mb-0">
                      <QuantityField
                        label={`Quantity for ${name}`}
                        hideLabel
                        value={line.quantity}
                        onCommit={(n) => {
                          cart.setQuantity(key, n);
                          setNotice(`Quantity for ${name} is now ${n}.`);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => {
                        cart.remove(key);
                        setNotice(`${name} was removed from your cart.`);
                      }}
                    >
                      Remove{" "}
                      <span className="sr-only">{name} from your cart</span>
                    </button>
                  </div>
                </div>
                <p className="col-start-2 font-semibold sm:col-start-auto sm:text-end">{q?.available ? money(q.line_total) : ""}</p>
              </li>
            );
          })}
        </ul>

        <aside aria-label="Cart total" className="grid content-start gap-4 lg:sticky lg:top-24">
          <OrderSummary quote={quote} loading={loading} deliveryChosen={false} />
          <p className="text-sm text-muted">Delivery fee and your time slot are chosen at checkout.</p>
          {unavailable || !quote || cart.lines.length === 0 ? (
            <button type="button" disabled className={buttonClass("primary", "w-full")}>
              Continue to checkout
            </button>
          ) : (
            <Link to="/checkout" className={buttonClass("primary", "w-full")}>
              Continue to checkout
            </Link>
          )}
          <Link to="/menu" className="link text-center">
            Keep shopping
          </Link>
        </aside>
      </div>
    </>
  );
}
