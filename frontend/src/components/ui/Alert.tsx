import { forwardRef, type ReactNode } from "react";

interface Props {
  kind: "error" | "success";
  title?: string;
  children: ReactNode;
}

/** Icon + text, never colour alone (WCAG 1.4.1). Errors are announced; focusable for the error summary. */
export const Alert = forwardRef<HTMLDivElement, Props>(function Alert({ kind, title, children }, ref) {
  const isError = kind === "error";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={isError ? "alert" : "status"}
      className={`mb-5 rounded-xl border border-l-4 p-4 ${
        isError ? "border-danger bg-danger-bg text-danger" : "border-success bg-success-bg text-success"
      }`}
    >
      {title && (
        <p className="font-semibold">
          <span aria-hidden="true">{isError ? "⚠ " : "✓ "}</span>
          {title}
        </p>
      )}
      <div>{children}</div>
    </div>
  );
});
