import { KIND_BY_TYPE, ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../cesium/stylised/ground";
import type { Tier } from "../../cesium/stylised/quality";
import { hash01, jitterFor, type Placement, paletteFor } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { capFor, type PropKind } from "./caps";

/**
 * Seeded, static, DECORATIVE props for the hero district: trees, lamps, street furniture and
 * construction sites. Pure: the same input always gives the same output. Nothing here is a fact
 * about the township; the scene labels the details as illustrative.
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
  centre: [number, number];
  radiusM: number;
  tier: Tier;
  /** Tests only: replaces the tier's cap for a kind. */
  capsOverride?: Partial<Record<PropKind, number>>;
  m: Manifest;
}

type P = [number, number];
type Ring = P[];
/** Outer ring first, then holes. */
type Poly = Ring[];

const TREE_CLEAR_M = 1.5;
const TREE_MIN_GAP_M = 2.5;
const STREET_TREE_SPACING = 18;
const STREET_TREE_EXTRA = 1.5;
const MEDIAN_TREE_SPACING = 14;
const STREET_LAMP_SPACING = 30;
const STREET_LAMP_START = 9;
const MEDIAN_LAMP_SPACING = 35;
const PARK_TREE_RADIUS = 22;
const FOREST_SPACING = 9;
const OIL_PALM_SPACING = 8;
const FURNITURE_EDGE_SPACING = 25;
const PLACE_FURNITURE_RANGE = 15;
const HOARDING_M = 6;
const EXCAVATOR_MIN_M2 = 2000;
const CRANE_MIN_M2 = 8000;
const BOLLARD_SPACING = 1.5;
const BOLLARDS_PER_ENTRANCE = 5;
const GRID_M = 32;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): Record<string, unknown>[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features.filter(isRec) : [];
const propsOf = (f: Record<string, unknown>): Record<string, unknown> =>
  isRec(f.properties) ? f.properties : {};

function localRing(ring: unknown, frame: LocalFrame): Ring | null {
  if (!Array.isArray(ring)) return null;
  const out: Ring = [];
  for (const c of ring) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    out.push(frame.toLocal(c[0] as number, c[1] as number));
  }
  const a = out[0];
  const b = out[out.length - 1];
  if (out.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) out.pop();
  return out.length >= 3 ? out : null;
}

function polygonsOf(geom: unknown, frame: LocalFrame): Poly[] {
  if (!isRec(geom) || !Array.isArray(geom.coordinates)) return [];
  const sets: unknown[] =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : [];
  const out: Poly[] = [];
  for (const s of sets) {
    if (!Array.isArray(s)) continue;
    const rings = s.map((r) => localRing(r, frame));
    if (rings[0] && rings.every(Boolean)) out.push(rings as Poly);
  }
  return out;
}

function inRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (x: number, z: number, p: Poly): boolean =>
  inRing(x, z, p[0]!) && !p.slice(1).some((h) => inRing(x, z, h));

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

function distSeg(px: number, pz: number, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

function distToRing(x: number, z: number, ring: Ring): number {
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    d = Math.min(d, distSeg(x, z, ring[j]!, ring[i]!));
  return d;
}

function areaOf(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a / 2);
}

function bboxOf(ring: Ring): [number, number, number, number] {
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
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
}

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

export function planProps(input: PropsInput): PropsPlan {
  const { frame, tier, m, radiusM } = input;
  const plan: PropsPlan = { kits: new Map(), stats: {} };
  const capOf = (k: PropKind) => input.capsOverride?.[k] ?? capFor(tier, k);
  const kinds: PropKind[] = ["trees", "lamps", "furniture", "construction"];
  if (kinds.every((k) => capOf(k) === 0)) return plan;

  const [cx, cz] = frame.toLocal(input.centre[0], input.centre[1]);
  const dist = (x: number, z: number) => Math.hypot(x - cx, z - cz);
  const inside = (x: number, z: number) => dist(x, z) <= radiusM;
  const clipBox = [cx - radiusM, cz - radiusM, cx + radiusM, cz + radiusM] as const;
  const overlapsClip = (b: [number, number, number, number]) =>
    b[2] >= clipBox[0] && b[0] <= clipBox[2] && b[3] >= clipBox[1] && b[1] <= clipBox[3];

  // Roads (every walk LineString is a drawn ribbon) and places.
  const roads: Road[] = [];
  featuresOf(input.walk).forEach((f, i) => {
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
    });
  });

  const roadGrid = new Grid();
  const segs: { a: P; b: P; half: number }[] = [];
  for (const r of roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i]!;
      const b = r.pts[i + 1]!;
      const half = r.width / 2;
      // By the segment's distance to the centre, not its midpoint: a long segment crossing the
      // radius must still be avoided.
      if (distSeg(cx, cz, a, b) > radiusM + half + 1) continue;
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
  for (const f of featuresOf(input.buildings))
    for (const poly of polygonsOf(f.geometry, frame)) {
      const ring = poly[0]!;
      const b = bboxOf(ring);
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

  const placesOf = featuresOf(input.places)
    .map((f) => {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "Point" || !Array.isArray(g.coordinates)) return null;
      const [lon, lat] = g.coordinates as number[];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const p = propsOf(f);
      const [x, z] = frame.toLocal(lon!, lat!);
      return {
        id: String(p.id ?? `pl${x.toFixed(0)}_${z.toFixed(0)}`),
        type: typeof p.type === "string" ? p.type : "",
        entrances: Array.isArray(p.entrance_ids) ? p.entrance_ids.map(String) : [],
        x,
        z,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null && inside(p.x, p.z));

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
    if (!inside(x, z)) return false;
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
        // Points well outside the radius can never be placed: skip them before any id is built.
        if (dist(x, z) <= radiusM + 20) out.push({ x, z, tx, tz, s: next });
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
    if (!overlapsClip(bboxOf(r.pts))) continue;
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
      const lampOff = r.width / 2 + 0.8;
      along(r.pts, STREET_LAMP_SPACING, STREET_LAMP_START).forEach((p, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        const x = p.x + p.tz * lampOff * side;
        const z = p.z - p.tx * lampOff * side;
        // The lamp arm faces the road (model +z toward the centre line).
        const yaw = Math.atan2(-p.tz * side, p.tx * side);
        push("lamps", "furniture/lamp_single", `ls:${r.id}:${p.s.toFixed(1)}`, x, z, yaw);
      });
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
  featuresOf(input.trees).forEach((f, i) => {
    const g = f.geometry;
    if (!isRec(g) || g.type !== "Point" || !Array.isArray(g.coordinates)) return;
    const [lon, lat] = g.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const id = `ot:${String(propsOf(f).id ?? f.id ?? i)}`;
    const [x, z] = frame.toLocal(lon!, lat!);
    tree(id, x, z, hash01(id, "species") < 0.7 ? "rain_tree" : "flame_tree", "osm");
  });

  const parkPolys: Poly[] = featuresOf(input.parks)
    .flatMap((f) => polygonsOf(f.geometry, frame))
    .filter((p) => overlapsClip(bboxOf(p[0]!)));
  const area: Record<"park" | "forest" | "oil", Poly[]> = {
    park: [...parkPolys],
    forest: [],
    oil: [],
  };
  const constructionPolys: Poly[] = [];
  for (const f of featuresOf(input.landcover)) {
    const cls = propsOf(f).class;
    for (const poly of polygonsOf(f.geometry, frame)) {
      if (!overlapsClip(bboxOf(poly[0]!))) continue;
      // Grass joins the park pool: one lattice over the union, so a polygon listed as both a park
      // and grass is sampled once (no doubled density).
      if (cls === "grass") area.park.push(poly);
      else if (cls === "forest") area.forest.push(poly);
      else if (cls === "oil_palm") area.oil.push(poly);
      else if (cls === "construction") constructionPolys.push(poly);
    }
  }

  /** Membership test over a set of polygons (bbox grid, clipped to the radius). */
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
   * Lattice samples (one seeded candidate per cell) inside `polys`, generated nearest-first in
   * square rings around the centre and stopped once `limit` were accepted, so the cost follows the
   * cap and not the polygon area.
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
    const maxR = Math.ceil(radiusM / cell) + 1;
    const ds: number[] = [];
    const visit = (i: number, j: number) => {
      if (!maybe(i * cell, j * cell, (i + 1) * cell, (j + 1) * cell)) return;
      const id = `${tag}:${i}:${j}`;
      const [x, z] = at(id, i, j);
      if (inside(x, z) && test(x, z) && fn(id, x, z)) ds.push(dist(x, z));
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
  lattice(area.park, parkCell, "pk", jitterAt(parkCell), treeCap, (id, x, z) =>
    tree(id, x, z, pick(id, "species", PARK_SPECIES), "park"),
  );
  const forestCell = FOREST_SPACING / Math.SQRT2;
  lattice(area.forest, forestCell, "fo", jitterAt(forestCell), treeCap, (id, x, z) =>
    tree(id, x, z, hash01(id, "species") < 0.75 ? "rain_tree" : "coconut_palm", "forest"),
  );
  lattice(
    area.oil,
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
  parkPolys.forEach((poly, pi) => {
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
      pair(`pe${pi}:${p.s.toFixed(1)}`, x, z, Math.atan2(nx * inward, nz * inward));
    }
  });
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

  // Construction sites.
  constructionPolys.forEach((poly, ci) => {
    const ring = poly[0]!;
    const b = bboxOf(ring);
    const area = areaOf(ring) - poly.slice(1).reduce((s, h) => s + areaOf(h), 0);
    // Hoardings: every 6 m along the boundary, midpoint of each span, facing outward.
    const closed = [...ring, ring[0]!];
    // Per-site quota under a tight cap, nearest site first (`sd`): rank 0 cabin, 1 two hoardings,
    // 2 crane, 3 excavator, 4 stacks, 5 the remaining hoardings.
    const sd = dist((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    const hoardings = along(closed, HOARDING_M, HOARDING_M / 2);
    hoardings.forEach((p, i) => {
      const n: P = [p.tz, -p.tx];
      const outward = inPoly(p.x + n[0] * 0.5, p.z + n[1] * 0.5, poly) ? -1 : 1;
      push(
        "construction",
        "construction/hoarding_6m",
        `hd${ci}:${i}`,
        p.x,
        p.z,
        Math.atan2(n[0] * outward, n[1] * outward),
        {
          ribbon: false,
          building: false,
          rank: i === 0 || i === Math.floor(hoardings.length / 2) ? 1 : 5,
          sd,
        },
      );
    });
    // Interior spots, roomiest first (distance to the boundary), deterministic.
    const spots: { x: number; z: number; r: number }[] = [];
    const step = Math.max(2, Math.min(b[2] - b[0], b[3] - b[1]) / 12);
    for (let x = b[0] + step / 2; x < b[2]; x += step)
      for (let z = b[1] + step / 2; z < b[3]; z += step)
        if (inPoly(x, z, poly))
          spots.push({ x, z, r: Math.min(...poly.map((rg) => distToRing(x, z, rg))) });
    spots.sort((p, q) => q.r - p.r || p.x - q.x || p.z - q.z);
    const taken: P[] = [];
    const take = (minR: number, gap: number): { x: number; z: number } | null => {
      for (const s of spots) {
        if (s.r < minR) break;
        if (taken.every((t) => Math.hypot(t[0] - s.x, t[1] - s.z) >= gap)) {
          taken.push([s.x, s.z]);
          return s;
        }
      }
      return null;
    };
    const place = (key: string, tag: string, minR: number, gap: number, rank: number) => {
      const s = take(minR, gap);
      if (s)
        push("construction", key, `${tag}${ci}`, s.x, s.z, undefined, {
          ribbon: false,
          building: false,
          rank,
          sd,
        });
    };
    if (area > CRANE_MIN_M2) place("construction/tower_crane", "tc", 0, 0, 2);
    place("construction/site_cabin", "sc", 2, 8, 0);
    place("construction/material_stack", "ms0_", 2, 6, 4);
    place("construction/material_stack", "ms1_", 2, 6, 4);
    if (area > EXCAVATOR_MIN_M2) place("construction/excavator", "ex", 3, 8, 3);
  });

  // Caps. Trees are stratified by source (TREE_SHARES) with a minimum gap, so one dense patch cannot
  // starve the rest; construction ranks by per-site quota; everything else is nearest-first.
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
  const emit = (kind: PropKind, list: Cand[]) => {
    const cap = capOf(kind);
    list.sort(cmp);
    let n = 0;
    for (const c of list) {
      if (n >= cap) break;
      if (add(c)) n++;
    }
    plan.stats[kind] = n;
  };

  const emitTrees = () => {
    const cap = capOf("trees");
    const bySrc = new Map<TreeSource, Cand[]>();
    for (const c of cands.trees) {
      const k = c.src ?? "street";
      const l = bySrc.get(k);
      if (l) l.push(c);
      else bySrc.set(k, [c]);
    }
    for (const l of bySrc.values()) l.sort(cmp);
    const ptr = new Map<TreeSource, number>();
    const taken = new Map<string, P[]>();
    const clash = (c: Cand) => {
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const near = taken.get(
            `${Math.floor(c.x / TREE_MIN_GAP_M) + i},${Math.floor(c.z / TREE_MIN_GAP_M) + j}`,
          );
          if (near?.some((q) => Math.hypot(q[0] - c.x, q[1] - c.z) < TREE_MIN_GAP_M)) return true;
        }
      return false;
    };
    const stat: Record<string, number> = {};
    let n = 0;
    while (n < cap) {
      const active = [...bySrc].filter(([k, l]) => (ptr.get(k) ?? 0) < l.length);
      if (active.length === 0) break;
      const share = active.reduce((a, [k]) => a + TREE_SHARES[k], 0);
      const left = cap - n;
      let progressed = false;
      for (const [k, l] of active) {
        let quota = Math.max(1, Math.round((left * TREE_SHARES[k]) / share));
        let p = ptr.get(k) ?? 0;
        while (quota > 0 && p < l.length && n < cap) {
          const c = l[p++]!;
          if (clash(c) || !add(c)) continue;
          const key = `${Math.floor(c.x / TREE_MIN_GAP_M)},${Math.floor(c.z / TREE_MIN_GAP_M)}`;
          const t = taken.get(key);
          if (t) t.push([c.x, c.z]);
          else taken.set(key, [[c.x, c.z]]);
          quota--;
          n++;
          stat[k] = (stat[k] ?? 0) + 1;
          progressed = true;
        }
        ptr.set(k, p);
      }
      if (!progressed && active.every(([k, l]) => (ptr.get(k) ?? 0) >= l.length)) break;
    }
    plan.stats.trees = n;
    for (const [k, v] of Object.entries(stat)) plan.stats[`trees.${k}`] = v;
  };
  emitTrees();
  emit("lamps", cands.lamps);
  emit("furniture", cands.furniture);
  emit("construction", cands.construction);
  return plan;
}
