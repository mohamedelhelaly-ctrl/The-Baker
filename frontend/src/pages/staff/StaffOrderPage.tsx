import { useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextAreaField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatDateTime, formatSlotRange } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { ACTION_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "../../lib/orders";
import type { OrderStatus, StaffOrder } from "../../lib/types";
import { StatusBadge } from "../admin/StatusBadge";

type Msg = { kind: "success" | "error"; text: string } | null;
const errText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");
const btn = "min-h-11 rounded-md border-2 border-line px-4 font-semibold disabled:opacity-60";

export default function StaffOrderPage() {
  const { id = "" } = useParams();
  return <OrderDetail key={id} id={id} />;
}

function OrderDetail({ id }: { id: string }) {
  const { data, error, loading } = useApi<StaffOrder>(`/staff/orders/${encodeURIComponent(id)}`);
  const [fresh, setFresh] = useState<StaffOrder | null>(null);
  const order = fresh ?? data;
  usePageTitle(order ? `Order ${order.code}` : "Order");

  if (loading && !order) return <output>Loading…</output>;
  if (error || !order) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">We could not find that order</h1>
        <p className="mt-4">
          <Link to="/staff/orders" className="underline">
            Back to the order queue
          </Link>
        </p>
      </section>
    );
  }
  return <OrderView order={order} onChange={setFresh} />;
}

function OrderView({ order, onChange }: { order: StaffOrder; onChange: (o: StaffOrder) => void }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false); // a second click while a request is in flight must do nothing
  const [closing, setClosing] = useState<OrderStatus | null>(null);
  const base = `/staff/orders/${order.id}`;

  /** Run one action, show the outcome, and swap in the order the server returned. */
  async function run(call: () => Promise<StaffOrder>, done: string): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setMsg(null);
    try {
      onChange(await call());
      setMsg({ kind: "success", text: done });
      return true;
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const simple = order.actions.filter((a) => !a.needs_reason);
  const withReason = order.actions.filter((a) => a.needs_reason);
  const address = order.delivery_address;
  const finished = order.actions.length === 0;

  return (
    <>
      <p className="mb-2">
        <Link to="/staff/orders" className="underline">
          ← Back to the order queue
        </Link>
      </p>
      <h1 className="mb-2 font-display text-3xl font-bold">Order {order.code}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge kind={order.status === "rejected" || order.status === "cancelled" ? "off" : order.status === "received" ? "warn" : "ok"}>
          {STATUS_LABEL[order.status]}
        </StatusBadge>
        {order.is_delayed && <StatusBadge kind="warn">Late</StatusBadge>}
      </p>
      {order.is_delayed && order.delay_note && <p className="mb-4 font-semibold text-danger">Late: {order.delay_note}</p>}

      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>

      <section aria-labelledby="actions-h" className="mb-8">
        <h2 id="actions-h" className="mb-3 font-display text-xl font-bold">
          What next
        </h2>
        {finished && <p>This order is finished. There is nothing more to do.</p>}
        <div className="flex flex-wrap gap-2">
          {simple.map((a, i) => (
            <button
              key={a.to}
              type="button"
              disabled={busy}
              className={i === 0 ? "min-h-11 rounded-md bg-primary px-5 py-2 font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-60" : btn}
              onClick={() => run(() => api.post<StaffOrder>(`${base}/transition`, { to: a.to }), `Order is now: ${STATUS_LABEL[a.to]}.`)}
            >
              {ACTION_LABEL[a.to] ?? STATUS_LABEL[a.to]}
            </button>
          ))}
          {withReason.map((a) => (
            <button key={a.to} type="button" disabled={busy} aria-expanded={closing === a.to} className={btn} onClick={() => setClosing(closing === a.to ? null : a.to)}>
              {ACTION_LABEL[a.to]}…
            </button>
          ))}
          {order.can_mark_paid && (
            <button type="button" disabled={busy} className={btn} onClick={() => run(() => api.post<StaffOrder>(`${base}/mark-paid`), "Cash payment recorded.")}>
              Cash collected
            </button>
          )}
        </div>
        {closing && (
          <CloseForm
            key={closing}
            status={closing}
            refund={order.payment_method === "card" && order.payment_status === "paid"}
            run={run}
            base={base}
            onDone={() => setClosing(null)}
          />
        )}
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="when-h">
          <h2 id="when-h" className="mb-2 font-display text-xl font-bold">
            {order.fulfilment_type === "delivery" ? "Delivery" : "Pickup"}
          </h2>
          <p>
            {formatDate(order.fulfilment_date)}
            <br />
            {formatSlotRange(order.slot_starts_at, order.slot_ends_at)}
          </p>
          {order.fulfilment_type === "delivery" && address && (
            <p className="mt-2">
              {address.street}, building {address.building}
              {address.floor ? `, floor ${address.floor}` : ""}
              {address.apartment ? `, apartment ${address.apartment}` : ""}
              {order.zone_name ? `, ${order.zone_name}` : ""}
              {address.landmark && <span className="block text-muted">Landmark: {address.landmark}</span>}
            </p>
          )}
          {order.customer_notes && (
            <p className="mt-2">
              <strong>Customer notes:</strong> {order.customer_notes}
            </p>
          )}
        </section>

        <section aria-labelledby="customer-h">
          <h2 id="customer-h" className="mb-2 font-display text-xl font-bold">
            Customer
          </h2>
          <p>
            {order.contact_name}
            <br />
            <a className="underline" href={`tel:${order.contact_phone.replace(/\s/g, "")}`}>
              {order.contact_phone}
            </a>
            <br />
            <a className="underline" href={`mailto:${order.contact_email}`}>
              {order.contact_email}
            </a>
          </p>
          <p className="mt-2">
            <strong>Payment:</strong> {order.payment_method === "cod" ? "Cash" : "Card"}, {PAYMENT_LABEL[order.payment_status] ?? order.payment_status}
          </p>
        </section>
      </div>

      <section aria-labelledby="items-h" className="mt-8">
        <h2 id="items-h" className="mb-2 font-display text-xl font-bold">
          Items
        </h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="py-2 text-start">Item</th>
              <th scope="col" className="py-2 text-end">Qty</th>
              <th scope="col" className="py-2 text-end">Price</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i, n) => (
              <tr key={n} className="border-b border-line align-top">
                <td className="py-2">
                  {i.product_name} <span className="text-muted">({i.variant_name})</span>
                  {i.inscription && (
                    <span className="block">
                      <strong>Write on the cake:</strong> “{i.inscription}”
                    </span>
                  )}
                </td>
                <td className="py-2 text-end">{i.quantity}</td>
                <td className="py-2 text-end">{formatMoney(i.line_total, order.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="py-1 text-end font-normal">Delivery fee</th>
              <td className="py-1 text-end">{formatMoney(order.delivery_fee, order.currency)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={2} className="py-1 text-end">Total</th>
              <td className="py-1 text-end font-bold">{formatMoney(order.total, order.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {order.can_delay || order.is_delayed ? <DelayForm order={order} run={run} base={base} busy={busy} /> : null}
      <MessageForm order={order} run={run} base={base} busy={busy} />

      <section aria-labelledby="history-h" className="mt-8">
        <h2 id="history-h" className="mb-2 font-display text-xl font-bold">
          History
        </h2>
        <ol className="space-y-2">
          {order.events.map((e, n) => (
            <li key={n}>
              <strong>{STATUS_LABEL[e.to_status]}</strong> <span className="text-muted">{formatDateTime(e.created_at)}</span>
              {e.reason && <span className="block">{e.reason}</span>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

type Run = (call: () => Promise<StaffOrder>, done: string) => Promise<boolean>;

function CloseForm({ status, refund, run, base, onDone }: { status: OrderStatus; refund: boolean; run: Run; base: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const rejecting = status === "rejected";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Tell the customer why.");
      return;
    }
    setError(undefined);
    const ok = await run(
      () => api.post<StaffOrder>(`${base}/${rejecting ? "reject" : "cancel"}`, { reason: reason.trim() }),
      rejecting ? "Order declined and the customer was told." : "Order cancelled and the customer was told.",
    );
    if (ok) onDone();
  }
  return (
    <form noValidate onSubmit={submit} className="mt-4 max-w-xl rounded-md border-2 border-line p-4">
      <TextAreaField
        label={rejecting ? "Why are you declining this order?" : "Why are you cancelling this order?"}
        hint={`The customer receives this reason by email.${refund ? " Their card payment is refunded automatically." : ""}`}
        value={reason}
        maxLength={300}
        rows={3}
        error={error}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit">{rejecting ? "Decline order" : "Cancel order"}</Button>
        <button type="button" className={btn} onClick={onDone}>
          Keep the order
        </button>
      </div>
    </form>
  );
}

function DelayForm({ order, run, base, busy }: { order: StaffOrder; run: Run; base: string; busy: boolean }) {
  const [note, setNote] = useState("");
  return (
    <section aria-labelledby="late-h" className="mt-8 max-w-xl">
      <h2 id="late-h" className="mb-2 font-display text-xl font-bold">
        Running late
      </h2>
      {order.can_delay && (
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            if (await run(() => api.post<StaffOrder>(`${base}/delay`, { note: note.trim() }), "The customer was told the order is running late.")) setNote("");
          }}
        >
          <TextField label="What should the customer know?" hint="For example: running about 30 minutes late. They receive this by email." value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" disabled={busy || !note.trim()}>
            {order.is_delayed ? "Update and tell the customer" : "Mark late and tell the customer"}
          </Button>
        </form>
      )}
      {order.is_delayed && (
        <button type="button" disabled={busy} className={`${btn} mt-3`} onClick={() => run(() => api.post<StaffOrder>(`${base}/clear-delay`), "The late flag was removed.")}>
          Remove the late flag
        </button>
      )}
    </section>
  );
}

function MessageForm({ order, run, base, busy }: { order: StaffOrder; run: Run; base: string; busy: boolean }) {
  const [body, setBody] = useState("");
  return (
    <section aria-labelledby="msg-h" className="mt-8 max-w-xl">
      <h2 id="msg-h" className="mb-2 font-display text-xl font-bold">
        Contact the customer
      </h2>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          if (await run(() => api.post<StaffOrder>(`${base}/messages`, { body: body.trim() }), `Message emailed to ${order.contact_email}.`)) setBody("");
        }}
      >
        <TextAreaField label="Message" hint={`Sent by email to ${order.contact_email}. You can also call ${order.contact_phone}.`} value={body} maxLength={1000} rows={3} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" disabled={busy || !body.trim()}>
          Send message
        </Button>
      </form>
      {order.messages.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 font-semibold">Sent messages</h3>
          <ul className="space-y-2">
            {order.messages.map((m, n) => (
              <li key={n} className="rounded-md border-2 border-line p-3">
                <span className="block text-sm text-muted">{formatDateTime(m.created_at)}</span>
                {m.body}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
