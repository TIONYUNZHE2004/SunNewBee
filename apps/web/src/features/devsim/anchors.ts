import { create } from "zustand";
import type { Probe, Rect } from "./types";

/**
 * Screen anchors for the DOM overlays, written by the 3D lane each frame (CSS px relative to the
 * stage). Null when the subject is off screen or not drawn.
 */
export interface DevsimAnchorsState {
  tower: Rect | null;
  towerTop: [number, number] | null;
  speaker: Rect | null;
  speakerHead: [number, number] | null;
  labelPoint: [number, number] | null;
  set: (partial: Partial<Omit<DevsimAnchorsState, "set" | "clear">>) => void;
  clear: () => void;
}

const none = { tower: null, towerTop: null, speaker: null, speakerHead: null, labelPoint: null };

export const useDevsimAnchors = create<DevsimAnchorsState>((set) => ({
  ...none,
  set: (partial) => set(partial),
  clear: () => set({ ...none }),
}));

type ProbePart = () => Partial<Probe>;
const parts: { scene: ProbePart | null; dom: ProbePart | null } = { scene: null, dom: null };

function register(key: keyof typeof parts, fn: ProbePart): () => void {
  parts[key] = fn;
  return () => {
    if (parts[key] === fn) parts[key] = null;
  };
}

/** The 3D lane's part of the probe (tower/speaker rects, people, vehicles, camera). Returns unregister. */
export function registerProbe(_part: "scene", fn: ProbePart): () => void {
  return register("scene", fn);
}

/** True while a probe part is registered (e.g. the 3D scene part). */
export function hasProbe(part: keyof typeof parts): boolean {
  return parts[part] !== null;
}

/** The DOM overlays' part of the probe (bubble, labels, badge rects). Returns unregister. */
export function registerDomProbe(fn: ProbePart): () => void {
  return register("dom", fn);
}

/** `window.__devsim.probe()`: merges the scene and DOM parts at time t; rects merge per key. */
export function collectProbe(t: number): Probe {
  const scene = parts.scene?.() ?? {};
  const dom = parts.dom?.() ?? {};
  return {
    people: [],
    vehicles: [],
    cameraInsideBuilding: false,
    windowsLitFraction: 0,
    ...scene,
    ...dom,
    t,
    rects: { ...scene.rects, ...dom.rects },
  };
}
