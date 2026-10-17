import { create } from "zustand";

/** The look actually shown (3D map mood). */
export type Theme = "day" | "dusk" | "night";
/** What the user picked: Auto follows the Elmina clock. */
export type ThemeChoice = "auto" | Theme;
/** UI chrome: Day and Dusk share the light chrome; they differ only in the 3D map. */
export type Skin = "light" | "dark";

const KEY = "tl.theme";
const CHOICES: readonly ThemeChoice[] = ["auto", "day", "dusk", "night"];

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const KL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Elmina wall-clock mood: Day 07:00-18:00, Dusk 18:00-19:30, Night 19:30-07:00. Display only. */
export function themeAt(d: Date): Theme {
  const parts = KL.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = h * 60 + m;
  if (mins >= 7 * 60 && mins < 18 * 60) return "day";
  if (mins >= 18 * 60 && mins < 19 * 60 + 30) return "dusk";
  return "night";
}

export const skinFor = (t: Theme): Skin => (t === "night" ? "dark" : "light");

/** Stored choice (legacy "day"/"night" included), else Auto. Never throws. */
export function loadChoice(store: Store | undefined = browserStore()): ThemeChoice {
  try {
    const v = store?.getItem(KEY);
    if (v && (CHOICES as readonly string[]).includes(v)) return v as ThemeChoice;
  } catch {
    /* storage unavailable */
  }
  return "auto";
}

const resolve = (c: ThemeChoice, now: Date): Theme => (c === "auto" ? themeAt(now) : c);

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
  el.dataset.skin = skinFor(t);
}

interface ThemeState {
  choice: ThemeChoice;
  theme: Theme;
  setChoice: (c: ThemeChoice) => void;
  /** Re-evaluate Auto against the clock (called by the clock timer). */
  refresh: (now?: Date) => void;
}

const initialChoice = loadChoice();

export const useTheme = create<ThemeState>((set, get) => ({
  choice: initialChoice,
  theme: resolve(initialChoice, new Date()),
  setChoice: (choice) => {
    try {
      browserStore()?.setItem(KEY, choice);
    } catch {
      /* per-viewer convenience only */
    }
    const theme = resolve(choice, new Date());
    if (typeof document !== "undefined") applyTheme(theme);
    set({ choice, theme });
  },
  refresh: (now = new Date()) => {
    const { choice, theme } = get();
    const next = resolve(choice, now);
    if (next === theme) return;
    if (typeof document !== "undefined") applyTheme(next);
    set({ theme: next });
  },
}));

/** Re-checks Auto every `intervalMs` from the real clock (a backgrounded tab is right on return). */
export function startThemeClock(intervalMs = 60_000): () => void {
  const id = setInterval(() => useTheme.getState().refresh(new Date()), intervalMs);
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible")
      useTheme.getState().refresh(new Date());
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisible);
  };
}
