import { KIND_BY_TYPE, ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../cesium/stylised/ground";
import type { Tier } from "../../cesium/stylised/quality";
import { hash01, jitterFor, type Placement, paletteFor } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { boxCentre, growBox, inBox, type PlanArea, perLayer, touchesBox } from "../stream/area";
import type { PropKind } from "./caps";
import { planConstructionSites } from "./construction";
import {
  type BBox,
  bboxOf,
  distSeg,
  distToRing,
  inPoly,
  inRing,
  type P,
  type Poly,
  polygonsOf,
  type Ring,
} from "./polyGeom";

/**
 * Seeded, static, DECORATIVE props for one planning box (a streaming tile, or a union of tiles):
 * trees, lamps, street furniture and construction sites. Pure: the same input always gives the
 * same output. Every candidate is keyed by global ids (feature ids, arc positions, frame-aligned
 * lattice cells), so planning two adjacent boxes separately gives exactly the placements of
 * planning their union (with caps that do not bite). Nothing here is a fact about the township;
 * the scene labels the details as illustrative.
 */
export interface PropsPlan {
  /** Key `${asset}/${variant}`, as in the city plan. */
  kits: Map<string, Placement[]>;
  stats: Record<string, number>;
}

export interface PropsInput {
  /** `/layers/access` FeatureCollection (LineStrings with `type`; Points are places). */
  walk: unknown;
  /** `buildings.landcover` FeatureCollection (`class`). */
  landcover: unknown;
  /** `buildings.buildings` FeatureCollection (footprints to keep clear). */
  buildings: unknown;
  /** `buildings.parks` FeatureCollection. */
  parks: unknown;
  /** `buildings.trees` FeatureCollection (OSM tree points). */
  trees: unknown;
  /** Place points (`type`, optional `entrance_ids`), e.g. the access layer. */
  places: unknown;
  frame: LocalFrame;
  /** The box to plan (half-open) and its tile seed. */
  area: PlanArea;
  /** Low plans nothing, whatever the caps say. */
  tier: Tier;
  /**
   * Instances per kind for this box: `tileCap(tier, ring, kind, tile, frame)` for a streamed tile
   * (the hero boost lives there, not here).
   */
  caps: Record<PlannedPropKind, number>;
  m: Manifest;
}

/** The kinds this planner places (people and vehicles are the motion planner's). */
export type PlannedPropKind = Extract<PropKind, "trees" | "lamps" | "furniture" | "construction">;

const TREE_CLEAR_M = 1.5;
const TREE_MIN_GAP_M = 2.5;
const STREET_TREE_SPACING = 18;
const STREET_TREE_EXTRA = 1.5;
/** A street lamp stands this far beyond the kerb. */
const STREET_LAMP_EXTRA = 0.8;
const MEDIAN_TREE_SPACING = 14;
const STREET_LAMP_SPACING = 30;
const STREET_LAMP_START = 9;
const MEDIAN_LAMP_SPACING = 35;
const PARK_TREE_RADIUS = 22;
const FOREST_SPACING = 9;
const OIL_PALM_SPACING = 8;
const FURNITURE_EDGE_SPACING = 25;
const PLACE_FURNITURE_RANGE = 15;
const BOLLARD_SPACING = 1.5;
const BOLLARDS_PER_ENTRANCE = 5;
const GRID_M = 32;
/**
 * The furthest a kerb prop stands from its road's centre line: half the widest road plus the
 * larger kerb offset. A road this far outside the box can still put a tree or lamp inside it.
 */
const KERB_REACH_M =
  Math.max(ROAD_WIDTH_UNKNOWN, ...Object.values(WIDTH_BY_TYPE)) / 2 +
  Math.max(STREET_TREE_EXTRA, STREET_LAMP_EXTRA);
/**
 * Walk points (and roads) this far outside the box are still walked for kerb props: the kerb reach
 * past the tree pad (the spacing rule needs the trees in the pad too), plus a metre of slack.
 */
const ALONG_MARGIN_M = TREE_MIN_GAP_M + KERB_REACH_M + 1;
/** Places this far outside the box can still put furniture or bollards inside it. */
const PLACE_MARGIN_M = 20;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): Record<string, unknown>[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features.filter(isRec) : [];
const propsOf = (f: Record<string, unknown>): Record<string, unknown> =>
  isRec(f.properties) ? f.properties : {};

/** A ring with its edges bucketed by z slab, so a point test only walks the edges at its own z. */
interface SlabRing {
  z0: number;
  dz: number;
  ring: Ring;
  slabs: number[][];
}
function slabRing(ring: Ring): SlabRing {
  const b = bboxOf(ring);
  const n = Math.min(256, Math.max(1, Math.floor(ring.length / 6)));
  const dz = (b[3] - b[1]) / n || 1;
  const slabs: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const zi = ring[i]![1];
    const zj = ring[j]![1];
    const lo = Math.max(0, Math.min(n - 1, Math.floor((Math.min(zi, zj) - b[1]) / dz)));
    const hi = Math.max(0, Math.min(n - 1, Math.floor((Math.max(zi, zj) - b[1]) / dz)));
    for (let k = lo; k <= hi; k++) slabs[k]!.push(i);
  }
  return { z0: b[1], dz, ring, slabs };
}
function inSlabRing(x: number, z: number, sr: SlabRing): boolean {
  const n = sr.slabs.length;
  const idx = Math.max(0, Math.min(n - 1, Math.floor((z - sr.z0) / sr.dz)));
  const ring = sr.ring;
  let inside = false;
  for (const i of sr.slabs[idx]!) {
    const j = i === 0 ? ring.length - 1 : i - 1;
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Uniform grid of item indices by bounding box. */
class Grid {
  private cells = new Map<string, number[]>();
  add(i: number, x0: number, z0: number, x1: number, z1: number) {
    for (let cx = Math.floor(x0 / GRID_M); cx <= Math.floor(x1 / GRID_M); cx++)
      for (let cz = Math.floor(z0 / GRID_M); cz <= Math.floor(z1 / GRID_M); cz++) {
        const k = `${cx},${cz}`;
        const l = this.cells.get(k);
        if (l) l.push(i);
        else this.cells.set(k, [i]);
      }
  }
  at(x: number, z: number): number[] {
    return this.cells.get(`${Math.floor(x / GRID_M)},${Math.floor(z / GRID_M)}`) ?? [];
  }
}

interface Road {
  id: string;
  pts: P[];
  type: string;
  kind: string;
  width: number;
  bb: BBox;
}

/*
 * Local-frame copies of the layers, with bounds, built once per layer object and frame
 * (`perLayer`): planning a tile only filters them by its box.
 */
type Cache<T> = WeakMap<object, WeakMap<object, T>>;
const roadsCache: Cache<Road[]> = new WeakMap();
const ringsCache: Cache<{ ring: Ring; bb: BBox }[]> = new WeakMap();
const polysCache: Cache<{ poly: Poly; id: string; cls: unknown; bb: BBox }[]> = new WeakMap();
const pointsCache: Cache<
  { p: Record<string, unknown>; fid: unknown; i: number; x: number; z: number }[]
> = new WeakMap();

/** Every walk LineString (each one is a drawn ribbon). */
const roadsOf = (walk: unknown, frame: LocalFrame): Road[] =>
  perLayer(roadsCache, walk, frame, () => {
    const roads: Road[] = [];
    featuresOf(walk).forEach((f, i) => {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) return;
      const pts: P[] = [];
      for (const c of g.coordinates) {
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
        const q = frame.toLocal(c[0] as number, c[1] as number);
        const last = pts[pts.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
      }
      if (pts.length < 2) return;
      const p = propsOf(f);
      const type = typeof p.type === "string" ? p.type : "";
      roads.push({
        id: String(p.id ?? `r${i}`),
        pts,
        type,
        kind: KIND_BY_TYPE[type] ?? "other",
        width: WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN,
        bb: bboxOf(pts),
      });
    });
    return roads;
  });

/** Outer rings of every building polygon. */
const buildingRingsOf = (buildings: unknown, frame: LocalFrame) =>
  perLayer(ringsCache, buildings, frame, () =>
    featuresOf(buildings).flatMap((f) =>
      polygonsOf(f.geometry, frame).map((poly) => ({ ring: poly[0]!, bb: bboxOf(poly[0]!) })),
    ),
  );

/** Every polygon with its global index (`feature.polygon`) and the feature's `class`. */
const polysOf = (fc: unknown, frame: LocalFrame) =>
  perLayer(polysCache, fc, frame, () =>
    featuresOf(fc).flatMap((f, fi) =>
      polygonsOf(f.geometry, frame).map((poly, k) => ({
        poly,
        id: `${fi}.${k}`,
        cls: propsOf(f).class,
        bb: bboxOf(poly[0]!),
      })),
    ),
  );

/** Every Point feature in local metres, with its properties, feature id and index. */
const pointsOf = (fc: unknown, frame: LocalFrame) =>
  perLayer(pointsCache, fc, frame, () => {
    const out: { p: Record<string, unknown>; fid: unknown; i: number; x: number; z: number }[] = [];
    featuresOf(fc).forEach((f, i) => {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "Point" || !Array.isArray(g.coordinates)) return;
      const [lon, lat] = g.coordinates as number[];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const [x, z] = frame.toLocal(lon!, lat!);
      out.push({ p: propsOf(f), fid: f.id, i, x, z });
    });
    return out;
  });

interface Cand {
  /** Kit key. */
  key: string;
  id: string;
  x: number;
  z: number;
  yaw: number;
  d: number;
  /** Tree source (stratified caps). */
  src?: TreeSource;
  /** Construction: lower ranks survive a tight cap first, then nearer sites first (`sd`). */
  rank?: number;
  sd?: number;
}

type TreeSource = "osm" | "street" | "median" | "park" | "forest" | "oil";
/**
 * Share of the tree cap each source may take first (nearest-first within a source). Street and
 * OSM trees read best at hero-near/mid, so they get the most; whatever a source cannot use (too few
 * candidates) is redistributed to the others by the same shares.
 */
export const TREE_SHARES: Record<TreeSource, number> = {
  street: 0.35,
  osm: 0.25,
  park: 0.15,
  forest: 0.12,
  oil: 0.08,
  median: 0.05,
};
const PARK_SPECIES: [string, number][] = [
  ["rain_tree", 0.45],
  ["flame_tree", 0.3],
  ["shrub_round", 0.25],
];
const STREET_SPECIES: [string, number][] = [
  ["rain_tree", 0.5],
  ["frangipani", 0.3],
  ["royal_palm", 0.2],
];

/** Tree source priority for the spacing rule (lower wins a 2.5 m cell). */
const SRC_RANK: Record<TreeSource, number> = {
  osm: 0,
  street: 1,
  median: 2,
  park: 3,
  forest: 4,
  oil: 5,
};

export function planProps(input: PropsInput): PropsPlan {
  const { frame, tier, m, area } = input;
  const plan: PropsPlan = { kits: new Map(), stats: {} };
  const capOf = (k: PlannedPropKind) =>
    tier === "low" ? 0 : Math.max(0, Math.floor(input.caps[k] ?? 0));
  const kinds: PlannedPropKind[] = ["trees", "lamps", "furniture", "construction"];
  if (kinds.every((k) => capOf(k) === 0)) return plan;

  const box = area.box;
  // Distances (the nearest-first order under a cap) are from the box centre.
  const [cx, cz] = boxCentre(box);
  const dist = (x: number, z: number) => Math.hypot(x - cx, z - cz);
  const inside = (x: number, z: number) => inBox(box, x, z);
  // Tree candidates are gathered over the box grown by the tree gap, so the spacing rule sees the
  // neighbours across an edge exactly as the neighbouring tile does; only points inside the box
  // itself are placed.
  const pad = growBox(box, TREE_MIN_GAP_M);
  const inPad = (x: number, z: number) => inBox(pad, x, z);
  const clipBox = [pad.x0, pad.z0, pad.x1, pad.z1] as const;
  const overlapsClip = (b: [number, number, number, number]) =>
    touchesBox(pad, b[0], b[1], b[2], b[3]);
  const alongBox = growBox(box, ALONG_MARGIN_M);
  const placeBox = growBox(box, PLACE_MARGIN_M);

  // Roads (every walk LineString is a drawn ribbon) and places.
  const roads = roadsOf(input.walk, frame);

  const roadGrid = new Grid();
  const segs: { a: P; b: P; half: number }[] = [];
  for (const r of roads) {
    const h = r.width / 2 + 1;
    if (!touchesBox(pad, r.bb[0] - h, r.bb[1] - h, r.bb[2] + h, r.bb[3] + h)) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i]!;
      const b = r.pts[i + 1]!;
      const half = r.width / 2;
      // By the segment's bounds, not its midpoint: a long segment crossing the box must still be
      // avoided.
      if (
        !touchesBox(
          pad,
          Math.min(a[0], b[0]) - half - 1,
          Math.min(a[1], b[1]) - half - 1,
          Math.max(a[0], b[0]) + half + 1,
          Math.max(a[1], b[1]) + half + 1,
        )
      )
        continue;
      const idx = segs.push({ a, b, half }) - 1;
      roadGrid.add(
        idx,
        Math.min(a[0], b[0]) - half,
        Math.min(a[1], b[1]) - half,
        Math.max(a[0], b[0]) + half,
        Math.max(a[1], b[1]) + half,
      );
    }
  }
  // A segment is indexed by its box padded by the half width, so the point's own cell holds every
  // segment within that distance of it.
  const onRibbon = (x: number, z: number): boolean => {
    for (const i of roadGrid.at(x, z)) {
      const s = segs[i]!;
      if (distSeg(x, z, s.a, s.b) < s.half) return true;
    }
    return false;
  };

  const bRings: Ring[] = [];
  const bGrid = new Grid();
  for (const { ring, bb: b } of buildingRingsOf(input.buildings, frame)) {
    if (!overlapsClip([b[0] - 5, b[1] - 5, b[2] + 5, b[3] + 5])) continue;
    const idx = bRings.push(ring) - 1;
    bGrid.add(
      idx,
      b[0] - TREE_CLEAR_M,
      b[1] - TREE_CLEAR_M,
      b[2] + TREE_CLEAR_M,
      b[3] + TREE_CLEAR_M,
    );
  }
  const nearBuilding = (x: number, z: number): boolean => {
    for (const i of bGrid.at(x, z)) {
      const r = bRings[i]!;
      if (inRing(x, z, r) || distToRing(x, z, r) < TREE_CLEAR_M) return true;
    }
    return false;
  };

  const placesOf = pointsOf(input.places, frame)
    .filter(({ x, z }) => inBox(placeBox, x, z))
    .map(({ p, x, z }) => ({
      id: String(p.id ?? `pl${x.toFixed(0)}_${z.toFixed(0)}`),
      type: typeof p.type === "string" ? p.type : "",
      entrances: Array.isArray(p.entrance_ids) ? p.entrance_ids.map(String) : [],
      x,
      z,
    }));

  const cands: Record<PropKind, Cand[]> = {
    trees: [],
    lamps: [],
    furniture: [],
    construction: [],
    people: [],
    vehicles: [],
  };
  const push = (
    kind: PropKind,
    key: string,
    id: string,
    x: number,
    z: number,
    yaw?: number,
    opts: {
      ribbon?: boolean;
      building?: boolean;
      src?: TreeSource;
      rank?: number;
      sd?: number;
    } = {},
  ): boolean => {
    // Trees: the padded box (the spacing rule needs the edge neighbours); the rest: the box.
    if (kind === "trees" ? !inPad(x, z) : !inside(x, z)) return false;
    if (opts.building !== false && nearBuilding(x, z)) return false;
    if (opts.ribbon !== false && onRibbon(x, z)) return false;
    cands[kind].push({
      key,
      id,
      x,
      z,
      yaw: yaw ?? hash01(id, "yaw") * Math.PI * 2,
      d: dist(x, z),
      src: opts.src,
      rank: opts.rank,
      sd: opts.sd,
    });
    return true;
  };

  /** Points every `step` metres along a polyline, inclusive of the start, with unit tangent. */
  const along = (pts: P[], step: number, start = 0) => {
    const out: { x: number; z: number; tx: number; tz: number; s: number }[] = [];
    let walked = 0;
    let next = start;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l === 0) continue;
      const tx = (b[0] - a[0]) / l;
      const tz = (b[1] - a[1]) / l;
      while (next <= walked + l + 1e-9) {
        const t = next - walked;
        const x = a[0] + tx * t;
        const z = a[1] + tz * t;
        // Points well outside the box can never be placed: skip them before any id is built.
        if (inBox(alongBox, x, z)) out.push({ x, z, tx, tz, s: next });
        next += step;
      }
      walked += l;
    }
    return out;
  };

  const pick = (id: string, salt: string, opts: [string, number][]): string => {
    let u = hash01(id, salt);
    for (const [name, w] of opts) {
      if (u < w) return name;
      u -= w;
    }
    return opts[opts.length - 1]![0];
  };
  const tree = (id: string, x: number, z: number, v: string, src: TreeSource): boolean =>
    push("trees", `trees/${v}`, id, x, z, undefined, { src });

  // Street trees, lamps and median palms.
  for (const r of roads) {
    const kindStreet = r.kind === "residential";
    const major = r.type === "major_road";
    if (!kindStreet && !major) continue;
    // Against the box grown by the kerb reach, not the tree pad: a street just outside the box
    // still puts its near-kerb trees and lamps inside it.
    if (!touchesBox(alongBox, r.bb[0], r.bb[1], r.bb[2], r.bb[3])) continue;
    if (kindStreet) {
      const off = r.width / 2 + STREET_TREE_EXTRA;
      for (const p of along(r.pts, STREET_TREE_SPACING)) {
        for (const side of [1, -1] as const) {
          const id = `st:${r.id}:${side}:${p.s.toFixed(1)}`;
          const x = p.x + p.tz * off * side;
          const z = p.z - p.tx * off * side;
          tree(id, x, z, pick(id, "species", STREET_SPECIES), "street");
        }
      }
      const lampOff = r.width / 2 + STREET_LAMP_EXTRA;
      for (const p of along(r.pts, STREET_LAMP_SPACING, STREET_LAMP_START)) {
        // Alternate sides by the lamp's index along the whole road (not within the box).
        const i = Math.round((p.s - STREET_LAMP_START) / STREET_LAMP_SPACING);
        const side = i % 2 === 0 ? 1 : -1;
        const x = p.x + p.tz * lampOff * side;
        const z = p.z - p.tx * lampOff * side;
        // The lamp arm faces the road (model +z toward the centre line).
        const yaw = Math.atan2(-p.tz * side, p.tx * side);
        push("lamps", "furniture/lamp_single", `ls:${r.id}:${p.s.toFixed(1)}`, x, z, yaw);
      }
    } else {
      for (const p of along(r.pts, MEDIAN_TREE_SPACING)) {
        const id = `mt:${r.id}:${p.s.toFixed(1)}`;
        push("trees", "trees/royal_palm", id, p.x, p.z, undefined, {
          ribbon: false,
          src: "median",
        });
      }
      for (const p of along(r.pts, MEDIAN_LAMP_SPACING, MEDIAN_LAMP_SPACING / 2)) {
        const yaw = Math.atan2(p.tx, -p.tz);
        push("lamps", "furniture/lamp_double", `ld:${r.id}:${p.s.toFixed(1)}`, p.x, p.z, yaw, {
          ribbon: false,
        });
      }
    }
  }

  // OSM tree points.
  for (const { p, fid, i, x, z } of pointsOf(input.trees, frame)) {
    if (!inPad(x, z)) continue;
    const id = `ot:${String(p.id ?? fid ?? i)}`;
    tree(id, x, z, hash01(id, "species") < 0.7 ? "rain_tree" : "flame_tree", "osm");
  }

  // Polygons carry their global index (`feature.polygon`), so ids never depend on the box.
  const parkPolys = polysOf(input.parks, frame).filter((p) => overlapsClip(p.bb));
  const lands: Record<"park" | "forest" | "oil", Poly[]> = {
    park: parkPolys.map((p) => p.poly),
    forest: [],
    oil: [],
  };
  const constructionPolys: { poly: Poly; id: string }[] = [];
  for (const { poly, id, cls, bb } of polysOf(input.landcover, frame)) {
    if (!overlapsClip(bb)) continue;
    // Grass joins the park pool: one lattice over the union, so a polygon listed as both a park
    // and grass is sampled once (no doubled density).
    if (cls === "grass") lands.park.push(poly);
    else if (cls === "forest") lands.forest.push(poly);
    else if (cls === "oil_palm") lands.oil.push(poly);
    else if (cls === "construction") constructionPolys.push({ poly, id });
  }

  /** Membership test over a set of polygons (bbox grid, clipped to the padded box). */
  const polyTest = (polys: Poly[]) => {
    const g = new Grid();
    const boxes = polys.map((p) => bboxOf(p[0]!));
    const slabs = polys.map((p) => p.map(slabRing));
    boxes.forEach((b, i) => {
      g.add(
        i,
        Math.max(b[0], clipBox[0]),
        Math.max(b[1], clipBox[1]),
        Math.min(b[2], clipBox[2]),
        Math.min(b[3], clipBox[3]),
      );
    });
    const test = (x: number, z: number) =>
      g.at(x, z).some((i) => {
        const b = boxes[i]!;
        if (!(x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])) return false;
        const sp = slabs[i]!;
        return inSlabRing(x, z, sp[0]!) && !sp.slice(1).some((h) => inSlabRing(x, z, h));
      });
    /** Cheap reject: no polygon box touches any grid bucket the lattice cell [x0,x1]x[z0,z1] overlaps. */
    const maybe = (x0: number, z0: number, x1: number, z1: number) =>
      g.at(x0, z0).length > 0 ||
      g.at(x1, z0).length > 0 ||
      g.at(x0, z1).length > 0 ||
      g.at(x1, z1).length > 0;
    return { test, maybe };
  };

  /**
   * Lattice samples (one seeded candidate per frame-aligned cell) inside `polys`, generated
   * nearest-first in square rings around the box centre and stopped once `limit` were accepted, so
   * the cost follows the cap and not the polygon area.
   */
  const lattice = (
    polys: Poly[],
    cell: number,
    tag: string,
    at: (id: string, i: number, j: number) => [number, number],
    limit: number,
    fn: (id: string, x: number, z: number) => boolean,
  ) => {
    if (polys.length === 0 || limit <= 0) return;
    const { test, maybe } = polyTest(polys);
    const ci = Math.floor(cx / cell);
    const cj = Math.floor(cz / cell);
    const maxR = Math.ceil(Math.hypot(pad.x1 - cx, pad.z1 - cz) / cell) + 1;
    const ds: number[] = [];
    const visit = (i: number, j: number) => {
      if (!maybe(i * cell, j * cell, (i + 1) * cell, (j + 1) * cell)) return;
      const id = `${tag}:${i}:${j}`;
      const [x, z] = at(id, i, j);
      if (inPad(x, z) && test(x, z) && fn(id, x, z)) ds.push(dist(x, z));
    };
    // Unseen cells lie beyond (r - 1) cells, so stop once the limit-th nearest accepted is inside that.
    const done = (r: number) =>
      ds.length >= limit && ds.sort((a, b) => a - b)[limit - 1]! <= (r - 1) * cell;
    // Start at the nearest polygon box: rings inside that distance hold no polygon.
    let near = Number.POSITIVE_INFINITY;
    for (const p of polys) {
      const b = bboxOf(p[0]!);
      near = Math.min(
        near,
        Math.hypot(Math.max(b[0] - cx, 0, cx - b[2]), Math.max(b[1] - cz, 0, cz - b[3])),
      );
    }
    const r0 = Math.max(0, Math.floor(near / cell) - 2);
    for (let r = r0; r <= maxR && !done(r - 1); r++) {
      if (r === 0) visit(ci, cj);
      else {
        for (let k = -r; k <= r; k++) {
          visit(ci + k, cj - r);
          visit(ci + k, cj + r);
        }
        for (let k = -r + 1; k <= r - 1; k++) {
          visit(ci - r, cj + k);
          visit(ci + r, cj + k);
        }
      }
    }
  };
  const treeCap = capOf("trees");
  const jitterAt =
    (cell: number) =>
    (id: string, i: number, j: number): [number, number] => [
      (i + hash01(id, "jx")) * cell,
      (j + hash01(id, "jz")) * cell,
    ];
  const parkCell = PARK_TREE_RADIUS / Math.SQRT2;
  lattice(lands.park, parkCell, "pk", jitterAt(parkCell), treeCap, (id, x, z) =>
    tree(id, x, z, pick(id, "species", PARK_SPECIES), "park"),
  );
  const forestCell = FOREST_SPACING / Math.SQRT2;
  lattice(lands.forest, forestCell, "fo", jitterAt(forestCell), treeCap, (id, x, z) =>
    tree(id, x, z, hash01(id, "species") < 0.75 ? "rain_tree" : "coconut_palm", "forest"),
  );
  lattice(
    lands.oil,
    OIL_PALM_SPACING,
    "op",
    (id, i, j): [number, number] => [
      (i + 0.5) * OIL_PALM_SPACING + (hash01(id, "jx") - 0.5) * 0.6,
      (j + 0.5) * OIL_PALM_SPACING + (hash01(id, "jz") - 0.5) * 0.6,
    ],
    treeCap,
    (id, x, z) => tree(id, x, z, "oil_palm", "oil"),
  );

  // Park edge and place furniture: bench and bin pairs, bus shelters, entrance bollards.
  const pair = (id: string, x: number, z: number, yaw: number, building = true) => {
    const tx = Math.cos(yaw);
    const tz = -Math.sin(yaw);
    push("furniture", "furniture/bench", `${id}:bench`, x, z, yaw, { building, ribbon: false });
    push("furniture", "furniture/bin", `${id}:bin`, x + tx * 1.6, z + tz * 1.6, yaw, {
      building,
      ribbon: false,
    });
  };
  for (const { poly, id: pid } of parkPolys) {
    const ring = poly[0]!;
    const pts = [...ring, ring[0]!];
    // Edge point inward normal by probing both sides.
    for (const p of along(pts, FURNITURE_EDGE_SPACING, 3)) {
      const nx = p.tz;
      const nz = -p.tx;
      const inward = inPoly(p.x + nx * 1.5, p.z + nz * 1.5, poly) ? 1 : -1;
      const x = p.x + nx * inward * 1.5;
      const z = p.z + nz * inward * 1.5;
      if (onRibbon(x, z)) continue;
      // Model +z faces the park interior, away from the edge.
      pair(`pe${pid}:${p.s.toFixed(1)}`, x, z, Math.atan2(nx * inward, nz * inward));
    }
  }
  for (const pl of placesOf) {
    if (pl.type === "park" || pl.type === "playground" || pl.type === "shelter") {
      const a = hash01(pl.id, "furn") * Math.PI * 2;
      const r = 4 + hash01(pl.id, "furnr") * (PLACE_FURNITURE_RANGE - 6);
      pair(`pf:${pl.id}`, pl.x + Math.cos(a) * r, pl.z + Math.sin(a) * r, a + Math.PI);
    }
    if (pl.type === "shelter")
      push("furniture", "furniture/bus_shelter", `bs:${pl.id}`, pl.x, pl.z, undefined, {
        ribbon: false,
      });
    if ((pl.type === "school" || pl.type === "mall") && pl.entrances.length > 0)
      pl.entrances.forEach((eid, ei) => {
        const a = (ei + hash01(`${pl.id}:${eid}`, "ent")) * 1.9;
        const ox = pl.x + Math.cos(a) * 6;
        const oz = pl.z + Math.sin(a) * 6;
        const tx = -Math.sin(a);
        const tz = Math.cos(a);
        for (let k = 0; k < BOLLARDS_PER_ENTRANCE; k++) {
          const o = (k - (BOLLARDS_PER_ENTRANCE - 1) / 2) * BOLLARD_SPACING;
          push(
            "furniture",
            "furniture/bollard",
            `bo:${pl.id}:${eid}:${k}`,
            ox + tx * o,
            oz + tz * o,
            undefined,
            {
              ribbon: false,
            },
          );
        }
      });
  }

  // Caps. Trees are stratified by source (TREE_SHARES) after the spacing rule, so one dense patch
  // cannot starve the rest; construction ranks by per-site quota; everything else is nearest-first.
  const cmp = (a: Cand, b: Cand) =>
    (a.rank ?? 0) - (b.rank ?? 0) ||
    (a.sd ?? a.d) - (b.sd ?? b.d) ||
    a.d - b.d ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const add = (c: Cand) => {
    const slash = c.key.indexOf("/");
    const asset = c.key.slice(0, slash);
    const variant = c.key.slice(slash + 1);
    const spec = m.assets[asset];
    if (!spec?.variants[variant]) return false;
    const s = jitterFor(spec, c.id).scale;
    const pl: Placement = {
      id: c.id,
      asset,
      variant,
      x: c.x,
      z: c.z,
      yaw: c.yaw,
      sx: s,
      sy: s,
      sz: s,
      palette: paletteFor(spec, "default", c.id),
    };
    const l = plan.kits.get(c.key);
    if (l) l.push(pl);
    else plan.kits.set(c.key, [pl]);
    return true;
  };
  const emit = (kind: PlannedPropKind, list: Cand[]) => {
    const cap = capOf(kind);
    list.sort(cmp);
    let n = 0;
    for (const c of list) {
      if (n >= cap) break;
      if (add(c)) n++;
    }
    plan.stats[kind] = n;
  };

  /**
   * The tree spacing rule, decided the same way whatever the box: one tree per 2.5 m cell (cells
   * are aligned to the frame origin, so tile edges are cell edges), the cell's winner chosen by a
   * fixed priority (source, then id); a winner also yields to a higher-priority winner within
   * 2.5 m in a neighbouring cell. No chain of greedy picks, so adjacent tiles agree at their edge
   * and no two trees end up closer than the gap.
   */
  const spacedTrees = (): Cand[] => {
    const prio = (a: Cand, b: Cand) =>
      SRC_RANK[a.src ?? "street"] - SRC_RANK[b.src ?? "street"] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const cellOf = (c: Cand): [number, number] => [
      Math.floor(c.x / TREE_MIN_GAP_M),
      Math.floor(c.z / TREE_MIN_GAP_M),
    ];
    const winners = new Map<string, Cand>();
    for (const c of cands.trees) {
      const [i, j] = cellOf(c);
      const k = `${i},${j}`;
      const w = winners.get(k);
      if (!w || prio(c, w) < 0) winners.set(k, c);
    }
    const out: Cand[] = [];
    for (const c of winners.values()) {
      if (!inside(c.x, c.z)) continue;
      const [i, j] = cellOf(c);
      let ok = true;
      for (let di = -1; di <= 1 && ok; di++)
        for (let dj = -1; dj <= 1 && ok; dj++) {
          if (di === 0 && dj === 0) continue;
          const w = winners.get(`${i + di},${j + dj}`);
          if (w && prio(w, c) < 0 && Math.hypot(w.x - c.x, w.z - c.z) < TREE_MIN_GAP_M) ok = false;
        }
      if (ok) out.push(c);
    }
    return out;
  };

  // Trees are stratified by source (TREE_SHARES), nearest-first within a source.
  const emitTrees = () => {
    const cap = capOf("trees");
    const bySrc = new Map<TreeSource, Cand[]>();
    for (const c of spacedTrees()) {
      const k = c.src ?? "street";
      const l = bySrc.get(k);
      if (l) l.push(c);
      else bySrc.set(k, [c]);
    }
    for (const l of bySrc.values()) l.sort(cmp);
    const ptr = new Map<TreeSource, number>();
    const stat: Record<string, number> = {};
    let n = 0;
    while (n < cap) {
      const active = [...bySrc].filter(([k, l]) => (ptr.get(k) ?? 0) < l.length);
      if (active.length === 0) break;
      const share = active.reduce((a, [k]) => a + TREE_SHARES[k], 0);
      const left = cap - n;
      for (const [k, l] of active) {
        let quota = Math.max(1, Math.round((left * TREE_SHARES[k]) / share));
        let p = ptr.get(k) ?? 0;
        while (quota > 0 && p < l.length && n < cap) {
          const c = l[p++]!;
          if (!add(c)) continue;
          quota--;
          n++;
          stat[k] = (stat[k] ?? 0) + 1;
        }
        ptr.set(k, p);
      }
    }
    plan.stats.trees = n;
    for (const [k, v] of Object.entries(stat)) plan.stats[`trees.${k}`] = v;
  };
  emitTrees();
  emit("lamps", cands.lamps);
  emit("furniture", cands.furniture);
  // Construction sites come from `construction.ts` (the P3 set: hoardings, a cabin, two stacks,
  // an excavator, a crane); the by-area dressing is `planConstruction`'s, used by the streamer.
  const cap = capOf("construction");
  if (cap > 0) {
    const built = planConstructionSites(constructionPolys, box, cap, m, false);
    for (const [k, l] of built.kits) plan.kits.set(k, l);
    plan.stats.construction = built.count;
  } else plan.stats.construction = 0;
  return plan;
}
