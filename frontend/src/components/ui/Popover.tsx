import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface Props {
  /** What the button shows. */
  button: ReactNode;
  /** The button's accessible name, when the visible text alone is not enough. */
  label?: string;
  children: ReactNode;
  align?: "start" | "end";
  width?: string;
  buttonClassName?: string;
}

/**
 * A button that opens a panel (a disclosure, not an ARIA menu): Escape or a click outside closes it and
 * focus returns to the button, and following a link or pressing something marked `data-close` inside closes it.
 */
export function Popover({ button, label, children, align = "end", width = "w-72", buttonClassName = "btn btn-secondary" }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Following a link, or pressing something marked data-close, inside the panel closes it.
    const panel = panelRef.current;
    const onPanelClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a, [data-close]")) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    panel?.addEventListener("click", onPanelClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      panel?.removeEventListener("click", onPanelClick);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={panelId} aria-label={label} onClick={() => setOpen((v) => !v)} className={buttonClassName}>
        {button}
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m3 6 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className={`card absolute z-40 mt-2 max-w-[calc(100vw-2rem)] p-4 ${width} ${align === "end" ? "end-0" : "start-0"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
