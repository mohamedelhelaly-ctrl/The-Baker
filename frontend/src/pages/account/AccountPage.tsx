import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Me } from "../../lib/types";

/** The profile: name and phone are editable, the email is how the account is identified. */
export default function AccountPage() {
  usePageTitle("My account");
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.full_name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [saved, setSaved] = useState(false);
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    setSaved(false);
    updateUser(await api.patch<Me>("/me", { full_name: name, phone }));
    setSaved(true);
  });

  return (
    <>
      <h2 className="mb-2 font-display text-2xl font-bold">Your details</h2>
      <p className="mb-4 max-w-prose">
        Signed in as <strong>{user?.email}</strong>. We use your name and phone number to fill in checkout for you.
      </p>
      <form noValidate onSubmit={onSubmit} className="max-w-md">
        {error && (
          <Alert ref={summaryRef} kind="error" title="We could not save your details">
            {error.message}
          </Alert>
        )}
        <div aria-live="polite">{saved && <Alert kind="success">Your details were saved.</Alert>}</div>
        <TextField label="Full name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} error={error?.fields.full_name} />
        <TextField label="Phone" type="tel" autoComplete="tel" hint="Optional. The driver or bakery may call you." value={phone} onChange={(e) => setPhone(e.target.value)} error={error?.fields.phone} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </form>
      <ChangePassword />
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    setDone(false);
    await api.post("/auth/change-password", { current_password: current, new_password: next });
    setCurrent("");
    setNext("");
    setDone(true);
  });
  return (
    <section aria-labelledby="password-h" className="mt-10 max-w-md">
      <h2 id="password-h" className="mb-3 font-display text-2xl font-bold">
        Change your password
      </h2>
      <form noValidate onSubmit={onSubmit}>
        {error && (
          <Alert ref={summaryRef} kind="error" title="We could not change your password">
            {error.message}
          </Alert>
        )}
        <div aria-live="polite">{done && <Alert kind="success">Your password was changed.</Alert>}</div>
        <TextField label="Current password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} error={error?.fields.current_password} />
        <TextField label="New password" type="password" autoComplete="new-password" required hint="At least 10 characters." value={next} onChange={(e) => setNext(e.target.value)} error={error?.fields.new_password} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </section>
  );
}
