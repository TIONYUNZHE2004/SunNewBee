/**
 * Development Simulation contract (spec 2026-10-21 §4–§5, ADR 0014).
 *
 * Hand mirror of `townshiplens_spatial.devsim_models`, named and shaped as `pnpm gen` emits them
 * (fields with a non-null default are required, `None` defaults are optional and nullable); the 45 s
 * plan's newer fields come from the generated schemas via `planTypes.ts`, and a type test in
 * `timeline.build.test.ts` keeps the generated `components["schemas"]["DevelopmentPlan"]` assignable
 * to this mirror. Coordinates are
 * [lon, lat].
 */
import type {
  Banner,
  DailyLifeMatrix,
  EstimateSource,
  FloodExposure,
  HoardingImpact,
  ImpactBrief,
  LorryRoute,
  PlanMonthKey,
  Schedule,
  SimResidents,
  TimedTag,
} from "./planTypes";

/** Developer's brief (request side). */
export interface DevelopmentBrief {
  text?: string | null;
  storeys: number;
  homes: number;
}

export interface DevelopmentEntrance {
  door: number[];
  /** Compass bearing the door faces (0 = north, clockwise). */
  facing_deg: number;
  /** Door -> snapped walk node. */
  path: number[][];
}

export interface DevelopmentSite {
  parcel_id: string;
  /** Tower footprint ring (not closed). */
  footprint: number[][];
  storeys: number;
  homes: number;
  entrance: DevelopmentEntrance;
  kanopi_clearance_m: number;
}

export interface DevsimDetour {
  home_id: string;
  edge_id: string;
  before_m: number;
  after_m: number;
  detour_min: number;
  before_path: number[][];
  after_path: number[][];
  /** True when the detour moves to the sidewalk across the road (bubble 1's claim). */
  detour_side_switch: boolean;
}

export interface DevsimWalk {
  m: number;
  min: number;
  path: number[][];
  arrival_id?: string | null;
  label?: string | null;
}

export interface DevsimFacts {
  /** Null when no detour of at least 2 min exists (spec §13): bubble 1 has no tag. */
  detour?: DevsimDetour | null;
  park: DevsimWalk;
  mall: DevsimWalk;
  profile: string;
  provenance: string;
}

export type CastHome = "tower" | "existing" | "site";
export type BubbleTone = "pos" | "neg";

export interface SpotlightCast {
  id: string;
  name: string;
  role: string;
  persona: string;
  home: CastHome;
  colour: string;
}

export interface Bubble {
  n: number;
  /** A `SpotlightCast.id`. */
  who: string;
  t0: number;
  t1: number;
  tone: BubbleTone;
  text: string;
  tag?: string | null;
}

export interface Act {
  name: string;
  t0: number;
  t1: number;
}

export interface DevsimAnchors {
  halim_path: number[][];
  farid: number[];
  /** The site worker's spot inside the hoarding (C7; absent on the legacy 66 s fixture). */
  worker?: number[];
  /** Where the entrance path meets the street. */
  junction: number[];
  park: number[];
  mall: number[];
}

export interface DevsimLabels {
  simulation: string;
  decorative: string;
  hypothetical: string;
  /** "Simulated reactions" (C7; absent on the legacy 66 s fixture). */
  simulated?: string;
}

export interface DevelopmentPlan {
  /** True only for the prototype-derived web fixture. */
  provisional: boolean;
  world: string;
  site: DevelopmentSite;
  facts: DevsimFacts;
  cast: SpotlightCast[];
  households: number;
  acts: Act[];
  bubbles: Bubble[];
  anchors: DevsimAnchors;
  tags: TimedTag[];
  banners: Banner[];
  impact: HoardingImpact;
  lorry_route: LorryRoute;
  schedule: Schedule;
  estimate_sources: EstimateSource[];
  /** Screen second -> project month keys (the backend applies the R25 rules). */
  month_keys: PlanMonthKey[];
  month_keys_mode: "baseline" | "data-order";
  flood: FloodExposure;
  access_matrix: DailyLifeMatrix;
  residents: SimResidents;
  /** The Impact Brief (spec §6.2), shown from 33 s. */
  brief: ImpactBrief;
  labels: DevsimLabels;
  total_s: number;
}

/** Scene intent emitted by the agent after `simulate_development`. */
export interface DevelopmentPlayIntent {
  kind: "development.play";
  /** Null or absent on a world without the parcel: the web fetches POST /api/developments/simulate. */
  plan?: DevelopmentPlan | null;
  brief_text: string;
}

/** Output of `stateAt(t, plan)` (timeline.ts): everything one frame needs, no Three.js. */
export interface StateAt {
  act: string;
  simClock: { label: string; month?: number; week?: number; day?: number; hhmm?: string };
  sun: { phase01: number; elevation: number; isNight: boolean };
  occupancy: number;
  floorsBuilt: number;
  workersActive: boolean;
  windowsLitFraction: number;
  hoarding: boolean;
  crane: { slewRad: number; beaconOn: boolean };
  lorries: boolean;
  movers: { queueProgress: number };
  bubbles: { n: number; who: string; text: string; tag?: string | null }[];
  /** target: [lon, lat, h]; offset: [east, north, up] metres. */
  camera: { target: [number, number, number]; offset: [number, number, number] };
  flow: { timeScale: number; peopleDensity: number; vehicleDensity: number };
  /** The Impact Brief panel is on screen (45 s plan, from 33 s). */
  brief: boolean;
}

/** A screen rectangle in CSS px relative to the stage. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `window.__devsim.probe()`: projected screen rects (CSS px, stage-relative) and flow samples. */
export interface Probe {
  t: number;
  rects: {
    tower?: Rect;
    speaker?: Rect;
    bubble?: Rect;
    hypotheticalLabel?: Rect;
    simBadge?: Rect;
    /** The Impact Brief panel (45 s plan, from 33 s). */
    brief?: Rect;
  };
  people: [number, number][];
  vehicles: [number, number][];
  cameraInsideBuilding: boolean;
  windowsLitFraction: number;
  /** The timeline's window-lit fraction at t (what the 3D tower should show). */
  expectedWindowsLitFraction?: number;
  fps?: number;
  /** CSS px centre of the §4.4 camera subject, stage-relative (3D fills it; AC-C1). */
  subject?: { x: number; y: number };
  /**
   * Screen time of the last frame the 3D view rendered (its rects, samples and subject come from
   * that frame). A probe right after a seek can still describe the previous frame: compare to `t`.
   */
  renderedT?: number;
}
