import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { CheckboxField, SelectField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateShort, formatTime, hhmm, todayIso, WEEKDAYS } from "../../lib/dates";
import type { Closure, HoursEntry, SlotFulfilment, TimeSlot } from "../../lib/types";

type Msg = { kind: "success" | "error"; text: string } | null;
const FOR: Record<SlotFulfilment, string> = { both: "Delivery and pickup", delivery: "Delivery only", pickup: "Pickup only" };
const btn = "min-h-11 rounded-md border-2 border-line px-3 font-semibold";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

export default function AdminSchedulePage() {
  usePageTitle("Schedule");
  const { can } = useAuth();
  const canEdit = can("schedule_admin", "write");
  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Schedule</h1>
      <p className="mb-8 max-w-prose text-muted">
        Customers can only choose a delivery or pickup time that falls inside these opening hours, on a day that is not closed, in one of these time slots.
        {!canEdit && " You can view the schedule. Only the owner can change it."}
      </p>
      <HoursSection canEdit={canEdit} />
      <SlotsSection canEdit={canEdit} />
      <ClosuresSection canEdit={canEdit} />
    </>
  );
}

// ---------------------------------------------------------------- opening hours
function HoursSection({ canEdit }: { canEdit: boolean }) {
  const hours = useApi<HoursEntry[]>("/admin/opening-hours");
  if (!hours.data) return <section aria-labelledby="hours-h" className="mb-12"><h2 id="hours-h" className="mb-3 font-display text-2xl font-bold">Opening hours</h2><output>Loading…</output></section>;
  return <HoursForm key={JSON.stringify(hours.data)} initial={hours.data} canEdit={canEdit} onSaved={hours.reload} />;
}

function HoursForm({ initial, canEdit, onSaved }: { initial: HoursEntry[]; canEdit: boolean; onSaved: () => void }) {
  const byDay = new Map(initial.map((h) => [h.weekday, h]));
  const [rows, setRows] = useState(
    WEEKDAYS.map((_, d) => {
      const h = byDay.get(d);
      return { open: h ? hhmm(h.opens_at) : "09:00", close: h ? hhmm(h.closes_at) : "21:00", closed: h ? h.is_closed : true };
    }),
  );
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const bad = rows.findIndex((r) => !r.closed && r.open >= r.close);
    if (bad >= 0) return setMsg({ kind: "error", text: `${WEEKDAYS[bad]}: opening time must be before closing time.` });
    setPending(true);
    try {
      await api.put("/admin/opening-hours", {
        days: rows.map((r, d) => ({ weekday: d, opens_at: r.open, closes_at: r.close, is_closed: r.closed })),
      });
      setMsg({ kind: "success", text: "Opening hours saved." });
      onSaved();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="hours-h" className="mb-12 max-w-2xl">
      <h2 id="hours-h" className="mb-3 font-display text-2xl font-bold">
        Opening hours
      </h2>
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>
      <form onSubmit={save} noValidate>
        <fieldset disabled={!canEdit} className="grid gap-3">
          <legend className="sr-only">Opening hours for each day</legend>
          {WEEKDAYS.map((day, i) => (
            <div key={day} className="grid items-end gap-x-3 rounded-lg border-2 border-line bg-surface p-3 sm:grid-cols-[8rem_1fr_1fr_auto]">
              <p className="mb-5 font-bold sm:mb-0 sm:self-center" id={`day-${i}`}>
                {day}
              </p>
              <TextField label={`${day} opens`} type="time" value={rows[i].open} disabled={rows[i].closed} onChange={(e) => set(i, { open: e.target.value })} />
              <TextField label={`${day} closes`} type="time" value={rows[i].close} disabled={rows[i].closed} onChange={(e) => set(i, { close: e.target.value })} />
              <CheckboxField label={`${day} closed`} checked={rows[i].closed} onChange={(e) => set(i, { closed: e.target.checked })} />
            </div>
          ))}
        </fieldset>
        {canEdit && (
          <Button type="submit" disabled={pending} className="mt-4">
            Save opening hours
          </Button>
        )}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- time slots
function SlotsSection({ canEdit }: { canEdit: boolean }) {
  const slots = useApi<TimeSlot[]>("/admin/time-slots");
  const [msg, setMsg] = useState<Msg>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMsg({ kind: "success", text: success });
      slots.reload();
      return true;
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
      return false;
    }
  }

  return (
    <section aria-labelledby="slots-h" className="mb-12 max-w-3xl">
      <h2 id="slots-h" className="mb-1 font-display text-2xl font-bold">
        Time slots
      </h2>
      <p className="mb-3 text-muted">Fixed two-hour windows customers pick. Each slot takes a limited number of orders.</p>
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>

      {slots.data && slots.data.length === 0 && <p className="mb-4">No time slots yet, so customers cannot order for any day.</p>}
      {WEEKDAYS.map((day, d) => {
        const list = slots.data?.filter((s) => s.weekday === d) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={day} className="mb-5">
            <h3 className="mb-2 text-lg font-bold">{day}</h3>
            <ul className="grid gap-2">
              {list.map((slot) => (
                <SlotRow key={`${slot.id}-${slot.max_orders}-${slot.is_active}`} slot={slot} canEdit={canEdit} run={run} />
              ))}
            </ul>
          </div>
        );
      })}

      {canEdit && <AddSlot run={run} />}
    </section>
  );
}

function SlotRow({ slot, canEdit, run }: { slot: TimeSlot; canEdit: boolean; run: (a: () => Promise<unknown>, s: string) => Promise<boolean> }) {
  const [max, setMax] = useState(String(slot.max_orders));
  const [active, setActive] = useState(slot.is_active);
  const [confirming, setConfirming] = useState(false);
  const label = `${WEEKDAYS[slot.weekday]} ${formatTime(slot.starts_at)} to ${formatTime(slot.ends_at)}`;
  const url = `/admin/time-slots/${slot.id}`;
  return (
    <li className="rounded-lg border-2 border-line bg-surface p-3">
      <p className="font-bold">
        {formatTime(slot.starts_at)} to {formatTime(slot.ends_at)} <span className="font-normal text-muted">· {FOR[slot.fulfilment_type]}</span>
      </p>
      {canEdit ? (
        <div className="mt-2 grid items-end gap-x-3 sm:grid-cols-[10rem_auto_1fr]">
          <TextField label={`Max orders, ${label}`} type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />
          <CheckboxField label={`Active, ${label}`} checked={active} onChange={(e) => setActive(e.target.checked)} />
          <div className="mb-5 flex flex-wrap gap-2 sm:mb-3">
            <button type="button" className={btn} onClick={() => void run(() => api.patch(url, { max_orders: Number(max), is_active: active }), `${label} saved.`)}>
              Save{" "}<span className="sr-only">{label}</span>
            </button>
            {confirming ? (
              <>
                <button type="button" className="min-h-11 rounded-md border-2 border-danger px-3 font-semibold text-danger" onClick={() => void run(() => api.delete(url), `${label} deleted.`)}>
                  Confirm delete{" "}<span className="sr-only">{label}</span>
                </button>
                <button type="button" className={btn} onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className={btn} onClick={() => setConfirming(true)}>
                Delete{" "}<span className="sr-only">{label}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted">
          Up to {slot.max_orders} orders · {slot.is_active ? "Active" : "Inactive"}
        </p>
      )}
    </li>
  );
}

function AddSlot({ run }: { run: (a: () => Promise<unknown>, s: string) => Promise<boolean> }) {
  const [f, setF] = useState({ weekday: "0", start: "10:00", end: "12:00", type: "both" as SlotFulfilment, max: "6" });
  return (
    <form
      noValidate
      className="mt-4 rounded-lg border-2 border-line bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(
          () => api.post("/admin/time-slots", { weekday: Number(f.weekday), starts_at: f.start, ends_at: f.end, fulfilment_type: f.type, max_orders: Number(f.max) }),
          "Time slot added.",
        );
      }}
    >
      <h3 className="mb-2 text-lg font-bold">Add a time slot</h3>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <SelectField label="Day" value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </SelectField>
        <SelectField label="For" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as SlotFulfilment })}>
          {(Object.keys(FOR) as SlotFulfilment[]).map((k) => (
            <option key={k} value={k}>
              {FOR[k]}
            </option>
          ))}
        </SelectField>
        <TextField label="Starts" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        <TextField label="Ends" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        <TextField label="Maximum orders" type="number" min={1} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
      </div>
      <Button type="submit">Add time slot</Button>
    </form>
  );
}

// ---------------------------------------------------------------- closures
function ClosuresSection({ canEdit }: { canEdit: boolean }) {
  const closures = useApi<Closure[]>("/admin/closures");
  const [msg, setMsg] = useState<Msg>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMsg({ kind: "success", text: success });
      closures.reload();
      return true;
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
      return false;
    }
  }

  return (
    <section aria-labelledby="closures-h" className="mb-12 max-w-2xl">
      <h2 id="closures-h" className="mb-1 font-display text-2xl font-bold">
        Closed dates
      </h2>
      <p className="mb-3 text-muted">Holidays and one-off closures. Customers cannot order for these dates.</p>
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>
      {closures.data && closures.data.length === 0 && <p className="mb-4">No upcoming closed dates.</p>}
      <ul className="mb-4 grid gap-2">
        {closures.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-line bg-surface p-3">
            <span>
              <strong>{formatDateShort(c.date)}</strong>
              {c.reason && <span className="text-muted"> · {c.reason}</span>}
            </span>
            {canEdit && (
              <button type="button" className={btn} onClick={() => void run(() => api.delete(`/admin/closures/${c.id}`), "Closed date removed.")}>
                Remove{" "}<span className="sr-only">{formatDateShort(c.date)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          noValidate
          className="rounded-lg border-2 border-line bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!date) return setMsg({ kind: "error", text: "Choose a date." });
            if (await run(() => api.post("/admin/closures", { date, reason }), "Closed date added.")) {
              setDate("");
              setReason("");
            }
          }}
        >
          <h3 className="mb-2 text-lg font-bold">Close a date</h3>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <TextField label="Date" type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
            <TextField label="Reason (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit">Add closed date</Button>
        </form>
      )}
    </section>
  );
}
