import { useEffect, useId, useRef, useState } from "react";
import { useDisplay, type TextSize } from "../../lib/display";
import { s } from "../../lib/strings";

/** Text size, high contrast and reduced motion (DESIGN.md §10.2). A disclosure, not a menu role. */
export function DisplayMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const d = useDisplay();

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
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 rounded-md border-2 border-line px-3 font-semibold"
      >
        {s.display.button}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute end-0 z-20 mt-2 w-64 rounded-md border-2 border-line bg-surface p-4 shadow-lg"
        >
          <fieldset className="mb-3">
            <legend className="mb-1 font-semibold">{s.display.textSize}</legend>
            {(["100", "125", "150"] as TextSize[]).map((size) => (
              <label key={size} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="text-size"
                  checked={d.textSize === size}
                  onChange={() => d.setTextSize(size)}
                />
                {s.display.sizes[size]}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={d.highContrast} onChange={(e) => d.setHighContrast(e.target.checked)} />
            {s.display.contrast}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={d.reduceMotion} onChange={(e) => d.setReduceMotion(e.target.checked)} />
            {s.display.motion}
          </label>
        </div>
      )}
    </div>
  );
}
