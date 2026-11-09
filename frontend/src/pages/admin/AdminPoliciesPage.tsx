import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextAreaField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api } from "../../lib/api";
import type { Policy } from "../../lib/types";

const CHOICES: { value: Policy["refund_policy"]; label: string }[] = [
  { value: "full", label: "Refund in full" },
  { value: "percentage", label: "Refund a percentage" },
  { value: "none", label: "No refund" },
];

/** Owner: how long customers can change or cancel, and what they get back (requirement O2.1). */
export default function AdminPoliciesPage() {
  usePageTitle("Cancellation and refunds");
  const policy = useApi<Policy>("/admin/policies");
  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Cancellation and refunds</h1>
      <p className="mb-8 max-w-prose text-muted">
        Decide how long before the time slot customers can still change or cancel an order, and what they get back when they cancel a card order themselves. If you cancel or decline an order, the customer is always refunded in full.
      </p>
      {policy.error && <p role="alert" className="text-danger">We could not load the policy. Please try again.</p>}
      {!policy.data && !policy.error && <output>Loading…</output>}
      {policy.data && <PolicyForm key={policy.data.preview} policy={policy.data} onSaved={policy.reload} />}
    </>
  );
}

function PolicyForm({ policy, onSaved }: { policy: Policy; onSaved: () => void }) {
  const [hours, setHours] = useState(String(policy.cancellation_window_hours));
  const [kind, setKind] = useState(policy.refund_policy);
  const [percent, setPercent] = useState(String(policy.refund_policy === "percentage" ? policy.refund_percentage : 50));
  const [note, setNote] = useState(policy.policy_note ?? "");
  const [preview, setPreview] = useState(policy.preview);
  const [saved, setSaved] = useState(false);
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    setSaved(false);
    const result = await api.put<Policy>("/admin/policies", {
      cancellation_window_hours: Number(hours),
      refund_policy: kind,
      refund_percentage: kind === "percentage" ? Number(percent) : 100,
      policy_note: note,
    });
    setPreview(result.preview);
    setSaved(true);
    onSaved();
  });
  const fields = error?.fields ?? {};
  const choice = "mb-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border-2 border-line bg-surface px-3 has-[:checked]:border-primary";

  return (
    <form noValidate onSubmit={onSubmit} className="max-w-xl">
      {error && (
        <Alert ref={summaryRef} kind="error" title="We could not save the policy">
          {error.message}
        </Alert>
      )}
      <div aria-live="polite">{saved && <Alert kind="success">The policy was saved. Customers see the new wording straight away.</Alert>}</div>
      <TextField
        label="Hours before the time slot"
        type="number"
        min={0}
        max={720}
        required
        hint="Customers can change or cancel until this long before their slot starts. Use 0 to allow it until the slot starts. Never after you have started preparing the order."
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        error={fields.cancellation_window_hours}
      />
      <fieldset className="mb-5">
        <legend className="mb-2 font-semibold">When a customer cancels an order they paid by card</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className={choice}>
            <input type="radio" name="refund" className="size-5" checked={kind === c.value} onChange={() => setKind(c.value)} />
            {c.label}
          </label>
        ))}
      </fieldset>
      {kind === "percentage" && (
        <TextField label="Percentage refunded" type="number" min={1} max={99} required hint="Between 1 and 99." value={percent} onChange={(e) => setPercent(e.target.value)} error={fields.refund_percentage ?? fields.request} />
      )}
      <TextAreaField label="Extra wording (optional)" hint="Shown to customers after the rules above, for example “Custom cakes cannot be cancelled.”" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} error={fields.policy_note} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save policy"}
      </Button>
      <section aria-labelledby="preview-h" className="mt-8 rounded-md border-2 border-line p-4">
        <h2 id="preview-h" className="mb-1 font-semibold">
          What customers read (as last saved)
        </h2>
        <p>{preview}</p>
      </section>
    </form>
  );
}
