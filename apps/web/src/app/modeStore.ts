import { create } from "zustand";

export type Mode = "resident" | "management";

export const useMode = create<{ mode: Mode; setMode: (m: Mode) => void }>((set) => ({
  mode: "resident",
  setMode: (mode) => set({ mode }),
}));
