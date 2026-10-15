import { create } from "zustand";

export type Theme = "day" | "night";
const KEY = "tl.theme";

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};
const browserMql = (): MediaQueryList | undefined =>
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : undefined;

/** Stored choice, else the device preference (light => day), else night. Never throws. */
export function loadTheme(store: Store | undefined = browserStore(), mql = browserMql()): Theme {
  try {
    const v = store?.getItem(KEY);
    if (v === "day" || v === "night") return v;
  } catch {
    /* storage unavailable */
  }
  return mql?.matches ? "day" : "night";
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    try {
      browserStore()?.setItem(KEY, theme);
    } catch {
      /* per-viewer convenience only */
    }
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "night" ? "day" : "night"),
}));
