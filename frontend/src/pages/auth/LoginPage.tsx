import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { useAuth } from "../../lib/auth";
import { s } from "../../lib/strings";
import { AuthCard } from "./AuthCard";
import { ErrorSummary } from "./ErrorSummary";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/account";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    await login(email, password);
    navigate(from, { replace: true });
  });

  return (
    <AuthCard title={s.auth.loginTitle}>
      <ErrorSummary error={error} summaryRef={summaryRef} />
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label={s.auth.email}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error?.fields.email}
        />
        <TextField
          label={s.auth.password}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error?.fields.password}
        />
        <Button type="submit" disabled={pending} className="w-full">
          {s.auth.loginSubmit}
        </Button>
      </form>
      <p className="mt-6 text-center">
        <Link to="/forgot-password" className="link">
          {s.auth.forgotLink}
        </Link>
      </p>
      <p className="mt-2 text-center">
        {s.auth.noAccount}{" "}
        <Link to="/register" className="link">
          {s.nav.register}
        </Link>
      </p>
    </AuthCard>
  );
}
