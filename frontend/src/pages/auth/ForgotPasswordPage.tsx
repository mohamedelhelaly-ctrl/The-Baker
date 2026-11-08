import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { api } from "../../lib/api";
import { s } from "../../lib/strings";
import type { MessageResponse } from "../../lib/types";
import { AuthCard } from "./AuthCard";
import { ErrorSummary } from "./ErrorSummary";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    const res = await api.post<MessageResponse>("/auth/forgot-password", { email });
    setDone(res.message);
  });

  return (
    <AuthCard title={s.auth.forgotTitle}>
      {done ? (
        <Alert kind="success">{done}</Alert>
      ) : (
        <>
          <p className="mb-5">{s.auth.forgotIntro}</p>
          <ErrorSummary error={error} summaryRef={summaryRef} />
          <form onSubmit={onSubmit} noValidate>
            <TextField label={s.auth.email} type="email" name="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} error={error?.fields.email} />
            <Button type="submit" disabled={pending}>
              {s.auth.forgotSubmit}
            </Button>
          </form>
        </>
      )}
      <p className="mt-6">
        <Link to="/login" className="underline">
          {s.auth.backToSignIn}
        </Link>
      </p>
    </AuthCard>
  );
}
