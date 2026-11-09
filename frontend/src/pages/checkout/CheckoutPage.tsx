import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ContactStep, FulfilmentStep, PaymentStep, ScheduleStep, type FormState, type SetField } from "../../components/checkout/steps";
import { OrderSummary } from "../../components/checkout/OrderSummary";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { useApi } from "../../hooks/useApi";
import { useQuote } from "../../hooks/useQuote";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { formatDate, formatTime, hhmm } from "../../lib/dates";
import { redirectTo } from "../../lib/navigation";
import { useMoney, useStore } from "../../lib/store";
import type { OrderCreated, SavedAddress, SlotsResponse } from "../../lib/types";

const STEPS = ["Delivery or pickup", "Date and time", "Your details", "Payment", "Review"] as const;
const PHONE = /^[0-9+()\-\s]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-key`;
}

export default function CheckoutPage() {
  usePageTitle("Checkout");
  const cart = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const money = useMoney();
  const { payment_methods: methods, policy_text } = useStore();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<FormState>({
    fulfilment: "delivery", zoneId: "", street: "", building: "", floor: "", apartment: "", landmark: "",
    date: "", slotId: "", name: "", email: "", phone: "", notes: "", payment: "cod",
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitError, setSubmitError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [placing, setPlacing] = useState(false);
  const inFlight = useRef(false); // a ref, so a fast double click cannot slip past a stale state value
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // If the chosen method is not offered (the shop switched it off), fall back to one that is.
  const payment = methods.includes(f.payment) ? f.payment : (methods[0] ?? "cod");

  const set: SetField = (key, value) => {
    setErrors({});
    setSubmitError(null);
    setF((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "fulfilment") Object.assign(next, { date: "", slotId: "" });
      return next;
    });
  };

  // Prefill from the signed-in account once it has loaded, without overwriting what the customer typed.
  // (Adjusting state while rendering is React's recommended alternative to an effect here.)
  const [prefilled, setPrefilled] = useState(false);
  if (user && !prefilled) {
    setPrefilled(true);
    setF((prev) => ({ ...prev, name: prev.name || user.full_name, email: prev.email || user.email, phone: prev.phone || (user.phone ?? "") }));
  }

  // Saved addresses of a signed-in customer: the default one is filled in for them, and any can be picked.
  const saved = useApi<SavedAddress[]>(user ? "/me/addresses" : null);
  const applySavedAddress = (a: SavedAddress) => {
    setErrors({});
    setSubmitError(null);
    setF((prev) => ({ ...prev, zoneId: String(a.zone_id), street: a.street, building: a.building, floor: a.floor ?? "", apartment: a.apartment ?? "", landmark: a.landmark ?? "" }));
  };
  const [defaultApplied, setDefaultApplied] = useState(false);
  const defaultAddress = saved.data?.find((a) => a.is_default);
  if (defaultAddress && !defaultApplied) {
    setDefaultApplied(true);
    if (!f.street && !f.building) applySavedAddress(defaultAddress);
  }

  // Move focus to the step heading so keyboard and screen reader users land in the right place.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (submitError) summaryRef.current?.focus();
  }, [submitError]);

  const choices = useMemo(
    () => ({
      fulfilment_type: f.fulfilment,
      zone_id: f.fulfilment === "delivery" && f.zoneId ? Number(f.zoneId) : undefined,
      date: f.date || undefined,
      slot_id: f.slotId ? Number(f.slotId) : undefined,
    }),
    [f.fulfilment, f.zoneId, f.date, f.slotId],
  );
  const { quote, loading } = useQuote(cart.lines, choices);
  const problem = (field: string) => quote?.problems.find((p) => p.field === field)?.message;

  // One Idempotency-Key per distinct order, so a double click or retry can never place it twice.
  const keyRef = useRef({ signature: "", key: newKey() });
  function idempotencyKey(signature: string) {
    if (keyRef.current.signature !== signature) keyRef.current = { signature, key: newKey() };
    return keyRef.current.key;
  }

  if (cart.lines.length === 0 && !placing) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">Checkout</h1>
        <p className="mt-4 text-lg">Your cart is empty, so there is nothing to check out.</p>
        <p className="mt-4">
          <Link to="/menu" className="underline">
            Browse the menu
          </Link>
        </p>
      </section>
    );
  }

  function validate(index: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (index === 0) {
      if (f.fulfilment === "delivery") {
        if (!f.zoneId) e.zone = "Choose your delivery area.";
        if (!f.street.trim()) e.street = "Enter your street.";
        if (!f.building.trim()) e.building = "Enter your building number or name.";
      }
      const blocking = problem("zone") ?? problem("items");
      if (blocking && !e.zone) e.zone = blocking;
    }
    if (index === 1) {
      if (!f.date) e.date = "Choose a date.";
      else if (!f.slotId) e.slot = "Choose a time.";
      const dateProblem = problem("date");
      const slotProblem = problem("slot");
      if (dateProblem && !e.date) e.date = dateProblem;
      if (slotProblem && !e.slot) e.slot = slotProblem;
    }
    if (index === 2) {
      if (!f.name.trim()) e.name = "Enter your name.";
      if (!EMAIL.test(f.email.trim())) e.email = "Enter a valid email address, such as sara@example.com.";
      if (!PHONE.test(f.phone.trim())) e.phone = "Enter a phone number using digits, spaces, + or -.";
    }
    return e;
  }

  function next(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(step);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(step + 1);
  }

  async function place(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPlacing(true);
    setSubmitError(null);
    const body = {
      items: cart.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, inscription: l.inscription || null })),
      fulfilment_type: f.fulfilment,
      zone_id: f.fulfilment === "delivery" ? Number(f.zoneId) : null,
      address: f.fulfilment === "delivery"
        ? { street: f.street.trim(), building: f.building.trim(), floor: f.floor.trim() || null, apartment: f.apartment.trim() || null, landmark: f.landmark.trim() || null }
        : null,
      date: f.date,
      slot_id: Number(f.slotId),
      contact: { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() },
      payment_method: payment,
      customer_notes: f.notes.trim() || null,
    };
    try {
      const order = await api.post<OrderCreated>("/orders", body, { headers: { "Idempotency-Key": idempotencyKey(JSON.stringify(body)) } });
      cart.clear();
      if (order.payment_url) {
        redirectTo(order.payment_url); // card: off to the secure payment page; it returns to /track/...
        return;
      }
      navigate(`/track/${order.code}?t=${order.tracking_token}`, { replace: true, state: { justPlaced: true } });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      inFlight.current = false;
      setSubmitError({ message: apiErr?.message ?? "Something went wrong. Please try again.", fields: apiErr?.fields ?? {} });
      // Send the customer back to the step that can fix the problem.
      const fields = Object.keys(apiErr?.fields ?? {});
      if (fields.some((x) => x === "items" || x === "zone")) setStep(0);
      else if (fields.some((x) => x === "date" || x === "slot")) setStep(1);
      setPlacing(false);
    }
  }

  const stepProblem = {
    zone: step === 0 ? problem("zone") : undefined,
    date: step === 1 ? problem("date") : undefined,
    slot: step === 1 ? problem("slot") : undefined,
  };
  const summaryErrors = Object.values(errors).filter(Boolean) as string[];
  const blockedByQuote = (step === 0 && (stepProblem.zone || problem("items"))) || (step === 1 && (stepProblem.date || stepProblem.slot));

  return (
    <>
      <h1 className="mb-6 font-display text-4xl font-bold">Checkout</h1>
      <ol aria-label="Checkout steps" className="mb-3 grid grid-cols-5 gap-2 sm:mb-8">
        {STEPS.map((name, i) => (
          <li key={name} aria-current={i === step ? "step" : undefined}>
            <span aria-hidden="true" className={`block h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-hairline"}`} />
            <span className={`sr-only mt-2 text-sm sm:not-sr-only sm:block ${i === step ? "font-bold" : "text-muted"}`}>
              <span aria-hidden="true">{i < step ? "✓ " : ""}</span>
              {name}
              {i < step && <span className="sr-only"> (done)</span>}
              {i === step && <span className="sr-only"> (current step)</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-6 text-sm text-muted sm:hidden" aria-hidden="true">
        Step {step + 1} of {STEPS.length}
      </p>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="card p-6 sm:p-8">
          <h2 ref={headingRef} tabIndex={-1} className="mb-6 font-display text-2xl font-bold">
            {STEPS[step]}
          </h2>

          {(summaryErrors.length > 0 || submitError) && (
            <Alert kind="error" title="There is a problem" ref={summaryRef}>
              <ul className="ms-5 list-disc">
                {summaryErrors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {submitError && <li>{submitError.message}</li>}
              </ul>
            </Alert>
          )}

          {step < 4 ? (
            <form onSubmit={next} noValidate>
              {step === 0 && <FulfilmentStep f={f} set={set} errors={errors} zoneProblem={stepProblem.zone} saved={saved.data ?? []} onUseSaved={applySavedAddress} />}
              {step === 1 && <ScheduleStep f={f} set={set} errors={errors} lines={cart.lines} dateProblem={stepProblem.date} slotProblem={stepProblem.slot} />}
              {step === 2 && <ContactStep f={f} set={set} errors={errors} />}
              {step === 3 && <PaymentStep f={{ ...f, payment }} set={set} methods={methods} />}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                {step > 0 ? (
                  <button type="button" onClick={() => { setErrors({}); setStep(step - 1); }} className="btn btn-quiet">
                    <span aria-hidden="true">← </span>Back
                  </button>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={Boolean(blockedByQuote)} className="px-8">
                  Continue
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={place} noValidate>
              <Review f={{ ...f, payment }} />
              {policy_text && (
                <p className="mt-5 rounded-xl bg-tint p-4 text-sm">
                  <strong>Changing your mind:</strong> {policy_text}
                </p>
              )}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => setStep(3)} className="btn btn-quiet">
                  <span aria-hidden="true">← </span>Back
                </button>
                <Button type="submit" disabled={placing || !quote?.ready} className="px-8">
                  {placing ? "Placing your order…" : `${payment === "card" ? "Place order and pay" : "Place order"} · ${quote ? money(quote.total) : ""}`}
                </Button>
              </div>
              {quote && !quote.ready && <p className="mt-3 font-semibold text-danger">Something in your order needs attention. Go back to fix it.</p>}
            </form>
          )}
        </div>

        <aside aria-label="Order summary" className="content-start">
          <OrderSummary quote={quote} loading={loading} deliveryChosen={f.fulfilment === "delivery" && Boolean(f.zoneId)} />
        </aside>
      </div>
    </>
  );
}

function Review({ f }: { f: FormState }) {
  const { data } = useSlotLabel(f);
  return (
    <dl className="divide-y divide-hairline rounded-xl border border-hairline">
      <Row label={f.fulfilment === "delivery" ? "Delivery to" : "Pickup"}>
        {f.fulfilment === "delivery" ? (
          <>
            {f.street}, building {f.building}
            {f.floor && `, floor ${f.floor}`}
            {f.apartment && `, apartment ${f.apartment}`}
            {f.landmark && <span className="block text-muted">{f.landmark}</span>}
          </>
        ) : (
          "Collect from the bakery"
        )}
      </Row>
      <Row label="When">
        {f.date ? `${formatDate(f.date)}${data ? `, ${data}` : ""}` : ""}
      </Row>
      <Row label="Contact">
        {f.name}
        <span className="block">{f.email}</span>
        <span className="block">{f.phone}</span>
      </Row>
      {f.notes && <Row label="Notes">{f.notes}</Row>}
      <Row label="Payment">{f.payment === "card" ? "Online by card" : "Cash on delivery or pickup"}</Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 p-4 sm:grid-cols-[9rem_1fr]">
      <dt className="font-semibold text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function useSlotLabel(f: FormState) {
  const slots = useApi<SlotsResponse>(f.date ? `/availability/slots?date=${f.date}&fulfilment=${f.fulfilment}` : null);
  const slot = slots.data?.slots.find((s) => String(s.slot_id) === f.slotId);
  return { data: slot ? `${formatTime(hhmm(slot.starts_at))} to ${formatTime(hhmm(slot.ends_at))}` : "" };
}
