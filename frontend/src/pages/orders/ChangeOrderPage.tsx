import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ScheduleStep, type FormState, type SetField } from "../../components/checkout/steps";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { SelectField, TextAreaField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatDateTime, formatSlotRange } from "../../lib/dates";
import { useMoney } from "../../lib/store";
import type { DeliveryZone, Order } from "../../lib/types";

/** Change the date, time, address or note of an order, while that is still allowed. The items stay as ordered. */
export default function ChangeOrderPage() {
  usePageTitle("Change your order");
  const { code = "" } = useParams();
  const token = useSearchParams()[0].get("t");
  const query = token ? `?t=${encodeURIComponent(token)}` : "";
  const { data: order, error, loading } = useApi<Order>(`/orders/${encodeURIComponent(code)}${query}`);

  if (loading && !order) return <output>Loading…</output>;
  if (error || !order) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">We could not find that order</h1>
        <p className="mt-4">
          <Link to="/menu" className="underline">
            Back to the menu
          </Link>
        </p>
      </section>
    );
  }
  const back = `/track/${encodeURIComponent(order.code)}${query}`;
  if (!order.can_change) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">Order {order.code}</h1>
        <p className="mt-4 max-w-prose">This order can no longer be changed online. Please contact the bakery.</p>
        <p className="mt-4">
          <Link to={back} className="underline">
            Back to your order
          </Link>
        </p>
      </section>
    );
  }
  return <ChangeForm order={order} query={query} back={back} />;
}

function ChangeForm({ order, query, back }: { order: Order; query: string; back: string }) {
  const navigate = useNavigate();
  const money = useMoney();
  const delivery = order.fulfilment_type === "delivery";
  const paidByCard = order.payment_method === "card" && order.payment_status === "paid";
  const zones = useApi<DeliveryZone[]>(delivery ? "/delivery-zones" : null);
  const address = order.delivery_address;
  const [f, setF] = useState<FormState>({
    fulfilment: order.fulfilment_type,
    zoneId: order.zone_id ? String(order.zone_id) : "",
    street: address?.street ?? "",
    building: address?.building ?? "",
    floor: address?.floor ?? "",
    apartment: address?.apartment ?? "",
    landmark: address?.landmark ?? "",
    date: "", // empty: keep the current date and time
    slotId: "",
    name: "",
    email: "",
    phone: "",
    notes: order.customer_notes ?? "",
    payment: order.payment_method,
  });
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (problem) summaryRef.current?.focus();
  }, [problem]);

  const set: SetField = (key, value) => {
    setProblem(null);
    setF((prev) => ({ ...prev, [key]: value }));
  };
  // A paid order keeps its total, so only areas with the same delivery fee are offered.
  const offered = (zones.data ?? []).filter((z) => !paidByCard || z.fee === order.delivery_fee || String(z.id) === f.zoneId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running.current) return;
    if (f.date && !f.slotId) {
      setProblem({ message: "Choose a time for the new date.", fields: { slot: "Choose a time." } });
      return;
    }
    running.current = true;
    setPending(true);
    setProblem(null);
    const body: Record<string, unknown> = { customer_notes: f.notes };
    if (f.slotId) Object.assign(body, { date: f.date || order.fulfilment_date, slot_id: Number(f.slotId) });
    if (delivery) {
      Object.assign(body, {
        zone_id: Number(f.zoneId),
        address: { street: f.street, building: f.building, floor: f.floor, apartment: f.apartment, landmark: f.landmark },
      });
    }
    try {
      await api.patch<Order>(`/orders/${encodeURIComponent(order.code)}${query}`, body);
      navigate(`/track/${encodeURIComponent(order.code)}${query}`, { replace: true, state: { changed: true } });
    } catch (err) {
      setProblem(err instanceof ApiError ? { message: err.message, fields: err.fields ?? {} } : { message: "Something went wrong. Please try again.", fields: {} });
      setPending(false);
    } finally {
      running.current = false;
    }
  }

  const fields = problem?.fields ?? {};
  return (
    <section>
      <p className="mb-2">
        <Link to={back} className="underline">
          ← Back to your order
        </Link>
      </p>
      <h1 className="mb-2 font-display text-3xl font-bold">Change order {order.code}</h1>
      <p className="mb-6 max-w-prose text-muted">
        You can change this order until {order.can_modify_until && formatDateTime(order.can_modify_until)}. The items stay as ordered; to change them, cancel this order and place a new one.
      </p>
      <form noValidate onSubmit={submit} className="max-w-xl">
        {problem && (
          <Alert ref={summaryRef} kind="error" title="We could not save your changes">
            {problem.message}
          </Alert>
        )}
        <h2 className="mb-2 font-display text-xl font-bold">{delivery ? "Delivery time" : "Pickup time"}</h2>
        <p className="mb-4">
          Currently <strong>{formatDate(order.fulfilment_date)}, {formatSlotRange(order.slot_starts_at, order.slot_ends_at)}</strong>. Leave the date empty to keep it. We check availability when you save.
        </p>
        <ScheduleStep f={f} set={set} errors={{ date: fields.date, slot: fields.slot }} lines={[]} dateHint="Dates that are open for orders. We check your cake is available when you save." />

        {delivery && (
          <>
            <h2 className="mt-6 mb-2 font-display text-xl font-bold">Delivery address</h2>
            {paidByCard && <p className="mb-4 text-muted">You have paid online, so you can only choose an area with the same delivery fee ({order.delivery_fee === 0 ? "free" : money(order.delivery_fee)}).</p>}
            <SelectField label="Delivery area" required value={f.zoneId} onChange={(e) => set("zoneId", e.target.value)} error={fields.zone}>
              <option value="">Choose your area</option>
              {offered.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}: {z.fee === 0 ? "free delivery" : `${money(z.fee)} delivery`}
                </option>
              ))}
            </SelectField>
            <TextField label="Street" required value={f.street} onChange={(e) => set("street", e.target.value)} error={fields.street ?? fields["address.street"]} />
            <div className="grid gap-x-4 sm:grid-cols-3">
              <TextField label="Building" required value={f.building} onChange={(e) => set("building", e.target.value)} error={fields.building ?? fields["address.building"]} />
              <TextField label="Floor (optional)" value={f.floor} onChange={(e) => set("floor", e.target.value)} />
              <TextField label="Apartment (optional)" value={f.apartment} onChange={(e) => set("apartment", e.target.value)} />
            </div>
            <TextField label="Landmark (optional)" value={f.landmark} onChange={(e) => set("landmark", e.target.value)} />
          </>
        )}

        <TextAreaField label="Notes for the bakery (optional)" rows={3} maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Link to={back} className="inline-flex min-h-11 items-center rounded-md border-2 border-line px-4 font-semibold">
            Keep the order as it is
          </Link>
        </div>
      </form>
    </section>
  );
}
