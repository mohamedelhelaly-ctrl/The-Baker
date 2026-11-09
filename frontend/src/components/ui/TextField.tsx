import { useId, useState, type InputHTMLAttributes } from "react";
import { s } from "../../lib/strings";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
  hideLabel?: boolean; // keep the label for screen readers but do not show it (the surrounding text says it)
}

/** Visible label, linked hint and error, autocomplete passed through (WCAG 1.3.5, 3.3.1). */
export function TextField({ label, error, hint, hideLabel, type = "text", ...input }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mb-5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1.5 block font-semibold"}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          {...input}
          id={id}
          type={isPassword && shown ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="control"
        />
        {isPassword && (
          <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} className="btn btn-secondary shrink-0 px-4 text-sm">
            {s.auth.showPassword}
          </button>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 flex gap-1.5 font-medium text-danger">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}
