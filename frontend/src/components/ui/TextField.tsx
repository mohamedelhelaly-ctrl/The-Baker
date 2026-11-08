import { useId, useState, type InputHTMLAttributes } from "react";
import { s } from "../../lib/strings";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
}

/** Visible label, linked hint and error, autocomplete passed through (WCAG 1.3.5, 3.3.1). */
export function TextField({ label, error, hint, type = "text", ...input }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="flex gap-2">
        <input
          {...input}
          id={id}
          type={isPassword && shown ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-11 w-full rounded-md border-2 bg-surface px-3 py-2 ${
            error ? "border-danger" : "border-line"
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-pressed={shown}
            className="min-h-11 shrink-0 rounded-md border-2 border-line px-3 text-sm font-semibold"
          >
            {s.auth.showPassword}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 flex gap-1 font-medium text-danger">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}
