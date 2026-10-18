import type { SceneIntent } from "@tl/api-client";
import { create } from "zustand";
import { useMode } from "../../app/modeStore";
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

export interface SceneState {
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
  /** Route id the user asked to re-centre on (Show on map); the camera subscribes. */
  focusRouteRequest: string | null;
  selectedPlaceId: string | null;
  selectedFloodEdgeId: string | null;
  /** A shop sign picked in the Three.js city; its source card is shown. */
  selectedSignId: string | null;
  /** A building or landmark picked in the Three.js city (a building id or a landmark feature id). */
  selectedBuildingId: string | null;
  route: { id: string; geojson: GeoJSON.LineString } | null;
  /** A what-if diff (imagined, never a real route): before/after lines and imagined changes. */
  whatIf: { geojson: { type: string; features: unknown[] } } | null;
  /** Rising-river rollout playback: synthetic residents on the map (simulation, not a forecast). */
  rollout: { on: boolean; stage: number; playing: boolean };
  setRollout: (r: Partial<SceneState["rollout"]>) => void;
  /** Elmina Day playback: synthetic residents living a day (a rehearsal, not a forecast).
   * `t` is the clock in minutes after midnight; `focus` a spotlight resident; `before` what was
   * on screen when the assistant opened the day (day.show), restored when it stops. */
  day: {
    on: boolean;
    scenario: string;
    t: number;
    playing: boolean;
    focus: string | null;
    before: { scenarioId: string | null; flood: boolean } | null;
  };
  setDay: (d: Partial<SceneState["day"]>) => void;
  /** A resident's own rehearsed trip (day.trip intent or "Rehearse my trip"): its geojson
   * (normal route, the trip with minutes, flooded pieces) and meta for the departure strip. */
  myTrip: { geojson: unknown } | null;
  setMyTrip: (geojson: unknown | null) => void;
  /** The river level follows the day's clock without clearing routes or what-ifs. */
  setDayStage: (scenarioId: string | null) => void;
  camera: { center: [number, number]; rangeM: number } | null;
  intents: SceneIntent[];
  applyIntent: (i: SceneIntent) => void;
  requestRouteFocus: (id: string) => void;
  selectPlace: (id: string | null) => void;
  selectFloodEdge: (id: string | null) => void;
  selectSign: (id: string | null) => void;
  selectBuilding: (id: string | null) => void;
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
  focusRouteRequest: null as string | null,
  selectedPlaceId: null as string | null,
  selectedFloodEdgeId: null as string | null,
  selectedSignId: null as string | null,
  selectedBuildingId: null as string | null,
  route: null as SceneState["route"],
  whatIf: null as SceneState["whatIf"],
  myTrip: null as SceneState["myTrip"],
  rollout: { on: false, stage: 0, playing: false } as SceneState["rollout"],
  day: {
    on: false,
    scenario: "storm",
    t: 6 * 60,
    playing: false,
    focus: null,
    before: null,
  } as SceneState["day"],
  camera: null as SceneState["camera"],
  intents: [] as SceneIntent[],
  mapStyle: "realistic" as MapStyle,
  mapStyleChosen: false,
};

/** A river level from an intent; a what-if diff compared at another level no longer matches. */
function floodLevel(s: SceneState, scenarioId: string | null): Partial<SceneState> {
  const out: Partial<SceneState> = {
    scenarioId,
    lensVisible: { ...s.lensVisible, flood: true },
  };
  const m = (s.whatIf?.geojson as { meta?: Record<string, unknown> } | undefined)?.meta;
  const stages = [m?.scenario_id, m?.base_scenario_id].filter(Boolean);
  if (s.whatIf && !stages.includes(scenarioId ?? undefined)) out.whatIf = null;
  return out;
}

type Selection =
  | "selectedPlaceId"
  | "selectedFloodEdgeId"
  | "selectedSignId"
  | "selectedBuildingId";
const SELECTIONS: Selection[] = [
  "selectedPlaceId",
  "selectedFloodEdgeId",
  "selectedSignId",
  "selectedBuildingId",
];
/** Sets one selection; a non-null one clears the other three (a null one leaves them). */
function only(s: SceneState, key: Selection, id: string | null): Partial<SceneState> {
  const out: Partial<SceneState> = { [key]: id };
  for (const k of SELECTIONS) if (k !== key) out[k] = id ? null : s[k];
  return out;
}

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
        case "day.show":
          // the rehearsal an answer came from, paused at its peak, with its river stage; the
          // day lives in Management mode, so elsewhere only the river stage is shown
          if (useMode.getState().mode === "management")
            next.day = {
              ...s.day,
              on: true,
              playing: false,
              focus: null,
              scenario: i.day ?? s.day.scenario,
              t: typeof i.t_min === "number" ? i.t_min : s.day.t,
              // what is on screen now comes back when the day stops (not the day's own stage)
              before: s.day.on
                ? s.day.before
                : { scenarioId: s.scenarioId, flood: s.lensVisible.flood },
            };
          if (i.scenario_id) Object.assign(next, floodLevel(s, i.scenario_id));
          break;
        case "day.trip":
          // a resident's own trip: the rehearsal opens at the time they leave (in any mode),
          // with that minute's river stage, and their trip is drawn
          next.day = {
            ...s.day,
            on: true,
            playing: false,
            focus: null,
            scenario: i.day ?? s.day.scenario,
            t: typeof i.t_min === "number" ? i.t_min : s.day.t,
            before: s.day.on
              ? s.day.before
              : { scenarioId: s.scenarioId, flood: s.lensVisible.flood },
          };
          next.myTrip = i.geojson ? { geojson: i.geojson } : null;
          Object.assign(next, floodLevel(s, i.scenario_id ?? null));
          break;
        case "flood.set_level":
          Object.assign(next, floodLevel(s, i.scenario_id ?? null));
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
  // One detail panel at a time: opening any of the four closes the others.
  selectPlace: (selectedPlaceId) => set((s) => only(s, "selectedPlaceId", selectedPlaceId)),
  selectFloodEdge: (id) => set((s) => only(s, "selectedFloodEdgeId", id)),
  selectSign: (id) => set((s) => only(s, "selectedSignId", id)),
  selectBuilding: (id) => set((s) => only(s, "selectedBuildingId", id)),
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
  // A new style may mean a new renderer (Three.js crashed -> Realistic tries Cesium again).
  setMapStyle: (mapStyle) =>
    set((s) => ({
      mapStyle,
      mapStyleChosen: true,
      ...(s.mapStyle !== mapStyle ? { rendererFailed: false } : {}),
    })),
  applyDefaultMapStyle: (hasBuildings, hasGoogle) =>
    set((s) => (s.mapStyleChosen ? {} : { mapStyle: defaultMapStyle(hasBuildings, hasGoogle) })),
  requestRouteFocus: (id) => {
    // Reset first so asking for the same route twice still changes state for subscribers.
    set({ focusRouteRequest: null });
    set({ focusRouteRequest: id });
  },
  clearRoute: () => set({ route: null }),
  clearWhatIf: () => set({ whatIf: null }),
  setRollout: (r) => set((s) => ({ rollout: { ...s.rollout, ...r } })),
  setDay: (d) => set((s) => ({ day: { ...s.day, ...d } })),
  setMyTrip: (geojson) => set({ myTrip: geojson ? { geojson } : null }),
  setDayStage: (scenarioId) =>
    set((s) =>
      s.scenarioId === scenarioId
        ? {}
        : { scenarioId, lensVisible: { ...s.lensVisible, flood: true } },
    ),
  reset: () => set(initial),
}));
