import type { SceneIntent } from "@tl/api-client";
import { create } from "zustand";
import { useMode } from "../../app/modeStore";
import { loadProfile, saveProfile } from "../../lib/profileStore";
import { isDemoPreset } from "../demo/demoFlag";
import { installDevsimHook } from "../devsim/devsimHook";
import { useDevsim } from "../devsim/devsimStore";
import { asDevsimIntent, beginDevsim } from "../devsim/intent";
import { useCompare } from "../journey/compareStore";
import { asCompareIntent, type CompareIntent, isPlayableCompare } from "../journey/compareTypes";
import { useJourney } from "../journey/journeyStore";
import type { JourneyPlan } from "../journey/timeline";
import type { View } from "./selectView";

export type Profile = "default" | "stroller" | "wheelchair" | "older_adult_rest" | "drive";
export type Lens = "access" | "flood" | "waste";
export type MapStyle = "realistic" | "stylised";

/** Pure: the map style before the user picks one. Stylised (drawn by Three.js) whenever the world
 * has buildings data (it needs no key and makes no billable tile loads); otherwise Realistic
 * (Cesium: Google tiles, else Ion). */
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
  /** T-026 closure simulation on the map (Management): course and detour lines, by pressure. */
  closureSim: { geojson: { type: string; features: unknown[] } } | null;
  setClosureSim: (c: SceneState["closureSim"]) => void;
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
  /**
   * The trip plan of the latest journey.play intent (spec §6.2), loaded into the journey store.
   * Not the plan being shown: every renderer reads `useJourney.plan` (Watch the trip can load an
   * older answer's plan; Clear route empties it).
   */
  journey: JourneyPlan | null;
  /**
   * The latest route.compare intent (demo polish §5.3): fastest vs recommended route. Stored only;
   * the compare playback (`useCompare`) loads it when Watch the trip is pressed.
   */
  compare: CompareIntent | null;
  /** Ends a Development Simulation (developer lens): playback lives in `useDevsim`. */
  stopDevsim: () => void;
  intents: SceneIntent[];
  /**
   * `answerId`: the chat answer the intent came with (unset for the UI's own intents). A map
   * intent from the answer that started a Development Simulation never stops it.
   */
  applyIntent: (i: SceneIntent, answerId?: string) => void;
  requestRouteFocus: (id: string) => void;
  selectPlace: (id: string | null) => void;
  selectFloodEdge: (id: string | null) => void;
  selectSign: (id: string | null) => void;
  selectBuilding: (id: string | null) => void;
  setView: (v: View) => void;
  setProfile: (p: Profile) => void;
  /** Set the persona to the one an answer's trip was planned for, keeping that route and trip. */
  adoptProfile: (p: Profile) => void;
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
  closureSim: null as SceneState["closureSim"],
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
  journey: null as JourneyPlan | null,
  compare: null as CompareIntent | null,
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

/**
 * True for an intent that puts something new on the map (camera, place, route, river level, day,
 * rollout, what-if): a later answer's map (or the UI's own) takes the map back from a Development
 * Simulation, even a finished one (its camera, lighting and hidden markers would otherwise stay).
 * One from the answer that started the simulation does not (`applyIntent`'s answerId).
 */
export function movesMap(i: SceneIntent): boolean {
  // route.compare puts two routes on the map (not in the generated kind union yet)
  if (asCompareIntent(i)) return true;
  switch (i.kind) {
    case "camera.fly_to":
      return !!i.center && i.center.length >= 2;
    case "place.focus":
      return !!i.place_id;
    case "route.highlight":
      return !!i.route_id && !!i.geojson;
    case "flood.set_level":
    case "day.show":
    case "day.trip":
    case "river.rollout":
    case "whatif.diff":
      return true;
    default:
      return false;
  }
}

/** The chat answer whose development.play started the running simulation (see `applyIntent`). */
let devsimAnswer: string | undefined;

/** True when the journey player holds a trip of a route other than `routeId`. */
function staleTrip(routeId: string): boolean {
  const plan = useJourney.getState().plan;
  return !!plan && plan.route_id !== routeId;
}

/** True when the compare playback holds a compare whose routes do not include `routeId`. */
function staleCompare(routeId: string): boolean {
  const p = useCompare.getState().payload;
  return !!p && p.recommended?.id !== routeId && p.fastest?.id !== routeId;
}

export const useScene = create<SceneState>((set) => ({
  ...initial,
  applyIntent: (i, answerId) => {
    // a trip of another route is never shown beside this one (journey.play is not sent for
    // every route answer, so the newer route alone has to drop the older trip)
    const dropTrip =
      i.kind === "route.highlight" && !!i.route_id && !!i.geojson && staleTrip(i.route_id);
    if (dropTrip) useJourney.getState().clear();
    const cmp = asCompareIntent(i);
    // the same for a compare playback: a newer route (or compare) of other routes drops it
    const cmpRoute = cmp?.recommended?.id ?? cmp?.fastest?.id;
    if (
      (i.kind === "route.highlight" && !!i.route_id && !!i.geojson && staleCompare(i.route_id)) ||
      (cmpRoute && staleCompare(cmpRoute))
    )
      useCompare.getState().clear();
    const dev = asDevsimIntent(i);
    // one simulation at a time: a development simulation drops a shown trip, and a trip stops it
    if (dev) {
      useJourney.getState().clear();
      useCompare.getState().clear();
    }
    const sameAnswer = answerId !== undefined && answerId === devsimAnswer;
    if (
      ((i.kind === "journey.play" && i.journey) || (movesMap(i) && !sameAnswer)) &&
      useDevsim.getState().status !== "idle"
    )
      useDevsim.getState().stop();
    if (dev) devsimAnswer = answerId;
    set((s) => {
      const next: Partial<SceneState> = { intents: [...s.intents, i] };
      if (dev) {
        next.journey = null;
        next.compare = null;
      }
      if (cmp) next.compare = cmp;
      switch (i.kind) {
        case "route.highlight":
          if (i.route_id && i.geojson) {
            next.route = { id: i.route_id, geojson: i.geojson as unknown as GeoJSON.LineString };
            next.whatIf = null; // a real route is never drawn under an older imagined diff
            if (dropTrip) next.journey = null;
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
        case "journey.play":
          if (i.journey) {
            next.journey = i.journey;
            // the answer used this persona (e.g. named in the question): the chip follows it
            if (i.journey.profile !== s.profile) {
              next.profile = i.journey.profile;
              saveProfile(i.journey.profile);
            }
          }
          break;
      }
      return next;
    });
    // Loaded paused; the demo preset (?demo=1, spec §6.6) plays it from the start as soon as it
    // arrives, a normal load waits for the answer's "Watch the trip" button.
    if (i.kind === "journey.play" && i.journey) {
      // a compare of this answer's route keeps the stage in the demo preset (it plays instead)
      const cmpNow = useScene.getState().compare;
      const comparing = isPlayableCompare(cmpNow) && cmpNow.recommended.id === i.journey.route_id;
      if (!(comparing && useCompare.getState().payload === cmpNow)) {
        useCompare.getState().clear();
        useJourney.getState().load(i.journey);
        if (isDemoPreset() && !comparing) useJourney.getState().play();
      }
    }
    // the demo preset plays a playable compare as soon as it arrives (like journey.play)
    if (cmp && isPlayableCompare(cmp) && isDemoPreset()) {
      useCompare.getState().load(cmp);
      useCompare.getState().play();
    }
    // Scripted autoplay (spec D6): plays as soon as the plan is in (fetched when not inlined).
    if (dev) void beginDevsim(dev);
  },
  stopDevsim: () => useDevsim.getState().stop(),
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
    set((s) => {
      if (s.profile === profile) return { profile, route: null, whatIf: null };
      useJourney.getState().clear(); // the trip was planned for the previous persona
      useCompare.getState().clear();
      return { profile, route: null, whatIf: null, journey: null, compare: null };
    });
  },
  adoptProfile: (profile) => {
    if (useScene.getState().profile === profile) return;
    saveProfile(profile);
    set({ profile });
  },
  setScenario: (scenarioId) => {
    useJourney.getState().clear(); // its trip was planned under the previous scenario
    useCompare.getState().clear();
    set((s) => ({
      scenarioId,
      route: null, // planned under the previous scenario
      journey: null,
      compare: null,
      whatIf: null, // compared against the previous scenario
      selectedFloodEdgeId: null,
      lensVisible: { ...s.lensVisible, flood: !!scenarioId || s.lensVisible.flood },
    }));
  },
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
  // The journey's ribbon is the route on the map: clearing the route clears the trip too.
  clearRoute: () => {
    useJourney.getState().clear();
    useCompare.getState().clear();
    set({ route: null, journey: null, compare: null });
  },
  clearWhatIf: () => set({ whatIf: null }),
  setClosureSim: (closureSim) => set({ closureSim }),
  setRollout: (r) => set((s) => ({ rollout: { ...s.rollout, ...r } })),
  setDay: (d) => set((s) => ({ day: { ...s.day, ...d } })),
  setMyTrip: (geojson) => set({ myTrip: geojson ? { geojson } : null }),
  setDayStage: (scenarioId) =>
    set((s) =>
      s.scenarioId === scenarioId
        ? {}
        : { scenarioId, lensVisible: { ...s.lensVisible, flood: true } },
    ),
  reset: () => {
    useJourney.getState().clear();
    useCompare.getState().clear();
    useDevsim.getState().stop();
    set(initial);
  },
}));

// window.__devsim (dev and test builds, demo preset): seek / play / pause / probe for checks.
if (typeof window !== "undefined")
  installDevsimHook({ dev: import.meta.env.DEV, search: window.location.search });
