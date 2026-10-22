import { create } from "zustand";
import type { Tier } from "./shared/quality";

export type QualityChoice = "auto" | Tier;
const MOTION = "tl.motion";
const QUALITY = "tl.quality";
const PATH_STATUS = "tl.pathStatus";
const FX = "tl.fx";
const ROAD_NAMES = "tl.roadNames";

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
const storedPathStatus = read(PATH_STATUS);
const storedFx = read(FX);
const storedRoadNames = read(ROAD_NAMES);

interface SceneSettings {
  motion: boolean;
  quality: QualityChoice;
  /** Draw the per-edge status lines (and their legend rows). Off by default: with strict profiles
   * almost every edge is "Not checked yet", so the lines would colour the whole city. */
  pathStatus: boolean;
  /**
   * FX: the tilt-shift depth of field (B-T5). On by default; it also needs High quality and no
   * prefers-reduced-motion (`three/tiltShift.ts` dofActive).
   */
  fx: boolean;
  /** Road names on the map (T-028; `GET /layers/road-labels`). On by default. */
  roadNames: boolean;
  setRoadNames: (v: boolean) => void;
  setMotion: (v: boolean) => void;
  setFx: (v: boolean) => void;
  setQuality: (q: QualityChoice) => void;
  setPathStatus: (v: boolean) => void;
}

export const useSceneSettings = create<SceneSettings>((set) => ({
  motion: storedMotion === null ? !prefersReducedMotion() : storedMotion === "true",
  quality: (["auto", "high", "medium", "low"] as const).includes(storedQuality as QualityChoice)
    ? (storedQuality as QualityChoice)
    : "auto",
  pathStatus: storedPathStatus === "true",
  fx: storedFx !== "false",
  roadNames: storedRoadNames !== "false",
  setRoadNames: (roadNames) => {
    write(ROAD_NAMES, String(roadNames));
    set({ roadNames });
  },
  setFx: (fx) => {
    write(FX, String(fx));
    set({ fx });
  },
  setMotion: (motion) => {
    write(MOTION, String(motion));
    set({ motion });
  },
  setQuality: (quality) => {
    write(QUALITY, quality);
    set({ quality });
  },
  setPathStatus: (pathStatus) => {
    write(PATH_STATUS, String(pathStatus));
    set({ pathStatus });
  },
}));
