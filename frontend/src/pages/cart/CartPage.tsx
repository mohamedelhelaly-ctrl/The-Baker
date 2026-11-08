import { useState } from "react";
import { Link } from "react-router";
import { OrderSummary } from "../../components/checkout/OrderSummary";
import { Alert } from "../../components/ui/Alert";
import { QuantityField } from "../../components/cart/QuantityField";
import { TextField } from "../../components/ui/TextField";
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
      <section>
        <h1 className="font-display text-3xl font-bold">Your cart</h1>
        <p className="mt-4 text-lg">Your cart is empty.</p>
        <p className="mt-4">
          <Link to="/menu" className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-semibold text-primary-ink">
            Browse the menu
          </Link>
        </p>
      </section>
    );
  }

  const unavailable = quote?.lines.some((l) => !l.available) ?? false;

  return (
    <>
      <h1 className="mb-6 font-display text-3xl font-bold">Your cart</h1>
      <div aria-live="polite" className="sr-only">
        {notice}
      </div>
      {error && <Alert kind="error">We could not check your cart prices. Check your connection and try again.</Alert>}
      {unavailable && (
        <Alert kind="error" title="Some items are no longer available">
          Remove them to continue.
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <ul className="grid gap-4">
          {cart.lines.map((line) => {
            const key = lineKey(line);
            const q = quote?.lines.find((l) => l.variant_id === line.variantId && (l.inscription ?? "") === line.inscription);
            const name = q ? `${q.product_name}${q.variant_name ? ` (${q.variant_name})` : ""}` : "this item";
            return (
              <li key={key} className="grid gap-4 rounded-lg border-2 border-line bg-surface p-4 sm:grid-cols-[6rem_1fr]">
                {q?.image ? <img src={q.image.url} alt={q.image.alt_text} className="size-24 rounded-md object-cover" /> : <div className="size-24 rounded-md bg-bg" aria-hidden="true" />}
                <div>
                  <h2 className="font-display text-xl font-bold">
                    {q?.slug ? (
                      <Link to={`/products/${q.slug}`} className="underline">
                        {q.product_name}
                      </Link>
                    ) : (
                      (q?.product_name ?? "Loading…")
                    )}
                  </h2>
                  {q?.variant_name && <p className="text-muted">{q.variant_name}</p>}
                  {q && !q.available && (
                    <p className="mt-1 font-semibold text-danger">
                      <span aria-hidden="true">⚠ </span>
                      {q.message}
                    </p>
                  )}
                  <p className="mt-1 font-semibold">{q?.available ? `${money(q.unit_price)} each · ${money(q.line_total)}` : ""}</p>
                  <div className="mt-3 grid gap-x-3 sm:grid-cols-[8rem_1fr]">
                    <QuantityField
                      label={`Quantity for ${name}`}
                      value={line.quantity}
                      onCommit={(n) => {
                        cart.setQuantity(key, n);
                        setNotice(`Quantity for ${name} is now ${n}.`);
                      }}
                    />
                    <TextField
                      label={`Message on the cake for ${name}`}
                      maxLength={80}
                      value={line.inscription}
                      onChange={(e) => cart.setInscription(key, e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="min-h-11 rounded-md border-2 border-line px-4 font-semibold"
                    onClick={() => {
                      cart.remove(key);
                      setNotice(`${name} was removed from your cart.`);
                    }}
                  >
                    Remove{" "}
                    <span className="sr-only">{name} from your cart</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <aside aria-label="Cart total" className="grid content-start gap-4">
          <OrderSummary quote={quote} loading={loading} deliveryChosen={false} />
          <p className="text-muted">Delivery fee and your time slot are chosen at checkout.</p>
          {unavailable || !quote || cart.lines.length === 0 ? (
            <button type="button" disabled className="min-h-11 rounded-md bg-primary px-5 font-semibold text-primary-ink opacity-60">
              Continue to checkout
            </button>
          ) : (
            <Link to="/checkout" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 font-semibold text-primary-ink hover:bg-primary-hover">
              Continue to checkout
            </Link>
          )}
          <Link to="/menu" className="underline">
            Keep shopping
          </Link>
        </aside>
      </div>
    </>
  );
}
