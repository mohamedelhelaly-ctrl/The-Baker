interface Props {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/** Previous / next with the current position spelled out, so it works without sight or a mouse. */
export function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  const btn = "min-h-11 rounded-md border-2 border-line px-4 font-semibold disabled:opacity-50";
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-4">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button type="button" className={btn} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </nav>
  );
}
