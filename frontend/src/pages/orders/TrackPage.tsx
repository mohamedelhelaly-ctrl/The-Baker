import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDate, formatDateTime, formatSlotRange } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { STATUS_LABEL, progress } from "../../lib/orders";
import type { Order } from "../../lib/types";

export default function TrackPage() {
  const { code = "" } = useParams();
  const token = useSearchParams()[0].get("t");
  const justPlaced = Boolean((useLocation().state as { justPlaced?: boolean } | null)?.justPlaced);
  const path = `/orders/${encodeURIComponent(code)}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  const { data: order, error, loading } = useApi<Order>(path);
  usePageTitle(order ? `Order ${order.code}` : "Your order");

  if (loading && !order) return <output>Loading…</output>;
  if (error || !order) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">We could not find that order</h1>
        <p className="mt-4 max-w-prose">
          {error?.status === 404
            ? "Check the link from your order confirmation. If you are signed in, make sure you are using the account you ordered with."
            : "Something went wrong while loading your order. Please try again."}
        </p>
        <p className="mt-4">
          <Link to="/menu" className="underline">
            Back to the menu
          </Link>
        </p>
      </section>
    );
  }
  return <OrderView order={order} justPlaced={justPlaced} />;
}

function OrderView({ order, justPlaced }: { order: Order; justPlaced: boolean }) {
  const money = (n: number) => formatMoney(n, order.currency);
  const steps = progress(order.fulfilment_type);
  const off = order.status === "rejected" || order.status === "cancelled";
  const reached = steps.indexOf(order.status);
  const reason = order.status === "rejected" ? order.rejection_reason : order.cancellation_reason;

  return (
    <article>
      {justPlaced && (
        <Alert kind="success" title="Thank you, your order has been received">
          Keep this page: its link is how you check on your order.
        </Alert>
      )}
      <h1 className="font-display text-3xl font-bold">Order {order.code}</h1>
      <p className="mt-1 text-muted">Placed {formatDateTime(order.placed_at)}</p>

      <section aria-labelledby="status-h" className="mt-6">
        <h2 id="status-h" className="sr-only">
          Order status
        </h2>
        {off ? (
          <Alert kind="error" title={`This order was ${order.status === "rejected" ? "declined" : "cancelled"}`}>
            {reason ?? "Please contact us if you have questions."}
          </Alert>
        ) : (
          <>
            <p className="mb-3 text-xl font-bold">
              <span className="sr-only">Current status: </span>
              {STATUS_LABEL[order.status]}
            </p>
            {order.is_delayed && (
              <Alert kind="error" title="This order is running late">
                {order.delay_note ?? "We will be in touch with a new time."}
              </Alert>
            )}
            <ol aria-label="Order progress" className="grid gap-2 sm:grid-cols-3">
              {steps.map((s, i) => {
                const state = i < reached ? "done" : i === reached ? "current" : "todo";
                return (
                  <li
                    key={s}
                    aria-current={state === "current" ? "step" : undefined}
                    className={`rounded-md border-2 px-3 py-2 font-semibold ${state === "current" ? "border-primary bg-primary text-primary-ink" : state === "done" ? "border-success text-success" : "border-line text-muted"}`}
                  >
                    <span aria-hidden="true">{state === "done" ? "✓ " : state === "current" ? "● " : "○ "}</span>
                    {STATUS_LABEL[s]}
                    <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current)" : " (not yet)"}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <section aria-labelledby="when-h">
          <h2 id="when-h" className="mb-2 font-display text-2xl font-bold">
            {order.fulfilment_type === "delivery" ? "Delivery" : "Pickup"}
          </h2>
          <p className="font-semibold">
            {formatDate(order.fulfilment_date)}, {formatSlotRange(order.slot_starts_at, order.slot_ends_at)}
          </p>
          {order.fulfilment_type === "delivery" && order.delivery_address ? (
            <p className="mt-1">
              {order.delivery_address.street}, building {order.delivery_address.building}
              {order.delivery_address.floor && `, floor ${order.delivery_address.floor}`}
              {order.delivery_address.apartment && `, apartment ${order.delivery_address.apartment}`}
              {order.zone_name && <span className="block text-muted">{order.zone_name}</span>}
              {order.delivery_address.landmark && <span className="block text-muted">{order.delivery_address.landmark}</span>}
            </p>
          ) : (
            <p className="mt-1">Collect your order from the bakery.</p>
          )}
          <p className="mt-3">
            {order.contact_name}
            <span className="block text-muted">{order.contact_phone}</span>
          </p>
          {order.customer_notes && <p className="mt-3">Your note: {order.customer_notes}</p>}
        </section>

        <section aria-labelledby="items-h">
          <h2 id="items-h" className="mb-2 font-display text-2xl font-bold">
            Your order
          </h2>
          <ul className="grid gap-2">
            {order.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3">
                <span>
                  {i.quantity} × {i.product_name} <span className="text-muted">({i.variant_name})</span>
                  {i.inscription && <span className="block text-muted">Message: “{i.inscription}”</span>}
                </span>
                <span className="shrink-0">{money(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t-2 border-line pt-3">
            <dt>Subtotal</dt>
            <dd>{money(order.subtotal)}</dd>
            <dt>Delivery</dt>
            <dd>{order.fulfilment_type === "pickup" ? "Not needed" : order.delivery_fee === 0 ? "Free" : money(order.delivery_fee)}</dd>
            <dt className="text-lg font-bold">Total</dt>
            <dd className="text-lg font-bold">{money(order.total)}</dd>
          </dl>
          <p className="mt-3 text-muted">
            {order.payment_method === "cod" ? "Payment: cash on delivery or pickup" : "Payment: card"}
            {order.payment_status === "paid" ? " (paid)" : ""}
          </p>
        </section>
      </div>
    </article>
  );
}
