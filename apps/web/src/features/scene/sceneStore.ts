import type { SceneIntent } from "@tl/api-client";
import { create } from "zustand";
import { loadProfile, saveProfile } from "../../lib/profileStore";
import type { View } from "./selectView";

export type Profile = "default" | "stroller" | "wheelchair" | "older_adult_rest" | "drive";
export type Lens = "access" | "flood" | "waste";

interface SceneState {
  view: View;
  lensVisible: Record<Lens, boolean>;
  /** Gap map overlay (AX-09). Separate from the lenses: it is not part of the intent contract. */
  gapsVisible: boolean;
  profile: Profile;
  scenarioId: string | null;
  focusPlaceId: string | null;
  selectedPlaceId: string | null;
  selectedFloodEdgeId: string | null;
  route: { id: string; geojson: GeoJSON.LineString } | null;
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
  reset: () => void;
}

const initial = {
  view: "list" as View,
  lensVisible: { access: true, flood: false, waste: false } as Record<Lens, boolean>,
  gapsVisible: false,
  profile: loadProfile(),
  scenarioId: null as string | null,
  focusPlaceId: null as string | null,
  selectedPlaceId: null as string | null,
  selectedFloodEdgeId: null as string | null,
  route: null as SceneState["route"],
  camera: null as SceneState["camera"],
  intents: [] as SceneIntent[],
};

export const useScene = create<SceneState>((set) => ({
  ...initial,
  applyIntent: (i) =>
    set((s) => {
      const next: Partial<SceneState> = { intents: [...s.intents, i] };
      switch (i.kind) {
        case "route.highlight":
          if (i.route_id && i.geojson)
            next.route = { id: i.route_id, geojson: i.geojson as unknown as GeoJSON.LineString };
          break;
        case "place.focus":
          next.focusPlaceId = i.place_id ?? null;
          break;
        case "flood.set_level":
          next.scenarioId = i.scenario_id ?? null;
          next.lensVisible = { ...s.lensVisible, flood: true };
          break;
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
  setView: (view) => set({ view }),
  setProfile: (profile) => {
    saveProfile(profile);
    set({ profile });
  },
  setScenario: (scenarioId) =>
    set((s) => ({
      scenarioId,
      selectedFloodEdgeId: null,
      lensVisible: { ...s.lensVisible, flood: !!scenarioId || s.lensVisible.flood },
    })),
  toggleLens: (l) => set((s) => ({ lensVisible: { ...s.lensVisible, [l]: !s.lensVisible[l] } })),
  setGaps: (gapsVisible) => set({ gapsVisible }),
  toggleGaps: () => set((s) => ({ gapsVisible: !s.gapsVisible })),
  reset: () => set(initial),
}));
