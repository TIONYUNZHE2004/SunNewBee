import type { BuildingsLayer } from "../../../../lib/api";
import type { Tier } from "../../shared/quality";
import type { Placement } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { RoofInput } from "../assets/plan";
import type { FacadeBuilding } from "../facade/facadeLayer";
import type { RoofItem, TileRoofs } from "../facade/roofLayer";
import { roofDressing } from "../facade/roofPlan";
import { createFrame, type LocalFrame } from "../frame";
import type { Boundary } from "../ground/boundary";
import { planDressing } from "../ground/dressingPlan";
import { ribbonsFromWalk } from "../ground/ribbons";
import { planVerges } from "../ground/verges";
import { planAgents } from "../motion/agents";
import { planProps } from "../props/propsPlan";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { planSigns } from "../signs/signPlan";
import { type PlanArea, seedFor } from "./area";
import { tileCap, VERGE_PIECES_PER_CAP, VERGE_SHRUBS_PER_CAP } from "./caps";
import { guardTile } from "./clipTile";
import { lotKits, planTileLots, warmLots } from "./lotsPlan";
import type { Ring, TileContent } from "./streamer";
import { type Tile, type TileKey, tileAt, tileOf } from "./tiles";

/** What every tile is planned from. All of it is static per world (the walk is latched). */
export interface TileInputs {
  frame: LocalFrame;
  /** The latched access layer (walk LineStrings and place points); never re-keyed by profile. */
  walk: unknown;
  buildings: BuildingsLayer | null | undefined;
  /** Props and agents need the kit manifest; without it a tile has roads and signs only. */
  manifest: Manifest | null;
  /** Facade inputs by tile (`bucketFacades`); null: no facades (no assets, showroom). */
  facades: Map<TileKey, FacadeBuilding[]> | null;
  /** Roof inputs by tile (`bucketRoofs`); absent or null: no roof dressing. */
  roofs?: Map<TileKey, RoofInput[]> | null;
  /**
   * The Elmina outline (A-T4). `walk` and `buildings` are already cut to it (`ground/clipLayer.ts`);
   * with it every planned tile also passes the vertex guard (`clipTile.ts`) and agents keep to
   * paths inside. Absent or null (a world without an outline): nothing is clipped.
   */
  boundary?: Boundary | null;
}

/**
 * `TileInputs` as a structured-clone payload (the planning Worker's `init` message): everything but
 * the frame is plain data (GeoJSON, the manifest, Maps of plain records and Float32Arrays); the
 * frame is sent as its origin and rebuilt with `createFrame` on the other side.
 */
export type WireInputs = Omit<TileInputs, "frame"> & { origin: LocalFrame["origin"] };

export function toWire(inp: TileInputs): WireInputs {
  const { frame, ...rest } = inp;
  return { ...rest, origin: frame.origin };
}

export function fromWire(w: WireInputs): TileInputs {
  const { origin, ...rest } = w;
  return { ...rest, frame: createFrame(origin) };
}

/** Per-planner seed salt: the seed is `hash01(tileKey, salt)` (`seedFor`), never visit order. */
const SALT = { props: "props", motion: "motion", signs: "signs", roads: "roads" } as const;
const LAMP_KITS = ["furniture/lamp_single", "furniture/lamp_double"];
const NO_KITS: Map<string, Placement[]> = new Map();
/** One shared empty list: a re-plan of a tile without facades keeps its identity (no facade rebuild). */
export const NO_FACADES: FacadeBuilding[] = Object.freeze([]) as unknown as FacadeBuilding[];

/** One shared empty roof plan: a tile without large roofs keeps its identity across re-plans. */
export const NO_ROOFS: TileRoofs = Object.freeze({
  items: Object.freeze([]) as unknown as RoofItem[],
  decks: Object.freeze([]) as unknown as TileRoofs["decks"],
});
const roofPlans = new WeakMap<RoofInput[], TileRoofs>();

/**
 * The roof plan of one tile's roof inputs (pure, deterministic per building id): rooftop units,
 * skylights and edge bands for each large non-landmark roof, plus the podium deck a roof input
 * carries (planned with the inputs). Memoised per input list, so a ring 0 <-> 1 re-plan returns the same plan (the roof
 * layer is rebuilt only when the set of ring 0-1 plans changes).
 */
export function planRoofs(list: RoofInput[] | undefined): TileRoofs {
  if (!list || list.length === 0) return NO_ROOFS;
  let plan = roofPlans.get(list);
  if (!plan) {
    const items: RoofItem[] = [];
    const decks: TileRoofs["decks"] = [];
    for (const r of list) {
      if (r.deck) decks.push(r.deck);
      const dressing = roofDressing(r.b, r.palette);
      if (dressing.units.length + dressing.skylights.length + dressing.band.length > 0)
        items.push({ id: r.b.id, dressing });
    }
    plan = items.length + decks.length > 0 ? { items, decks } : NO_ROOFS;
    roofPlans.set(list, plan);
  }
  return plan;
}

const areaOf = (tile: Tile, salt: string): PlanArea => ({
  box: tile.box,
  seed: seedFor(tile.key, salt),
});

/**
 * One tile's decorative content (pure). Caps come from `tileCap` (the only place HERO_BOOST enters),
 * seeds from the tile key. Low plans roads only (no props, agents, signs or facades). Facades are
 * planned for rings 0-1 only (P4-H): ring 2 and beyond show the plain palette extrusion. Roof
 * dressing (Task 8) follows the same rule.
 */
export function planTile(inp: TileInputs, tile: Tile, ring: Ring, tier: Tier): TileContent {
  const { frame, walk, buildings, manifest } = inp;
  const cap = (kind: Parameters<typeof tileCap>[2]) => tileCap(tier, ring, kind, tile, frame);
  const rich = tier !== "low";
  const propKits =
    rich && manifest && buildings
      ? planProps({
          walk,
          landcover: buildings.landcover,
          buildings: buildings.buildings,
          parks: buildings.parks,
          trees: buildings.trees,
          places: walk,
          frame,
          area: areaOf(tile, SALT.props),
          tier,
          caps: {
            trees: cap("trees"),
            lamps: cap("lamps"),
            furniture: cap("furniture"),
            // Task 10: construction is streamed by `planTileLots` (by area, with tracks); 0 here, or it is placed twice.
            construction: 0,
          },
          m: manifest,
        }).kits
      : NO_KITS;
  const lots = planTileLots(inp, tile, ring, tier); // Task 10: parking lots and construction land
  const kits = lotKits(propKits, lots);
  const vehicles = cap("vehicles");
  const people = cap("people");
  const signCap = cap("signs");
  // A planner with nothing to place (ring 2, Low) is not run.
  const agents =
    rich && manifest && vehicles + people > 0
      ? planAgents({
          walk,
          places: walk,
          frame,
          area: areaOf(tile, SALT.motion),
          tier,
          caps: { vehicles, people },
          m: manifest,
          boundary: inp.boundary,
        })
      : [];
  const signs =
    rich && buildings && signCap > 0
      ? planSigns(buildings.signage, buildings.buildings, walk, frame, {
          area: areaOf(tile, SALT.signs),
          cap: signCap,
        }).signs
      : [];
  const ribbons = ribbonsFromWalk(walk as GeoJSON.FeatureCollection, frame, {
    area: areaOf(tile, SALT.roads),
    // Rounded kerbs (B-T3) only where they can be seen: rings 0-1, above Low.
    bevel: tier !== "low" && ring <= 1,
  });
  const content: TileContent = {
    kits,
    lamps: LAMP_KITS.flatMap((k) => kits.get(k) ?? []),
    agents,
    signs,
    ribbons,
    facades: rich && ring <= 1 ? (inp.facades?.get(tile.key) ?? NO_FACADES) : undefined,
    roofs: rich && ring <= 1 && inp.roofs ? planRoofs(inp.roofs.get(tile.key)) : undefined,
    verges: planTileVerges(inp, tile, ring, tier),
    ...lots.content, // Task 10: parking, tracks, gravel
    dressing: planTileDressing(inp, tile, ring, tier),
  };
  // A-T4: nothing drawn outside the Elmina outline (display only).
  return guardTile(content, inp.boundary);
}

// --- Task 9: grass verges and shrub rows (self-contained) ---------------------------------------
/**
 * One tile's grass verge strips and shrub rows (decorative). The `verges` cap counts units of
 * VERGE_PIECES_PER_CAP strip pieces plus, at ring 0 only, VERGE_SHRUBS_PER_CAP shrubs
 * (TRIS_PER.verges prices the same unit). A 0 cap (Low, ring 2, Medium ring 1): none. Shrubs need the kit manifest; they are `trees`
 * kit variants and join the kit union (`unionKits`), not this tile's `kits` (so `farView`, which keeps
 * tree kits beyond 1500 m, drops them with the strips).
 */
export function planTileVerges(
  inp: TileInputs,
  tile: Tile,
  ring: Ring,
  tier: Tier,
): TileContent["verges"] {
  const cap = tileCap(tier, ring, "verges", tile, inp.frame);
  if (cap <= 0) return undefined;
  const shrubCap = ring === 0 && inp.manifest ? Math.floor(cap * VERGE_SHRUBS_PER_CAP) : 0;
  return planVerges(
    inp.walk,
    inp.buildings?.buildings ?? null,
    tile,
    inp.frame,
    shrubCap,
    cap * VERGE_PIECES_PER_CAP,
    { parks: inp.buildings?.parks, water: inp.buildings?.water },
  );
}
/** A-T10: the tile's land dressing (flowers, crop rows, cones, mounds); undefined when empty. */
export function planTileDressing(
  inp: TileInputs,
  tile: Tile,
  ring: Ring,
  tier: Tier,
): TileContent["dressing"] {
  if (tier === "low" || !inp.buildings) return undefined;
  const d = planDressing({
    landcover: inp.buildings.landcover,
    walk: inp.walk,
    frame: inp.frame,
    box: tile.box,
    ring,
    tier,
  });
  return d.tris.length > 0 ? d : undefined;
}
// --- end Task 9 ------------------------------------------------------------------------------------

/** A box no data reaches: planning it builds every planner's layer cache and places nothing. */
const NOWHERE: Tile = {
  key: "warm",
  i: 0,
  j: 0,
  box: { x0: 1e9, z0: 1e9, x1: 1e9 + 1, z1: 1e9 + 1 },
};

/**
 * Builds every planner's per-layer cache (the ~20-60 ms cold first call each) by planning an empty
 * box at Medium, plus every sign once. Run once per input set, outside any streamed frame (an idle callback at world
 * load), so no LOD tick pays the cold cost. The caches are keyed by the layer objects and the
 * frame, which stay the same across profile and scenario switches (the walk is latched).
 */
export function warmPlanners(inp: TileInputs): void {
  planTile(inp, NOWHERE, 0, "medium");
  // The sign planner builds its building and street caches only once a sign is in the box: plan
  // every sign once (no area), which reaches them.
  if (inp.buildings) planSigns(inp.buildings.signage, inp.buildings.buildings, inp.walk, inp.frame);
  // The roof planner's first call pays its JIT cost: pay it here on a throwaway roof.
  if (inp.roofs) planRoofs([WARM_ROOF]);
  warmLots(inp); // Task 10: every parking-lot and construction-site layout
}

const WARM_ROOF: RoofInput = {
  b: {
    id: "warm",
    ring: [
      [0, 0],
      [60, 0],
      [60, 40],
      [0, 40],
    ],
    heightM: 10,
    kind: "industrial",
  },
  palette: { ...CLAY_PALETTE.neutral },
};

/** Items grouped by the tile holding their footprint's bounding-box centre (half-open). */
function bucketByFootprint<T>(
  list: readonly T[],
  ringOf: (t: T) => ReadonlyArray<readonly [number, number]>,
): Map<TileKey, T[]> {
  const out = new Map<TileKey, T[]>();
  for (const b of list) {
    let x0 = Number.POSITIVE_INFINITY;
    let z0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let z1 = Number.NEGATIVE_INFINITY;
    for (const [x, z] of ringOf(b)) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (!Number.isFinite(x0)) continue;
    const key = tileAt((x0 + x1) / 2, (z0 + z1) / 2).key;
    const l = out.get(key);
    if (l) l.push(b);
    else out.set(key, [b]);
  }
  return out;
}

/** Facade inputs grouped by the tile holding their footprint's bounding-box centre (half-open). */
export function bucketFacades(list: readonly FacadeBuilding[]): Map<TileKey, FacadeBuilding[]> {
  return bucketByFootprint(list, (b) => b.ring);
}

/** Roof inputs grouped the same way (the tile under the roof's bounding-box centre). */
export function bucketRoofs(list: readonly RoofInput[]): Map<TileKey, RoofInput[]> {
  return bucketByFootprint(list, (r) => r.b.ring);
}

// --- Task 5: the planning Worker's wire format (shared by plan.worker.ts and planClient.ts) ------
/** Worker protocol (main -> worker). `init` is posted once, before any `plan`. */
export type PlanRequest =
  | { type: "init"; inputs: WireInputs }
  | { type: "plan"; key: TileKey; ring: Ring; tier: Tier; seq: number };
/** Worker protocol (worker -> main): one reply per `plan`. */
export type PlanReply =
  | { seq: number; content: WireContent; ms: number }
  | { seq: number; error: string };

/**
 * A planned tile on the wire: the facade list is not sent back (it is the tile's own entry in the
 * inputs, which the main thread already holds); `facades` says whether the plan carried it.
 */
export type WireContent = Omit<TileContent, "facades" | "dispose"> & { facades: boolean };

/** The tile with key "i,j" (`tiles.ts` keys). */
export function tileFromKey(key: TileKey): Tile {
  const [i, j] = key.split(",").map(Number) as [number, number];
  return tileOf(i, j);
}

const isTyped = (v: unknown): v is Float32Array | Uint32Array =>
  v instanceof Float32Array || v instanceof Uint32Array;

/** Every typed-array buffer reachable from `v` (arrays, Maps and plain objects), each once. */
function buffers(v: unknown, out: Set<ArrayBuffer>): void {
  if (isTyped(v)) {
    out.add(v.buffer as ArrayBuffer);
    return;
  }
  if (Array.isArray(v)) for (const x of v) buffers(x, out);
  else if (v instanceof Map) for (const x of v.values()) buffers(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) buffers(x, out);
}

/**
 * The Worker's reply for one plan, with its transfer list. The content is deep-copied first (in the
 * Worker), so the planners' cached arrays are never detached and the main thread receives the
 * copies' Float32Array / Uint32Array buffers without another copy.
 */
export function packReply(
  seq: number,
  content: TileContent,
  ms: number,
): { reply: PlanReply; transfer: ArrayBuffer[] } {
  const { facades, dispose: _d, ...rest } = content;
  const copy = structuredClone(rest) as Omit<TileContent, "facades" | "dispose">;
  const out = new Set<ArrayBuffer>();
  buffers(copy, out);
  return { reply: { seq, content: { ...copy, facades: !!facades }, ms }, transfer: [...out] };
}

// --- end Task 5 ----------------------------------------------------------------------------------
