import { create } from "zustand";

const KEY = "tl.panel.open";
const wideNow = () => typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches;
const read = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

type Sheet = "peek" | "half" | "full";

interface PanelState {
  open: boolean;
  setOpen: (v: boolean) => void;
  sheet: Sheet;
  setSheet: (s: Sheet) => void;
}

export const usePanel = create<PanelState>((set) => ({
  // Narrow screens use the bottom sheet, not this panel: `open` starts false there and ignores the
  // stored choice.
  open: wideNow() && read() !== "false",
  setOpen: (open) => {
    try {
      localStorage.setItem(KEY, String(open));
    } catch {
      /* per-viewer convenience only */
    }
    set({ open });
  },
  sheet: "peek",
  setSheet: (sheet) => set({ sheet }),
}));
