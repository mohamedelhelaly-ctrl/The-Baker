interface Props {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/** Previous / next with the current position spelled out, so it works without sight or a mouse. */
export function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-4">
      <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span aria-live="polite" className="text-muted">
        Page {page} of {totalPages}
      </span>
      <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </nav>
  );
}
