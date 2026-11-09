import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextAreaField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api } from "../../lib/api";
import type { ShopDetails } from "../../lib/types";

/** Owner: how the shop introduces itself and where customers collect (requirements O4.1, O4.4). */
export default function AdminShopPage() {
  usePageTitle("Shop details");
  const details = useApi<ShopDetails>("/admin/settings");
  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Shop details</h1>
      <p className="mb-8 max-w-prose text-muted">
        Shown to customers in the page footer, at checkout when they choose pickup, on their order page and in their emails. Opening hours are under Schedule.
      </p>
      {details.error && <p role="alert" className="text-danger">We could not load the details. Please try again.</p>}
      {!details.data && !details.error && <output>Loading…</output>}
      {details.data && <DetailsForm details={details.data} />}
    </>
  );
}

function DetailsForm({ details }: { details: ShopDetails }) {
  const [f, setF] = useState({
    business_name: details.business_name ?? "",
    phone: details.phone ?? "",
    whatsapp: details.whatsapp ?? "",
    email: details.email ?? "",
    address: details.address ?? "",
    pickup_location: details.pickup_location ?? "",
    pickup_instructions: details.pickup_instructions ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [saved, setSaved] = useState(false);
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    setSaved(false);
    await api.put("/admin/settings", f);
    setSaved(true);
  });
  const fields = error?.fields ?? {};
  return (
    <form noValidate onSubmit={onSubmit} className="max-w-xl">
      {error && (
        <Alert ref={summaryRef} kind="error" title="We could not save the details">
          {error.message}
        </Alert>
      )}
      <div aria-live="polite">{saved && <Alert kind="success">Saved. Customers see the new details straight away.</Alert>}</div>
      <h2 className="mb-3 font-display text-2xl font-bold">Business</h2>
      <TextField label="Shop name" hint="Leave empty to use the default, The Baker." maxLength={80} value={f.business_name} onChange={(e) => set("business_name", e.target.value)} error={fields.business_name} />
      <TextField label="Phone" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} error={fields.phone} />
      <TextField label="WhatsApp" type="tel" hint="With the country code, for example +20 100 123 4567." value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} error={fields.whatsapp} />
      <TextField label="Email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} error={fields.email} />
      <TextAreaField label="Address" rows={2} maxLength={300} value={f.address} onChange={(e) => set("address", e.target.value)} error={fields.address} />
      <h2 className="mt-8 mb-3 font-display text-2xl font-bold">Pickup</h2>
      <TextField label="Where customers collect" hint="For example “Side door on Road 9”." maxLength={200} value={f.pickup_location} onChange={(e) => set("pickup_location", e.target.value)} error={fields.pickup_location} />
      <TextAreaField label="Pickup instructions" hint="For example “Ring the bell and give your order code.”" rows={3} maxLength={500} value={f.pickup_instructions} onChange={(e) => set("pickup_instructions", e.target.value)} error={fields.pickup_instructions} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}
