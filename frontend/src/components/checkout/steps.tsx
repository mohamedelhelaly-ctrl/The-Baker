import { SelectField, TextAreaField } from "../ui/Field";
import { TextField } from "../ui/TextField";
import { useApi } from "../../hooks/useApi";
import { formatDate, formatTime, hhmm } from "../../lib/dates";
import { itemsParam } from "../../lib/orders";
import { useMoney, useStore } from "../../lib/store";
import type { DatesResponse, DeliveryZone, Fulfilment, SavedAddress, SlotsResponse } from "../../lib/types";

export interface FormState {
  fulfilment: Fulfilment;
  zoneId: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  landmark: string;
  date: string;
  slotId: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  payment: "cod" | "card";
}
export type SetField = <K extends keyof FormState>(key: K, value: FormState[K]) => void;
type Errors = Record<string, string | undefined>;

export function FulfilmentStep({ f, set, errors, zoneProblem, saved = [], onUseSaved }: {
  f: FormState; set: SetField; errors: Errors; zoneProblem?: string; saved?: SavedAddress[]; onUseSaved?: (address: SavedAddress) => void;
}) {
  const money = useMoney();
  const zones = useApi<DeliveryZone[]>("/delivery-zones");
  const { pickup_location, pickup_instructions } = useStore();
  const choice = "mb-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 transition hover:border-ink has-[:checked]:border-primary has-[:checked]:bg-tint has-[:checked]:shadow-[inset_0_0_0_1px_var(--primary)] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]";
  return (
    <>
      <fieldset className="mb-6">
        <legend className="mb-2 font-semibold">How would you like to get your order?</legend>
        <label className={choice}>
          <input type="radio" name="fulfilment" className="size-5 accent-[var(--primary)]" checked={f.fulfilment === "delivery"} onChange={() => set("fulfilment", "delivery")} />
          Delivery
        </label>
        <label className={choice}>
          <input type="radio" name="fulfilment" className="size-5 accent-[var(--primary)]" checked={f.fulfilment === "pickup"} onChange={() => set("fulfilment", "pickup")} />
          Pickup from the bakery (no delivery fee)
        </label>
      </fieldset>

      {f.fulfilment === "pickup" && (pickup_location || pickup_instructions) && (
        <p className="mb-5 rounded-xl bg-tint p-4">
          <strong>Where to collect:</strong> {pickup_location}
          {pickup_instructions && <span className="block">{pickup_instructions}</span>}
        </p>
      )}

      {f.fulfilment === "delivery" && (
        <>
          {saved.length > 0 && onUseSaved && (
            <SelectField
              label="Use a saved address"
              value=""
              onChange={(e) => {
                const chosen = saved.find((a) => String(a.id) === e.target.value);
                if (chosen) onUseSaved(chosen);
              }}
            >
              <option value="">Choose one, or type a new address below</option>
              {saved.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}: {a.street}, building {a.building}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField label="Delivery area" required value={f.zoneId} onChange={(e) => set("zoneId", e.target.value)} error={errors.zone ?? zoneProblem}>
            <option value="">Choose your area</option>
            {zones.data?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}: {z.fee === 0 ? "free delivery" : `${money(z.fee)} delivery`}
                {z.min_order_amount ? `, minimum order ${money(z.min_order_amount)}` : ""}
              </option>
            ))}
          </SelectField>
          {zones.data?.length === 0 && <p className="mb-4">We do not deliver anywhere right now. Please choose pickup.</p>}
          <TextField label="Street" name="street" autoComplete="street-address" required value={f.street} onChange={(e) => set("street", e.target.value)} error={errors.street} />
          <div className="grid gap-x-4 sm:grid-cols-3">
            <TextField label="Building" name="building" required value={f.building} onChange={(e) => set("building", e.target.value)} error={errors.building} />
            <TextField label="Floor (optional)" name="floor" value={f.floor} onChange={(e) => set("floor", e.target.value)} />
            <TextField label="Apartment (optional)" name="apartment" value={f.apartment} onChange={(e) => set("apartment", e.target.value)} />
          </div>
          <TextField label="Landmark (optional)" hint="Helps the driver find you, for example “next to the mosque”." value={f.landmark} onChange={(e) => set("landmark", e.target.value)} />
        </>
      )}
    </>
  );
}

export function ScheduleStep({ f, set, errors, lines, dateProblem, slotProblem, dateHint = "Only dates we can make everything in your cart for are listed." }: {
  f: FormState; set: SetField; errors: Errors; lines: { variantId: number; quantity: number }[]; dateProblem?: string; slotProblem?: string; dateHint?: string;
}) {
  const items = itemsParam(lines);
  const dates = useApi<DatesResponse>(`/availability/dates?fulfilment=${f.fulfilment}&days=45&items=${items}`);
  const slots = useApi<SlotsResponse>(f.date ? `/availability/slots?date=${f.date}&fulfilment=${f.fulfilment}&items=${items}` : null);
  const open = dates.data?.days.filter((d) => d.available) ?? [];
  const verb = f.fulfilment === "delivery" ? "delivery" : "pickup";

  return (
    <>
      <SelectField
        label={`${f.fulfilment === "delivery" ? "Delivery" : "Pickup"} date`}
        required
        value={f.date}
        onChange={(e) => {
          set("date", e.target.value);
          set("slotId", "");
        }}
        error={errors.date ?? dateProblem}
        hint={dateHint}
      >
        <option value="">Choose a date</option>
        {open.map((d) => (
          <option key={d.date} value={d.date}>
            {formatDate(d.date)}
          </option>
        ))}
      </SelectField>
      {dates.data && open.length === 0 && <p className="mb-4 font-semibold text-danger">There are no {verb} dates available for this cart in the next 45 days. Try a smaller order or call us.</p>}

      {f.date && slots.data && (
        <fieldset className="mb-6" aria-describedby={errors.slot || slotProblem ? "slot-error" : undefined}>
          <legend className="mb-2 font-semibold">Time</legend>
          {slots.data.slots.length === 0 && <p>{slots.data.message ?? "No times on this day."}</p>}
          {slots.data.slots.map((s) => {
            const label = `${formatTime(hhmm(s.starts_at))} to ${formatTime(hhmm(s.ends_at))}`;
            return (
              <label key={s.slot_id} className={`mb-2 flex min-h-12 items-center gap-3 rounded-xl border px-4 transition has-[:checked]:border-primary has-[:checked]:bg-tint has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${s.available ? "cursor-pointer border-line bg-surface hover:border-ink" : "border-hairline bg-tint text-muted"}`}>
                <input type="radio" name="slot" className="size-5 accent-[var(--primary)]" disabled={!s.available} checked={f.slotId === String(s.slot_id)} onChange={() => set("slotId", String(s.slot_id))} />
                <span className="flex-1">{label}</span>
                <span className="text-sm">{s.available ? (s.remaining_orders <= 2 ? `Only ${s.remaining_orders} left` : "") : s.message}</span>
              </label>
            );
          })}
          {(errors.slot || slotProblem) && (
            <p id="slot-error" className="mt-1 flex gap-1 font-medium text-danger">
              <span aria-hidden="true">⚠</span>
              {errors.slot ?? slotProblem}
            </p>
          )}
        </fieldset>
      )}
    </>
  );
}

export function ContactStep({ f, set, errors }: { f: FormState; set: SetField; errors: Errors }) {
  return (
    <>
      <TextField label="Full name" name="name" autoComplete="name" required value={f.name} onChange={(e) => set("name", e.target.value)} error={errors.name} />
      <TextField label="Email" type="email" name="email" autoComplete="email" required hint="We use it to contact you about your order." value={f.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
      <TextField label="Phone" type="tel" name="phone" autoComplete="tel" required hint="The driver or bakery may call you." value={f.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} />
      <TextAreaField label="Notes for the bakery (optional)" rows={3} maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
    </>
  );
}

export function PaymentStep({ f, set, methods }: { f: FormState; set: SetField; methods: ("cod" | "card")[] }) {
  const choice = (on: boolean) =>
    `mb-2 flex min-h-12 items-center gap-3 rounded-xl border px-4 transition ${on ? "cursor-pointer border-line bg-surface hover:border-ink has-[:checked]:border-primary has-[:checked]:bg-tint has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]" : "border-hairline bg-tint text-muted"}`;
  const hasCod = methods.includes("cod");
  const hasCard = methods.includes("card");
  return (
    <fieldset className="mb-6">
      <legend className="mb-2 font-semibold">How would you like to pay?</legend>
      {hasCod && (
        <label className={choice(true)}>
          <input type="radio" name="payment" className="size-5 accent-[var(--primary)]" checked={f.payment === "cod"} onChange={() => set("payment", "cod")} />
          Cash on delivery or pickup
        </label>
      )}
      <label className={choice(hasCard)}>
        <input type="radio" name="payment" className="size-5 accent-[var(--primary)]" disabled={!hasCard} checked={hasCard && f.payment === "card"} onChange={() => set("payment", "card")} />
        {hasCard ? "Pay online by card" : "Pay online by card (not available right now)"}
      </label>
      <p className="mt-2 text-muted">
        {f.payment === "card" && hasCard
          ? "After you place the order you will be taken to a secure payment page. Your order is confirmed once the payment goes through."
          : "You pay when you receive or collect your order."}
      </p>
    </fieldset>
  );
}
