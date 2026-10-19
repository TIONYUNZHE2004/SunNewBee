import { useState } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { createAmbient } from "../ambient/ambient";
import type { MoodWeights } from "../mood";
import type { MotionDriver } from "../motion/motionClock";

/**
 * The one mutable slice the three.js view's hooks share, for the mood / ambient / driver cycle
 * (the mood loop feeds the driver and the ambient layer, the driver ticks the ambient layer).
 * Read with `getState()` from effects and callbacks; nothing subscribes, so writes never re-render.
 */
export interface SceneBusState {
  /** The mood weights last applied by the mood loop. */
  mood: MoodWeights;
  /** Birds and cloud shadows, while drawn (useDecor). */
  ambient: ReturnType<typeof createAmbient> | null;
  /** The motion driver, while the engine holds one (useMotion). */
  driver: MotionDriver | null;
}
export type SceneBus = StoreApi<SceneBusState>;

export const createSceneBus = (): SceneBus =>
  createStore<SceneBusState>(() => ({
    mood: { day: 1, dusk: 0, night: 0 },
    ambient: null,
    driver: null,
  }));

/** One bus per mounted three.js view (a remount or a second view never shares one). */
export function useSceneBus(): SceneBus {
  const [bus] = useState(createSceneBus);
  return bus;
}
