import type { ReactNode } from "react";
import { useEffect } from "react";

/** Shared frame for auth pages: sets the document title and the single h1. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · The Baker`;
  }, [title]);
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 font-display text-3xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
