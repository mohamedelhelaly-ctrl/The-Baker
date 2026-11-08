import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { useAuth } from "../../lib/auth";
import { s } from "../../lib/strings";
import { AuthCard } from "./AuthCard";
import { ErrorSummary } from "./ErrorSummary";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    await register({ ...form, phone: form.phone || undefined });
    navigate("/account", { replace: true });
  });

  return (
    <AuthCard title={s.auth.registerTitle}>
      <ErrorSummary error={error} summaryRef={summaryRef} />
      <form onSubmit={onSubmit} noValidate>
        <TextField label={s.auth.fullName} name="name" autoComplete="name" required value={form.full_name}
          onChange={set("full_name")} error={error?.fields.full_name} />
        <TextField label={s.auth.email} type="email" name="email" autoComplete="email" required value={form.email}
          onChange={set("email")} error={error?.fields.email} />
        <TextField label={s.auth.phone} type="tel" name="phone" autoComplete="tel" value={form.phone}
          onChange={set("phone")} error={error?.fields.phone} />
        <TextField label={s.auth.password} type="password" name="password" autoComplete="new-password" required
          hint={s.auth.passwordHint} value={form.password} onChange={set("password")} error={error?.fields.password} />
        <Button type="submit" disabled={pending}>
          {s.auth.registerSubmit}
        </Button>
      </form>
      <p className="mt-6">
        {s.auth.haveAccount}{" "}
        <Link to="/login" className="underline">
          {s.nav.signIn}
        </Link>
      </p>
    </AuthCard>
  );
}
