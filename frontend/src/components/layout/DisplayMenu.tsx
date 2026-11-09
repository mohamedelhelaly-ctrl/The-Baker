import { useDisplay, type TextSize } from "../../lib/display";
import { s } from "../../lib/strings";
import { Popover } from "../ui/Popover";

/** Text size, high contrast and reduced motion (DESIGN.md §10.2). */
export function DisplayMenu() {
  const d = useDisplay();
  return (
    <Popover
      button={
        <>
          <span className="hidden sm:inline">{s.display.button}</span>
          <span aria-hidden="true" className="font-display font-bold sm:hidden">
            Aa
          </span>
        </>
      }
      label={s.display.button}
      buttonClassName="navlink"
      width="w-64"
    >
      <fieldset className="mb-3">
        <legend className="mb-1 font-semibold">{s.display.textSize}</legend>
        {(["100", "125", "150"] as TextSize[]).map((size) => (
          <label key={size} className="flex min-h-11 items-center gap-3">
            <input type="radio" name="text-size" className="size-5 accent-[var(--primary)]" checked={d.textSize === size} onChange={() => d.setTextSize(size)} />
            {s.display.sizes[size]}
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={d.highContrast} onChange={(e) => d.setHighContrast(e.target.checked)} />
        {s.display.contrast}
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={d.reduceMotion} onChange={(e) => d.setReduceMotion(e.target.checked)} />
        {s.display.motion}
      </label>
    </Popover>
  );
}
