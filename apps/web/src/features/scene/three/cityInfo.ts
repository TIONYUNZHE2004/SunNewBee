import { create } from "zustand";
import type { Manifest } from "./assets/manifest";

/**
 * What the Three.js city is drawing now, for the building card: the manifest (landmark design
 * heights) and which buildings are extruded fallbacks. `extruded: null` means every building is a
 * simple block (no city assets: `?assets=0`, a failed load, or before they arrive).
 */
export interface CityInfo {
  manifest: Manifest | null;
  extruded: ReadonlySet<string> | null;
}

export const useCityInfo = create<CityInfo>(() => ({ manifest: null, extruded: null }));

/** True when the building is drawn as an extruded block (a fallback), not an archetype model. */
export const isFallback = (info: CityInfo, id: string): boolean =>
  info.extruded === null || info.extruded.has(id);
