import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import { s } from "../lib/strings";

interface FormError {
  message: string;
  fields: Record<string, string>;
}

/**
 * Submit handling shared by the auth forms: pending state, API errors split into a summary
 * plus per-field messages, and focus moved to the summary when something fails.
 */
export function useFormSubmit(action: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) summaryRef.current?.focus();
  }, [error]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, fields: err.fields ?? {} });
      else setError({ message: s.errors.generic, fields: {} });
    } finally {
      setPending(false);
    }
  }

  return { pending, error, summaryRef, onSubmit };
}
