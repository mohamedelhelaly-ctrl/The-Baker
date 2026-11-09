import type { ReactNode } from "react";
import { useEffect } from "react";

/** Shared frame for auth pages: sets the document title and the single h1. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · The Baker`;
  }, [title]);
  return (
    <div className="mx-auto max-w-md py-4 sm:py-10">
      <h1 className="mb-6 text-center font-display text-4xl font-bold">{title}</h1>
      <div className="card p-6 sm:p-8">{children}</div>
    </div>
  );
}
