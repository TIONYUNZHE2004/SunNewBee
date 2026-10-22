import { create } from "zustand";
import type { Probe, Rect } from "./types";

/**
 * Screen anchors for the DOM overlays, written by the 3D lane each frame (CSS px relative to the
 * stage). Null when the subject is off screen or not drawn.
 */
export interface DevsimAnchorsState {
  tower: Rect | null;
  towerTop: [number, number] | null;
  /** The first bubble's speaker (`bubbles[0]`): kept for the probe and the demo hook. */
  speaker: Rect | null;
  speakerHead: [number, number] | null;
  /**
   * Every speaker of a bubble shown now that the 3D view draws (rect and head point), by cast id:
   * each bubble anchors at its own speaker when two overlap in time (e.g. Zainab and Arjun at
   * 36.5–37 s). Empty when none.
   */
  speakers: readonly { id: string; rect: Rect; head: [number, number] | null }[];
  labelPoint: [number, number] | null;
  /** The parcel's centre on screen during the Brief overview (the site label hangs above it). */
  siteLabel: [number, number] | null;
  /**
   * The other Spotlight Residents drawn now, not speaking (rect and head point), so a bubble keeps
   * off the listener too (e.g. Halim greeting Mei Ling). Empty when none.
   */
  others: readonly { id: string; rect: Rect; head: [number, number] }[];
  /**
   * The plan's timed tags (`plan.tags[].at`, by kind) projected to the stage, when the 3D view
   * projects them; absent: the overlay shows the tags in its stack.
   */
  tagPoints?: Partial<Record<"detour" | "lorry", [number, number] | null>>;
  set: (partial: Partial<Omit<DevsimAnchorsState, "set" | "clear">>) => void;
  clear: () => void;
}

const none = {
  tower: null,
  towerTop: null,
  speaker: null,
  speakerHead: null,
  speakers: [],
  labelPoint: null,
  siteLabel: null,
  others: [],
};

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
