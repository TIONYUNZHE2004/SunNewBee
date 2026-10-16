import type { SceneIntent } from "@tl/api-client";
import { create } from "zustand";
import { loadProfile, saveProfile } from "../../lib/profileStore";
import type { View } from "./selectView";

export type Profile = "default" | "stroller" | "wheelchair" | "older_adult_rest" | "drive";
export type Lens = "access" | "flood" | "waste";
export type MapStyle = "realistic" | "stylised";

/** Pure: the map style before the user picks one. Stylised whenever the world has buildings data
 * (it needs no key and makes no billable tile loads); otherwise realistic (the old chain). */
export function defaultMapStyle(hasBuildings: boolean, _hasGoogle: boolean): MapStyle {
  return hasBuildings ? "stylised" : "realistic";
}

/**
 * Pure: the style actually drawn. The user's choice wins when it is possible; Stylised needs
 * buildings data and "Realistic photos (Google)" needs a Google key, so an impossible choice falls
 * back to the other. Not chosen yet: the default rule (also covers the commit before the store
 * default is applied, so no realistic tiles are requested in between).
 */
export function resolveMapStyle(
  s: { mapStyle: MapStyle; mapStyleChosen: boolean },
  hasBuildings: boolean,
  hasGoogle: boolean,
): MapStyle {
  const want = s.mapStyleChosen ? s.mapStyle : defaultMapStyle(hasBuildings, hasGoogle);
  if (want === "stylised" && !hasBuildings) return "realistic";
  if (want === "realistic" && !hasGoogle && hasBuildings) return "stylised";
  return want;
}

interface SceneState {
  view: View;
  /** True when the 3D renderer crashed and the list fallback is showing (set by MapStage). */
  rendererFailed: boolean;
  setRendererFailed: (f: boolean) => void;
  lensVisible: Record<Lens, boolean>;
  /** Gap map overlay (AX-09). Separate from the lenses: it is not part of the intent contract. */
  gapsVisible: boolean;
  profile: Profile;
  scenarioId: string | null;
  focusPlaceId: string | null;
  selectedPlaceId: string | null;
  selectedFloodEdgeId: string | null;
  route: { id: string; geojson: GeoJSON.LineString } | null;
  /** A what-if diff (imagined, never a real route): before/after lines and imagined changes. */
  whatIf: { geojson: { type: string; features: unknown[] } } | null;
  /** Rising-river rollout playback: synthetic residents on the map (simulation, not a forecast). */
  rollout: { on: boolean; stage: number; playing: boolean };
  setRollout: (r: Partial<SceneState["rollout"]>) => void;
  camera: { center: [number, number]; rangeM: number } | null;
  intents: SceneIntent[];
  applyIntent: (i: SceneIntent) => void;
  selectPlace: (id: string | null) => void;
  selectFloodEdge: (id: string | null) => void;
  setView: (v: View) => void;
  setProfile: (p: Profile) => void;
  setScenario: (s: string | null) => void;
  toggleLens: (l: Lens) => void;
  setGaps: (on: boolean) => void;
  toggleGaps: () => void;
  mapStyle: MapStyle;
  /** True once the user picked a style (Settings); the default rule never overrides it. */
  mapStyleChosen: boolean;
  /** Called from the UI only: records the user's choice. */
  setMapStyle: (s: MapStyle) => void;
  /** Apply `defaultMapStyle` once buildings data has settled, unless the user chose. */
  applyDefaultMapStyle: (hasBuildings: boolean, hasGoogle: boolean) => void;
  clearRoute: () => void;
  clearWhatIf: () => void;
  reset: () => void;
}

const initial = {
  view: "list" as View,
  rendererFailed: false,
  lensVisible: { access: true, flood: false, waste: false } as Record<Lens, boolean>,
  gapsVisible: false,
  profile: loadProfile(),
  scenarioId: null as string | null,
  focusPlaceId: null as string | null,
  selectedPlaceId: null as string | null,
  selectedFloodEdgeId: null as string | null,
  route: null as SceneState["route"],
  whatIf: null as SceneState["whatIf"],
  rollout: { on: false, stage: 0, playing: false } as SceneState["rollout"],
  camera: null as SceneState["camera"],
  intents: [] as SceneIntent[],
  mapStyle: "realistic" as MapStyle,
  mapStyleChosen: false,
};

export const useScene = create<SceneState>((set) => ({
  ...initial,
  applyIntent: (i) =>
    set((s) => {
      const next: Partial<SceneState> = { intents: [...s.intents, i] };
      switch (i.kind) {
        case "route.highlight":
          if (i.route_id && i.geojson) {
            next.route = { id: i.route_id, geojson: i.geojson as unknown as GeoJSON.LineString };
            next.whatIf = null; // a real route is never drawn under an older imagined diff
          }
          break;
        case "whatif.diff":
          if (i.geojson)
            next.whatIf = {
              geojson: i.geojson as unknown as { type: string; features: unknown[] },
            };
          break;
        case "river.rollout":
          next.rollout = { on: true, stage: 0, playing: true };
          break;
        case "place.focus":
          next.focusPlaceId = i.place_id ?? null;
          break;
        case "flood.set_level": {
          next.scenarioId = i.scenario_id ?? null;
          next.lensVisible = { ...s.lensVisible, flood: true };
          // A diff compared at another river level no longer matches the map: clear it.
          const m = (s.whatIf?.geojson as { meta?: Record<string, unknown> } | undefined)?.meta;
          const stages = [m?.scenario_id, m?.base_scenario_id].filter(Boolean);
          if (s.whatIf && !stages.includes(next.scenarioId ?? undefined)) next.whatIf = null;
          break;
        }
        case "camera.fly_to":
          if (i.center && i.center.length >= 2)
            next.camera = {
              center: [i.center[0] as number, i.center[1] as number],
              rangeM: i.range_m ?? 1500,
            };
          break;
        case "layer.toggle":
          if (i.lens)
            next.lensVisible = { ...s.lensVisible, [i.lens]: i.visible ?? !s.lensVisible[i.lens] };
          break;
      }
      return next;
    }),
  // One detail panel at a time: opening either closes the other.
  selectPlace: (selectedPlaceId) =>
    set((s) => ({
      selectedPlaceId,
      selectedFloodEdgeId: selectedPlaceId ? null : s.selectedFloodEdgeId,
    })),
  selectFloodEdge: (selectedFloodEdgeId) =>
    set((s) => ({
      selectedFloodEdgeId,
      selectedPlaceId: selectedFloodEdgeId ? null : s.selectedPlaceId,
    })),
  setView: (view) => set({ view, rendererFailed: false }),
  setRendererFailed: (rendererFailed) => set({ rendererFailed }),
  setProfile: (profile) => {
    saveProfile(profile);
    // A highlighted route was planned for the previous persona; do not show it as this one's.
    set({ profile, route: null, whatIf: null });
  },
  setScenario: (scenarioId) =>
    set((s) => ({
      scenarioId,
      route: null, // planned under the previous scenario
      whatIf: null, // compared against the previous scenario
      selectedFloodEdgeId: null,
      lensVisible: { ...s.lensVisible, flood: !!scenarioId || s.lensVisible.flood },
    })),
  toggleLens: (l) => set((s) => ({ lensVisible: { ...s.lensVisible, [l]: !s.lensVisible[l] } })),
  setGaps: (gapsVisible) => set({ gapsVisible }),
  toggleGaps: () => set((s) => ({ gapsVisible: !s.gapsVisible })),
  setMapStyle: (mapStyle) => set({ mapStyle, mapStyleChosen: true }),
  applyDefaultMapStyle: (hasBuildings, hasGoogle) =>
    set((s) => (s.mapStyleChosen ? {} : { mapStyle: defaultMapStyle(hasBuildings, hasGoogle) })),
  clearRoute: () => set({ route: null }),
  clearWhatIf: () => set({ whatIf: null }),
  setRollout: (r) => set((s) => ({ rollout: { ...s.rollout, ...r } })),
  reset: () => set(initial),
}));
