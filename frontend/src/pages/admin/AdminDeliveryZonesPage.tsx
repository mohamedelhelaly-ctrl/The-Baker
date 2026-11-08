import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { CheckboxField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { parseAmount, toMajorString } from "../../lib/money";
import { useMoney, useStore } from "../../lib/store";
import type { AdminDeliveryZone } from "../../lib/types";
import { ErrorSummary } from "../auth/ErrorSummary";
import { StatusBadge } from "./StatusBadge";

interface Body {
  name: string;
  fee: number;
  min_order_amount: number;
  sort_order: number;
  is_active: boolean;
}

export default function AdminDeliveryZonesPage() {
  usePageTitle("Delivery zones");
  const money = useMoney();
  const { can } = useAuth();
  const canEdit = can("schedule_admin", "write");
  const zones = useApi<AdminDeliveryZone[]>("/admin/delivery-zones");
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Delivery zones</h1>
      <p className="mb-6 max-w-prose text-muted">
        Each area has a delivery fee and an optional minimum order. Customers see the fee before they pay.
        {!canEdit && " Only the owner can change zones."}
      </p>
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>

      {canEdit && (
        <section aria-labelledby="add-zone" className="mb-10 max-w-lg rounded-lg border-2 border-line bg-surface p-4">
          <h2 id="add-zone" className="mb-3 font-display text-xl font-bold">
            Add a zone
          </h2>
          <ZoneForm
            submitLabel="Add zone"
            resetOnSave
            onSave={async (body) => {
              await api.post("/admin/delivery-zones", body);
              setMsg({ kind: "success", text: `${body.name} was added.` });
              zones.reload();
            }}
          />
        </section>
      )}

      {zones.data && zones.data.length === 0 && <p>No delivery zones yet, so customers can only choose pickup.</p>}
      <ul className="grid gap-3">
        {zones.data?.map((z) => (
          <li key={z.id} className="rounded-lg border-2 border-line bg-surface p-4">
            {editing === z.id ? (
              <ZoneForm
                initial={z}
                submitLabel="Save changes"
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  await api.patch(`/admin/delivery-zones/${z.id}`, body);
                  setEditing(null);
                  setMsg({ kind: "success", text: `${body.name} was updated.` });
                  zones.reload();
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">
                    {z.name} {!z.is_active && <StatusBadge kind="off">Inactive</StatusBadge>}
                  </p>
                  <p className="text-muted">
                    Fee {money(z.fee)} · Minimum order {z.min_order_amount ? money(z.min_order_amount) : "none"}
                  </p>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => setEditing(z.id)} className="min-h-11 rounded-md border-2 border-line px-3 font-semibold">
                    Edit{" "}<span className="sr-only">{z.name}</span>
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function ZoneForm({ initial, submitLabel, onSave, onCancel, resetOnSave }: {
  initial?: AdminDeliveryZone;
  submitLabel: string;
  onSave: (body: Body) => Promise<void>;
  onCancel?: () => void;
  resetOnSave?: boolean;
}) {
  const { currency, currency_exponent: exp } = useStore();
  const [name, setName] = useState(initial?.name ?? "");
  const [fee, setFee] = useState(initial ? toMajorString(initial.fee, exp) : "");
  const [min, setMin] = useState(initial ? toMajorString(initial.min_order_amount, exp) : "0");
  const [order, setOrder] = useState(String(initial?.sort_order ?? 0));
  const [active, setActive] = useState(initial?.is_active ?? true);

  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    const feeMinor = parseAmount(fee, exp); // 0 is valid: free delivery
    const minMinor = parseAmount(min, exp);
    if (feeMinor === null || minMinor === null) {
      throw new ApiError(422, "validation_error", "Check the amounts.", {
        amounts: `Enter amounts as numbers such as 50 or 50.50 (${currency}).`,
      });
    }
    await onSave({ name, fee: feeMinor, min_order_amount: minMinor, sort_order: Number(order) || 0, is_active: active });
    if (resetOnSave) {
      setName("");
      setFee("");
      setMin("0");
      setOrder("0");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorSummary error={error} summaryRef={summaryRef} />
      <TextField label="Zone name" value={name} required onChange={(e) => setName(e.target.value)} error={error?.fields.name} />
      <TextField label={`Delivery fee (${currency})`} inputMode="decimal" value={fee} required onChange={(e) => setFee(e.target.value)} error={error?.fields.fee} />
      <TextField label={`Minimum order (${currency})`} inputMode="decimal" hint="Use 0 for no minimum." value={min} onChange={(e) => setMin(e.target.value)} error={error?.fields.min_order_amount} />
      <TextField label="Display order" type="number" hint="Lower numbers come first." value={order} onChange={(e) => setOrder(e.target.value)} />
      <CheckboxField label="Active" hint="Inactive zones are hidden from customers." checked={active} onChange={(e) => setActive(e.target.checked)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-11 rounded-md border-2 border-line px-5 font-semibold">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
