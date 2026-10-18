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
}

export function planProps(input: PropsInput): PropsPlan {
  const { frame, tier, m, radiusM } = input;
  const plan: PropsPlan = { kits: new Map(), stats: {} };
  const kinds: PropKind[] = ["trees", "lamps", "furniture", "construction"];
  if (kinds.every((k) => capFor(tier, k) === 0)) return plan;

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
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      if (dist(mx, mz) > radiusM + 200) continue;
      const half = r.width / 2;
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
    opts: { ribbon?: boolean; building?: boolean } = {},
  ) => {
    if (!inside(x, z)) return;
    if (opts.building !== false && nearBuilding(x, z)) return;
    if (opts.ribbon !== false && onRibbon(x, z)) return;
    cands[kind].push({
      key,
      id,
      x,
      z,
      yaw: yaw ?? hash01(id, "yaw") * Math.PI * 2,
      d: dist(x, z),
    });
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
        out.push({ x: a[0] + tx * t, z: a[1] + tz * t, tx, tz, s: next });
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
  const tree = (id: string, x: number, z: number, v: string) =>
    push("trees", `trees/${v}`, id, x, z);

  // Street trees, lamps and median palms.
  for (const r of roads) {
    const kindStreet = r.kind === "residential";
    const major = r.type === "major_road";
    if (!kindStreet && !major) continue;
    if (kindStreet) {
      const off = r.width / 2 + STREET_TREE_EXTRA;
      for (const p of along(r.pts, STREET_TREE_SPACING)) {
        for (const side of [1, -1] as const) {
          const id = `st:${r.id}:${side}:${p.s.toFixed(1)}`;
          const x = p.x + p.tz * off * side;
          const z = p.z - p.tx * off * side;
          tree(
            id,
            x,
            z,
            pick(id, "species", [
              ["rain_tree", 0.5],
              ["frangipani", 0.3],
              ["royal_palm", 0.2],
            ]),
          );
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
        push("trees", "trees/royal_palm", id, p.x, p.z, undefined, { ribbon: false });
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
    tree(id, x, z, hash01(id, "species") < 0.7 ? "rain_tree" : "flame_tree");
  });

  /** Seeded grid-jitter samples (cell = spacing / sqrt 2, one candidate per cell) inside a polygon. */
  const sample = (
    poly: Poly,
    spacing: number,
    tag: string,
    fn: (id: string, x: number, z: number) => void,
  ) => {
    const b = bboxOf(poly[0]!);
    if (!overlapsClip(b)) return;
    const cell = spacing / Math.SQRT2;
    const x0 = Math.max(b[0], clipBox[0]);
    const x1 = Math.min(b[2], clipBox[2]);
    const z0 = Math.max(b[1], clipBox[1]);
    const z1 = Math.min(b[3], clipBox[3]);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const id = `${tag}:${i}:${j}`;
        const x = (i + hash01(id, "jx")) * cell;
        const z = (j + hash01(id, "jz")) * cell;
        if (inPoly(x, z, poly)) fn(id, x, z);
      }
  };

  const parkPolys: Poly[] = featuresOf(input.parks).flatMap((f) => polygonsOf(f.geometry, frame));
  parkPolys.forEach((poly, pi) => {
    sample(poly, PARK_TREE_RADIUS, `pk${pi}`, (id, x, z) =>
      tree(
        id,
        x,
        z,
        pick(id, "species", [
          ["rain_tree", 0.45],
          ["flame_tree", 0.3],
          ["shrub_round", 0.25],
        ]),
      ),
    );
  });

  const constructionPolys: Poly[] = [];
  featuresOf(input.landcover).forEach((f, fi) => {
    const cls = propsOf(f).class;
    for (const [pi, poly] of polygonsOf(f.geometry, frame).entries()) {
      const tag = `lc${fi}_${pi}`;
      if (cls === "grass")
        sample(poly, PARK_TREE_RADIUS, tag, (id, x, z) =>
          tree(
            id,
            x,
            z,
            pick(id, "species", [
              ["rain_tree", 0.45],
              ["flame_tree", 0.3],
              ["shrub_round", 0.25],
            ]),
          ),
        );
      else if (cls === "forest")
        sample(poly, FOREST_SPACING, tag, (id, x, z) =>
          tree(id, x, z, hash01(id, "species") < 0.75 ? "rain_tree" : "coconut_palm"),
        );
      else if (cls === "oil_palm") {
        const b = bboxOf(poly[0]!);
        if (!overlapsClip(b)) continue;
        const gx0 = Math.floor(Math.max(b[0], clipBox[0]) / OIL_PALM_SPACING);
        const gx1 = Math.floor(Math.min(b[2], clipBox[2]) / OIL_PALM_SPACING);
        const gz0 = Math.floor(Math.max(b[1], clipBox[1]) / OIL_PALM_SPACING);
        const gz1 = Math.floor(Math.min(b[3], clipBox[3]) / OIL_PALM_SPACING);
        for (let i = gx0; i <= gx1; i++)
          for (let j = gz0; j <= gz1; j++) {
            const id = `${tag}:${i}:${j}`;
            const x = (i + 0.5) * OIL_PALM_SPACING + (hash01(id, "jx") - 0.5) * 0.6;
            const z = (j + 0.5) * OIL_PALM_SPACING + (hash01(id, "jz") - 0.5) * 0.6;
            if (inPoly(x, z, poly)) tree(id, x, z, "oil_palm");
          }
      } else if (cls === "construction") constructionPolys.push(poly);
    }
  });

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
    along(closed, HOARDING_M, HOARDING_M / 2).forEach((p, i) => {
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
    const place = (key: string, tag: string, minR: number, gap: number) => {
      const s = take(minR, gap);
      if (s)
        push("construction", key, `${tag}${ci}`, s.x, s.z, undefined, {
          ribbon: false,
          building: false,
        });
    };
    if (area > CRANE_MIN_M2) place("construction/tower_crane", "tc", 0, 0);
    place("construction/site_cabin", "sc", 2, 8);
    place("construction/material_stack", "ms0_", 2, 6);
    place("construction/material_stack", "ms1_", 2, 6);
    if (area > EXCAVATOR_MIN_M2) place("construction/excavator", "ex", 3, 8);
  });

  // Apply caps nearest-to-centre first. Trees also keep a minimum gap, so jittered cells never stack.
  const byDist = (a: Cand, b: Cand) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const emit = (kind: PropKind, list: Cand[]) => {
    const cap = capFor(tier, kind);
    // Under a tight cap a site keeps its crane, cabin, stacks and excavator before its hoardings.
    const rank = (c: Cand) => (c.key === "construction/hoarding_6m" ? 1 : 0);
    list.sort((p, q) => rank(p) - rank(q) || byDist(p, q));
    const gap = kind === "trees" ? new Map<string, P[]>() : null;
    let n = 0;
    for (const c of list) {
      if (n >= cap) break;
      if (gap) {
        const k = `${Math.floor(c.x / TREE_MIN_GAP_M)},${Math.floor(c.z / TREE_MIN_GAP_M)}`;
        let clash = false;
        for (let i = -1; i <= 1 && !clash; i++)
          for (let j = -1; j <= 1 && !clash; j++) {
            const near = gap.get(
              `${Math.floor(c.x / TREE_MIN_GAP_M) + i},${Math.floor(c.z / TREE_MIN_GAP_M) + j}`,
            );
            if (near?.some((q) => Math.hypot(q[0] - c.x, q[1] - c.z) < TREE_MIN_GAP_M))
              clash = true;
          }
        if (clash) continue;
        const l = gap.get(k);
        if (l) l.push([c.x, c.z]);
        else gap.set(k, [[c.x, c.z]]);
      }
      const slash = c.key.indexOf("/");
      const asset = c.key.slice(0, slash);
      const variant = c.key.slice(slash + 1);
      const spec = m.assets[asset];
      if (!spec?.variants[variant]) continue;
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
      n++;
    }
    plan.stats[kind] = n;
  };
  emit("trees", cands.trees);
  emit("lamps", cands.lamps);
  emit("furniture", cands.furniture);
  emit("construction", cands.construction);
  return plan;
}
