import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { api } from "../../lib/api";
import { s } from "../../lib/strings";
import type { MessageResponse } from "../../lib/types";
import { AuthCard } from "./AuthCard";
import { ErrorSummary } from "./ErrorSummary";

export default function ResetPasswordPage() {
  const token = useSearchParams()[0].get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    const res = await api.post<MessageResponse>("/auth/reset-password", { token, new_password: password });
    setDone(res.message);
  });

  return (
    <AuthCard title={s.auth.resetTitle}>
      {!token ? (
        <Alert kind="error">{s.auth.missingToken}</Alert>
      ) : done ? (
        <Alert kind="success">{done}</Alert>
      ) : (
        <>
          <ErrorSummary error={error} summaryRef={summaryRef} />
          <form onSubmit={onSubmit} noValidate>
            <TextField label={s.auth.newPassword} type="password" name="new-password" autoComplete="new-password"
              required hint={s.auth.passwordHint} value={password} onChange={(e) => setPassword(e.target.value)}
              error={error?.fields.new_password} />
            <Button type="submit" disabled={pending} className="w-full">
              {s.auth.resetSubmit}
            </Button>
          </form>
        </>
      )}
      <p className="mt-6 text-center">
        <Link to="/login" className="link">
          {s.auth.backToSignIn}
        </Link>
      </p>
    </AuthCard>
  );
}
