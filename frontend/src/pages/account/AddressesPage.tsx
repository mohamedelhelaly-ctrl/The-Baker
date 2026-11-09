import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { CheckboxField, SelectField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { useMoney } from "../../lib/store";
import type { DeliveryZone, SavedAddress } from "../../lib/types";

const btn = "btn btn-quiet";

/** Delivery addresses saved for faster checkout. */
export default function AddressesPage() {
  usePageTitle("Saved addresses");
  const list = useApi<SavedAddress[]>("/me/addresses");
  const [editing, setEditing] = useState<SavedAddress | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function remove(address: SavedAddress) {
    try {
      await api.delete(`/me/addresses/${address.id}`);
      setMessage({ kind: "success", text: `“${address.label}” was deleted.` });
      setConfirmDelete(null);
      list.reload();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }

  return (
    <>
      <h2 className="mb-2 font-display text-2xl font-bold">Saved addresses</h2>
      <p className="mb-4 max-w-prose text-muted">Save the places you often order to, and pick one at checkout instead of typing it again.</p>
      <div aria-live="polite">{message && <Alert kind={message.kind}>{message.text}</Alert>}</div>
      {list.loading && !list.data && <output>Loading…</output>}
      {list.data && list.data.length === 0 && editing === null && <p className="mb-4">You have no saved addresses yet.</p>}
      <ul className="mb-6 grid gap-4 sm:grid-cols-2">
        {list.data?.map((a) => (
          <li key={a.id} className="card p-5">
            <h3 className="font-bold">
              {a.label} {a.is_default && <span className="font-normal text-muted">(default)</span>}
            </h3>
            <p>
              {a.street}, building {a.building}
              {a.floor && `, floor ${a.floor}`}
              {a.apartment && `, apartment ${a.apartment}`}
              {a.zone_name && `, ${a.zone_name}`}
            </p>
            {a.landmark && <p className="text-muted">{a.landmark}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btn} onClick={() => { setMessage(null); setEditing(a); }}>
                Edit{" "}
                <span className="sr-only">{a.label}</span>
              </button>
              {confirmDelete === a.id ? (
                <>
                  <Button type="button" onClick={() => remove(a)}>
                    Yes, delete{" "}
                    <span className="sr-only">{a.label}</span>
                  </Button>
                  <button type="button" className={btn} onClick={() => setConfirmDelete(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className={btn} onClick={() => setConfirmDelete(a.id)}>
                  Delete{" "}
                  <span className="sr-only">{a.label}</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing === null ? (
        <button type="button" className="btn btn-secondary" onClick={() => { setMessage(null); setEditing("new"); }}>
          Add an address
        </button>
      ) : (
        <AddressForm
          key={editing === "new" ? "new" : editing.id}
          address={editing === "new" ? null : editing}
          onDone={(text) => {
            setEditing(null);
            if (text) setMessage({ kind: "success", text });
            list.reload();
          }}
        />
      )}
    </>
  );
}

function AddressForm({ address, onDone }: { address: SavedAddress | null; onDone: (message?: string) => void }) {
  const money = useMoney();
  const zones = useApi<DeliveryZone[]>("/delivery-zones");
  const [f, setF] = useState({
    label: address?.label ?? "",
    zone_id: address ? String(address.zone_id) : "",
    street: address?.street ?? "",
    building: address?.building ?? "",
    floor: address?.floor ?? "",
    apartment: address?.apartment ?? "",
    landmark: address?.landmark ?? "",
    is_default: address?.is_default ?? false,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((prev) => ({ ...prev, [k]: v }));
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    const body = { ...f, zone_id: Number(f.zone_id) };
    if (address) await api.patch(`/me/addresses/${address.id}`, body);
    else await api.post("/me/addresses", body);
    onDone(address ? `“${f.label}” was saved.` : `“${f.label}” was added.`);
  });
  const fields = error?.fields ?? {};

  return (
    <form noValidate onSubmit={onSubmit} className="card max-w-xl p-6" aria-labelledby="address-form-h">
      <h3 id="address-form-h" className="mb-3 font-display text-xl font-bold">
        {address ? `Edit ${address.label}` : "Add an address"}
      </h3>
      {error && (
        <Alert ref={summaryRef} kind="error" title="We could not save this address">
          {error.message}
        </Alert>
      )}
      <TextField label="Name for this address" hint="For example Home or Work." required value={f.label} onChange={(e) => set("label", e.target.value)} error={fields.label} />
      <SelectField label="Delivery area" required value={f.zone_id} onChange={(e) => set("zone_id", e.target.value)} error={fields.zone_id}>
        <option value="">Choose your area</option>
        {zones.data?.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}: {z.fee === 0 ? "free delivery" : `${money(z.fee)} delivery`}
          </option>
        ))}
      </SelectField>
      <TextField label="Street" required value={f.street} onChange={(e) => set("street", e.target.value)} error={fields.street} />
      <div className="grid gap-x-4 sm:grid-cols-3">
        <TextField label="Building" required value={f.building} onChange={(e) => set("building", e.target.value)} error={fields.building} />
        <TextField label="Floor (optional)" value={f.floor} onChange={(e) => set("floor", e.target.value)} />
        <TextField label="Apartment (optional)" value={f.apartment} onChange={(e) => set("apartment", e.target.value)} />
      </div>
      <TextField label="Landmark (optional)" value={f.landmark} onChange={(e) => set("landmark", e.target.value)} />
      <CheckboxField label="Use this address first at checkout" checked={f.is_default} onChange={(e) => set("is_default", e.target.checked)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save address"}
        </Button>
        <button type="button" className={btn} onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
