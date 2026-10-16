import { create } from "zustand";
import type { Tier } from "./cesium/stylised/quality";

export type QualityChoice = "auto" | Tier;
const MOTION = "tl.motion";
const QUALITY = "tl.quality";

const read = (k: string) => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-viewer convenience only */
  }
};
export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const storedMotion = read(MOTION);
const storedQuality = read(QUALITY);

interface SceneSettings {
  motion: boolean;
  quality: QualityChoice;
  setMotion: (v: boolean) => void;
  setQuality: (q: QualityChoice) => void;
}

export const useSceneSettings = create<SceneSettings>((set) => ({
  motion: storedMotion === null ? !prefersReducedMotion() : storedMotion === "true",
  quality: (["auto", "high", "medium", "low"] as const).includes(storedQuality as QualityChoice)
    ? (storedQuality as QualityChoice)
    : "auto",
  setMotion: (motion) => {
    write(MOTION, String(motion));
    set({ motion });
  },
  setQuality: (quality) => {
    write(QUALITY, quality);
    set({ quality });
  },
}));
