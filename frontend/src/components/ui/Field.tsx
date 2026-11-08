import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const control = "min-h-11 w-full rounded-md border-2 bg-surface px-3 py-2";

function Wrap({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
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
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 flex gap-1 font-medium text-danger">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}

function describe(id: string, hint?: string, error?: string) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

interface Common {
  label: string;
  hint?: string;
  error?: string;
}

export function TextAreaField({ label, hint, error, ...props }: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <textarea
        {...props}
        id={id}
        rows={props.rows ?? 4}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe(id, hint, error)}
        className={`${control} ${error ? "border-danger" : "border-line"}`}
      />
    </Wrap>
  );
}

export function SelectField({ label, hint, error, children, ...props }: Common & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe(id, hint, error)}
        className={`${control} ${error ? "border-danger" : "border-line"}`}
      >
        {children}
      </select>
    </Wrap>
  );
}

export function CheckboxField({ label, hint, ...props }: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 font-semibold">
        <input {...props} id={id} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} className="size-5" />
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="ms-8 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
