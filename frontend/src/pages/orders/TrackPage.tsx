import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { ChangeOrCancel } from "../../components/orders/ChangeOrCancel";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { useStore } from "../../lib/store";
import { useApi } from "../../hooks/useApi";
import { api, ApiError } from "../../lib/api";
import { redirectTo } from "../../lib/navigation";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDate, formatDateTime, formatSlotRange } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { STATUS_LABEL, progress } from "../../lib/orders";
import type { Order } from "../../lib/types";

export default function TrackPage() {
  const { code = "" } = useParams();
  const query = useSearchParams()[0];
  const token = query.get("t");
  // The payment page sends the customer back here. Paymob adds `success=true|false`. This only chooses
  // which message to show: the order itself is only ever confirmed by the provider's signed callback.
  const paymobSuccess = query.get("success");
  const returnedPaid = query.get("paid") === "1" && paymobSuccess !== "false";
  const returnedCancelled = query.get("cancelled") === "1" || paymobSuccess === "false";
  const locationState = useLocation().state as { justPlaced?: boolean; changed?: boolean } | null;
  const justPlaced = Boolean(locationState?.justPlaced);
  const justChanged = Boolean(locationState?.changed);
  const path = `/orders/${encodeURIComponent(code)}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  const { data, error, loading, reload } = useApi<Order>(path);
  const [cancelled, setCancelled] = useState<Order | null>(null); // the order as returned by cancelling it
  const order = cancelled ?? data;
  usePageTitle(order ? `Order ${order.code}` : "Your order");

  // After paying, the provider tells us by webhook, which can take a moment: keep checking. Once the
  // order is confirmed, look again now and then so the progress stays current without a reload.
  const waiting = order?.status === "pending_payment";
  const finished = order ? ["delivered", "picked_up", "rejected", "cancelled"].includes(order.status) : true;
  useEffect(() => {
    if (finished) return;
    const id = setInterval(reload, waiting ? 3000 : 30_000);
    return () => clearInterval(id);
  }, [waiting, finished, reload]);

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
  return (
    <OrderView order={order} justPlaced={justPlaced} justChanged={justChanged} returnedPaid={returnedPaid} returnedCancelled={returnedCancelled} token={token} onCancelled={setCancelled} />
  );
}

function OrderView({ order, justPlaced, justChanged, returnedPaid, returnedCancelled, token, onCancelled }: {
  order: Order;
  justPlaced: boolean;
  justChanged: boolean;
  onCancelled: (o: Order) => void;
  returnedPaid: boolean;
  returnedCancelled: boolean;
  token: string | null;
}) {
  const { pickup_location, pickup_instructions } = useStore();
  const [payError, setPayError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const awaiting = order.status === "pending_payment";

  async function payNow() {
    setOpening(true);
    setPayError(null);
    try {
      const res = await api.post<{ payment_url: string }>(`/orders/${encodeURIComponent(order.code)}/payment-link${token ? `?t=${encodeURIComponent(token)}` : ""}`);
      redirectTo(res.payment_url);
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Something went wrong.");
      setOpening(false);
    }
  }

  const money = (n: number) => formatMoney(n, order.currency);
  const steps = progress(order.fulfilment_type);
  const off = order.status === "rejected" || order.status === "cancelled";
  const reached = steps.indexOf(order.status);
  const reason = order.status === "rejected" ? order.rejection_reason : order.cancellation_reason;

  return (
    <article>
      {awaiting && (
        <section aria-labelledby="pay-h" className="mb-6">
          <Alert kind="error" title={returnedPaid ? "Confirming your payment…" : returnedCancelled ? "Your payment was not completed" : "This order is waiting for payment"}>
            <span id="pay-h">
              {returnedPaid
                ? "We are waiting for the payment provider to confirm. This page updates by itself, there is no need to pay again."
                : "Your order is held for a short time. Pay by card to confirm it, or it will be cancelled automatically."}
            </span>
          </Alert>
          {payError && <Alert kind="error">{payError}</Alert>}
          {!returnedPaid && (
            <Button type="button" disabled={opening} onClick={payNow}>
              {opening ? "Opening the payment page…" : "Pay by card"}
            </Button>
          )}
        </section>
      )}
      {returnedPaid && !awaiting && order.payment_status === "paid" && (
        <Alert kind="success" title="Payment received, thank you">
          Your order is confirmed. Keep this page: its link is how you check on your order.
        </Alert>
      )}
      {justPlaced && (
        <Alert kind="success" title="Thank you, your order has been received">
          Keep this page: its link is how you check on your order.
        </Alert>
      )}
      {justChanged && (
        <Alert kind="success" title="Your order was updated">
          We emailed you the new details.
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
            <p className="mt-1">
              {pickup_location ? `Collect your order from: ${pickup_location}` : "Collect your order from the bakery."}
              {pickup_instructions && <span className="block text-muted">{pickup_instructions}</span>}
            </p>
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
            {order.payment_status === "paid" ? " (paid)" : order.payment_status === "refunded" ? " (refunded)" : order.payment_status === "partially_refunded" ? " (partly refunded)" : ""}
          </p>
        </section>
      </div>
      <ChangeOrCancel order={order} token={token} onCancelled={onCancelled} />
    </article>
  );
}
