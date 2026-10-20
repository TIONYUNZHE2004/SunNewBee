/**
 * Development Simulation contract (spec 2026-10-21 §4–§5, ADR 0014).
 *
 * Hand mirror of `townshiplens_spatial.devsim_models`, named and shaped as `pnpm gen` emits them
 * (fields with a non-null default are required, `None` defaults are optional and nullable), so
 * callers can later swap to `components["schemas"]["DevelopmentPlan"]`. Coordinates are [lon, lat].
 */

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
}

export interface DevsimFacts {
  /** Null when no detour of at least 2 min exists (spec §13): bubble 1 has no tag, no end-card item 1. */
  detour?: DevsimDetour | null;
  park: DevsimWalk;
  mall: DevsimWalk;
  profile: string;
  provenance: string;
}

export type CastHome = "tower" | "existing";
export type BubbleTone = "pos" | "neg";
export type EndCardBadge = "ROUTE ENGINE" | "SIMULATED";

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

export interface EndCardItem {
  text: string;
  badges: EndCardBadge[];
}

export interface EndCard {
  title: string;
  subtitle: string;
  items: EndCardItem[];
  legend: string;
}

export interface DevsimAnchors {
  halim_path: number[][];
  farid: number[];
  junction: number[];
  park: number[];
  mall: number[];
}

export interface DevsimLabels {
  simulation: string;
  decorative: string;
  hypothetical: string;
  end_card_subtitle: string;
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
  end_card: EndCard;
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
  feedbackCount: number;
  envelope: { progress: number } | null;
  /** target: [lon, lat, h]; offset: [east, north, up] metres. */
  camera: { target: [number, number, number]; offset: [number, number, number] };
  flow: { timeScale: number; peopleDensity: number; vehicleDensity: number };
  endCard: boolean;
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
  };
  people: [number, number][];
  vehicles: [number, number][];
  cameraInsideBuilding: boolean;
  windowsLitFraction: number;
  fps?: number;
  /** CSS px centre of the §4.4 camera subject, stage-relative (3D fills it; AC-C1). */
  subject?: { x: number; y: number };
}
