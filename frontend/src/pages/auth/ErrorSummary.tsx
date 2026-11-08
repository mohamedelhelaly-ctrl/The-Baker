import type { Ref } from "react";
import { Alert } from "../../components/ui/Alert";
import { s } from "../../lib/strings";

export function ErrorSummary({
  error,
  summaryRef,
}: {
  error: { message: string; fields: Record<string, string> } | null;
  summaryRef: Ref<HTMLDivElement>;
}) {
  if (!error) return null;
  const fieldMessages = Object.values(error.fields);
  return (
    <Alert kind="error" title={s.auth.errorSummary} ref={summaryRef}>
      {fieldMessages.length > 0 ? (
        <ul className="ms-5 list-disc">
          {fieldMessages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        <p>{error.message}</p>
      )}
    </Alert>
  );
}
