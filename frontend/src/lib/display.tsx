import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type TextSize = "100" | "125" | "150";

interface Prefs {
  textSize: TextSize;
  highContrast: boolean;
  reduceMotion: boolean;
}

interface DisplayContextValue extends Prefs {
  setTextSize: (v: TextSize) => void;
  setHighContrast: (v: boolean) => void;
  setReduceMotion: (v: boolean) => void;
}

const KEY = "baker.display";
const DEFAULTS: Prefs = { textSize: "100", highContrast: false, reduceMotion: false };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const DisplayContext = createContext<DisplayContextValue | null>(null);

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);

  // Preferences are CSS custom-property themes selected by attributes on <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textSize = prefs.textSize;
    root.dataset.contrast = prefs.highContrast ? "high" : "normal";
    root.dataset.motion = prefs.reduceMotion ? "reduce" : "normal";
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* preference lasts until reload */
    }
  }, [prefs]);

  const value = useMemo<DisplayContextValue>(
    () => ({
      ...prefs,
      setTextSize: (textSize) => setPrefs((p) => ({ ...p, textSize })),
      setHighContrast: (highContrast) => setPrefs((p) => ({ ...p, highContrast })),
      setReduceMotion: (reduceMotion) => setPrefs((p) => ({ ...p, reduceMotion })),
    }),
    [prefs],
  );
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useDisplay(): DisplayContextValue {
  const ctx = useContext(DisplayContext);
  if (!ctx) throw new Error("useDisplay must be used inside <DisplayProvider>");
  return ctx;
}
