import { hash01, jitterFor, type Placement, paletteFor } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { type Box, boxCentre, inBox, perLayer, touchesBox } from "../stream/area";
import type { Tile } from "../stream/tiles";
import {
  type BBox,
  bboxOf,
  distToPoly,
  inPoly,
  netArea,
  type P,
  type Poly,
  polygonsOf,
} from "./polyGeom";

/**
 * Construction land, dressed as a construction site. Pure and DECORATIVE: nothing here is a fact
 * about the township (the land cover says "construction"; the cabins, stacks, machines, tracks and
 * tint are illustration), so the scene labels it "Decorative details are illustrative.".
 *
 * Per site: hoarding every 6 m round the boundary (P3), then by net area 1 site cabin per 3,000 m2,
 * 1 material stack per 1,500 m2, 1 excavator per 2,500 m2 and 1 tower crane per 10,000 m2 (at
 * least 1 above 8,000 m2), plus dark tan earth tracks 4 m wide crossing the site. The renderer
 * tints the polygon gravel (`GRAVEL_TINT`).
 *
 * Tiling: a site's whole layout depends only on its polygon and id (cached per polygon), and an
 * item belongs to the box whose half-open range holds its position, so adjacent boxes never both
 * place one. Under a tight cap a site keeps its first items (rank order) and nearer sites win.
 */

export const HOARDING_M = 6;
export const EXCAVATOR_MIN_M2 = 2000;
export const CRANE_MIN_M2 = 8000;
export const CABIN_PER_M2 = 3000;
export const STACK_PER_M2 = 1500;
export const EXCAVATOR_PER_M2 = 2500;
export const CRANE_PER_M2 = 10000;
/** A site never gets more than this many of one kind (a tile cap bites long before). */
export const MAX_PER_KIND = 40;
/** Earth track width (m) and the colours the renderer uses for the tracks and the site tint. */
export const TRACK_WIDTH_M = 4;
export const TRACK_COLOUR: string = CLAY_PALETTE.construction.track;
export const GRAVEL_TINT: string = CLAY_PALETTE.construction.gravel;
/** Floats per track segment in `tracks`: x0, z0, x1, z1 (the centre line; the band is 4 m wide). */
export const TRACK_STRIDE = 4;
const TRACK_STEP_M = 2;
const TRACK_MIN_RUN_M = 6;
const TRACK_PIECE_M = 20;
const TRACK_MAX_PER_BOX = 160;
const FINE_SPOTS_MAX = 3000;
const CRANE_GAP_M = 30;

export interface Site {
  poly: Poly;
  /** A global id (never depends on the box): placements are keyed by it. */
  id: string;
}

interface Item {
  key: string;
  id: string;
  x: number;
  z: number;
  yaw: number;
  /** Lower ranks survive a tight cap first. */
  rank: number;
}
interface Layout {
  items: Item[];
  /** x0, z0, x1, z1 per segment. */
  tracks: number[];
  bb: BBox;
}

const layouts = new WeakMap<Poly, Map<string, Layout>>();

function layoutOf(site: Site, byArea: boolean): Layout {
  let byId = layouts.get(site.poly);
  if (!byId) {
    byId = new Map();
    layouts.set(site.poly, byId);
  }
  const k = `${byArea ? "a" : "p"}:${site.id}`;
  let l = byId.get(k);
  if (!l) {
    l = buildLayout(site, byArea);
    byId.set(k, l);
  }
  return l;
}

interface Spot {
  x: number;
  z: number;
  r: number;
}

function latticeSpots(poly: Poly, b: BBox, step: number): Spot[] {
  const spots: Spot[] = [];
  for (let x = b[0] + step / 2; x < b[2]; x += step)
    for (let z = b[1] + step / 2; z < b[3]; z += step)
      if (inPoly(x, z, poly)) spots.push({ x, z, r: distToPoly(x, z, poly) });
  spots.sort((p, q) => q.r - p.r || p.x - q.x || p.z - q.z);
  return spots;
}

function buildLayout({ poly, id: ci }: Site, byArea: boolean): Layout {
  const ring = poly[0]!;
  const b = bboxOf(ring);
  const area = netArea(poly);
  const items: Item[] = [];

  // Hoardings: every 6 m along the boundary, midpoint of each span, facing outward.
  const closed = [...ring, ring[0]!];
  let perimeter = 0;
  for (let k = 0; k < closed.length - 1; k++)
    perimeter += Math.hypot(closed[k + 1]![0] - closed[k]![0], closed[k + 1]![1] - closed[k]![1]);
  const spans = Math.floor((perimeter - HOARDING_M / 2) / HOARDING_M + 1e-9) + 1;
  let walked = 0;
  let next = HOARDING_M / 2;
  for (let i = 0; i < closed.length - 1; i++) {
    const a = closed[i]!;
    const c = closed[i + 1]!;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len === 0) continue;
    const tx = (c[0] - a[0]) / len;
    const tz = (c[1] - a[1]) / len;
    while (next <= walked + len + 1e-9) {
      const t = next - walked;
      const x = a[0] + tx * t;
      const z = a[1] + tz * t;
      const k = Math.round((next - HOARDING_M / 2) / HOARDING_M);
      const n: P = [tz, -tx];
      const outward = inPoly(x + n[0] * 0.5, z + n[1] * 0.5, poly) ? -1 : 1;
      items.push({
        key: "construction/hoarding_6m",
        id: `hd${ci}:${k}`,
        x,
        z,
        yaw: Math.atan2(n[0] * outward, n[1] * outward),
        rank: k === 0 || k === Math.floor(spans / 2) ? 1 : 5,
      });
      next += HOARDING_M;
    }
    walked += len;
  }

  // Interior spots, roomiest first (distance to the boundary), deterministic.
  const taken: P[] = [];
  // `taken` only grows, so a spot refused for a gap stays refused: remember, per spot list and gap,
  // how far the leading run of refused spots reaches and start the next scan after it.
  const start = new Map<Spot[], Map<number, number>>();
  const takeFrom = (spots: Spot[], minR: number, gap: number): Spot | null => {
    let byGap = start.get(spots);
    if (!byGap) {
      byGap = new Map();
      start.set(spots, byGap);
    }
    let i = byGap.get(gap) ?? 0;
    for (; i < spots.length; i++) {
      const s = spots[i]!;
      if (s.r < minR) break;
      if (taken.every((t) => Math.hypot(t[0] - s.x, t[1] - s.z) >= gap)) {
        taken.push([s.x, s.z]);
        return s;
      }
      // Refused: it stays refused for this gap, so the next scan starts after it.
      byGap.set(gap, i + 1);
    }
    return null;
  };
  const coarse = latticeSpots(poly, b, Math.max(2, Math.min(b[2] - b[0], b[3] - b[1]) / 12));
  const placed = { crane: 0, cabin: 0, stack: 0, excavator: 0 };
  const put = (
    from: Spot[],
    kind: keyof typeof placed,
    key: string,
    id: string,
    minR: number,
    gap: number,
    rank: number,
  ) => {
    const s = takeFrom(from, minR, gap);
    if (!s) return;
    placed[kind]++;
    items.push({ key, id, x: s.x, z: s.z, yaw: hash01(id, "yaw") * Math.PI * 2, rank });
  };
  // The P3 set, unchanged, from the coarse lattice.
  if (area > CRANE_MIN_M2) put(coarse, "crane", "construction/tower_crane", `tc${ci}`, 0, 0, 2);
  put(coarse, "cabin", "construction/site_cabin", `sc${ci}`, 2, 8, 0);
  put(coarse, "stack", "construction/material_stack", `ms0_${ci}`, 2, 6, 4);
  put(coarse, "stack", "construction/material_stack", `ms1_${ci}`, 2, 6, 4);
  if (area > EXCAVATOR_MIN_M2)
    put(coarse, "excavator", "construction/excavator", `ex${ci}`, 3, 8, 3);

  // By area: the rest of the quota, from a finer lattice (only for sites that want more).
  const want = {
    crane: area > CRANE_MIN_M2 ? Math.max(1, Math.floor(area / CRANE_PER_M2)) : 0,
    cabin: Math.max(1, Math.floor(area / CABIN_PER_M2)),
    stack: Math.max(2, Math.floor(area / STACK_PER_M2)),
    excavator: area > EXCAVATOR_MIN_M2 ? Math.max(1, Math.floor(area / EXCAVATOR_PER_M2)) : 0,
  };
  const kinds = Object.keys(want) as (keyof typeof want)[];
  for (const k of kinds) want[k] = Math.min(want[k], MAX_PER_KIND);
  if (byArea && kinds.some((k) => want[k] > placed[k])) {
    const w = b[2] - b[0];
    const h = b[3] - b[1];
    let step = Math.max(4, Math.min(w, h) / 30);
    while ((w / step) * (h / step) > FINE_SPOTS_MAX) step *= 1.25;
    const fine = latticeSpots(poly, b, step);
    for (let k = placed.crane; k < want.crane; k++)
      put(fine, "crane", "construction/tower_crane", `tc${ci}x${k}`, 0, CRANE_GAP_M, 6);
    for (let k = placed.cabin; k < want.cabin; k++)
      put(fine, "cabin", "construction/site_cabin", `sc${ci}x${k}`, 2, 8, 7);
    for (let k = placed.excavator; k < want.excavator; k++)
      put(fine, "excavator", "construction/excavator", `ex${ci}x${k}`, 3, 8, 8);
    for (let k = placed.stack; k < want.stack; k++)
      put(fine, "stack", "construction/material_stack", `ms${k}_${ci}`, 2, 6, 9);
  }

  return { items, tracks: byArea ? tracksFor(poly, ci, b, area) : [], bb: b };
}

/** Earth tracks: parallel lines across the site at a seeded angle, kept where a 4 m band fits. */
function tracksFor(poly: Poly, ci: string, b: BBox, area: number): number[] {
  if (area < 1500) return [];
  const th = hash01(ci, "track") * Math.PI;
  const dx = Math.cos(th);
  const dz = Math.sin(th);
  const nx = -dz;
  const nz = dx;
  const cx = (b[0] + b[2]) / 2;
  const cz = (b[1] + b[3]) / 2;
  const reach = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2;
  const lines = Math.min(4, 1 + Math.floor(area / 8000));
  const spacing = Math.sqrt(area) / (lines + 1);
  const hw = TRACK_WIDTH_M / 2;
  const fits = (x: number, z: number) =>
    inPoly(x, z, poly) &&
    inPoly(x + nx * hw, z + nz * hw, poly) &&
    inPoly(x - nx * hw, z - nz * hw, poly);
  const out: number[] = [];
  for (let li = 0; li < lines; li++) {
    const o = (li - (lines - 1) / 2) * spacing;
    let run: P[] = [];
    const flush = () => {
      if ((run.length - 1) * TRACK_STEP_M >= TRACK_MIN_RUN_M) {
        const per = Math.round(TRACK_PIECE_M / TRACK_STEP_M);
        for (let s = 0; s < run.length - 1; s += per) {
          const a = run[s]!;
          const c = run[Math.min(run.length - 1, s + per)]!;
          out.push(a[0], a[1], c[0], c[1]);
        }
      }
      run = [];
    };
    for (let t = -reach; t <= reach; t += TRACK_STEP_M) {
      const x = cx + dx * t + nx * o;
      const z = cz + dz * t + nz * o;
      if (fits(x, z)) run.push([x, z]);
      else flush();
    }
    flush();
  }
  return out;
}

/**
 * The construction dressing of the sites that fall in `box`. Placements are capped at `cap` (lower
 * rank first, then nearer sites, then nearer items); an asset or variant missing from the manifest
 * is skipped and does not count. `byArea` false gives the P3 set only (one cabin, two stacks, an
 * excavator above 2,000 m2, a crane above 8,000 m2; what `planProps` still uses, so its output is
 * unchanged); true adds the area quotas and the tracks.
 */
export function planConstructionSites(
  sites: Site[],
  box: Box,
  cap: number,
  m: Manifest,
  byArea = true,
): { kits: Map<string, Placement[]>; tracks: Float32Array; count: number } {
  const kits = new Map<string, Placement[]>();
  const [cx, cz] = boxCentre(box);
  const dist = (x: number, z: number) => Math.hypot(x - cx, z - cz);
  const limit = Math.max(0, Math.floor(cap));
  type Cand = Item & { d: number; sd: number };
  const cands: Cand[] = [];
  const segs: { d: number; seg: number[]; n: number }[] = [];
  let n = 0;
  for (const site of sites) {
    const l = layoutOf(site, byArea);
    if (!touchesBox(box, l.bb[0] - 1, l.bb[1] - 1, l.bb[2] + 1, l.bb[3] + 1)) continue;
    const sd = dist((l.bb[0] + l.bb[2]) / 2, (l.bb[1] + l.bb[3]) / 2);
    if (limit > 0)
      for (const it of l.items)
        if (inBox(box, it.x, it.z)) cands.push({ ...it, d: dist(it.x, it.z), sd });
    for (let k = 0; k + 3 < l.tracks.length; k += TRACK_STRIDE) {
      const seg = l.tracks.slice(k, k + TRACK_STRIDE);
      const mx = (seg[0]! + seg[2]!) / 2;
      const mz = (seg[1]! + seg[3]!) / 2;
      if (inBox(box, mx, mz)) segs.push({ d: dist(mx, mz), seg, n: n++ });
    }
  }
  cands.sort(
    (a, b) =>
      a.rank - b.rank || a.sd - b.sd || a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let count = 0;
  for (const c of cands) {
    if (count >= limit) break;
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
    const list = kits.get(c.key);
    if (list) list.push(pl);
    else kits.set(c.key, [pl]);
    count++;
  }
  segs.sort((a, b) => a.d - b.d || a.n - b.n);
  const kept = segs.slice(0, TRACK_MAX_PER_BOX);
  const tracks = new Float32Array(kept.length * TRACK_STRIDE);
  kept.forEach((s, i) => {
    tracks.set(s.seg, i * TRACK_STRIDE);
  });
  return { kits, tracks, count };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const sitesCache = new WeakMap<object, WeakMap<object, Site[]>>();

/** Sites from land-cover features (Polygon / MultiPolygon): ids `${index}.${polygon}`, global to the array. */
export function sitesOf(polys: GeoJSON.Feature[], frame: LocalFrame): Site[] {
  return perLayer(sitesCache, polys, frame, () =>
    polys.flatMap((f, fi) =>
      isRec(f) ? polygonsOf(f.geometry, frame).map((poly, k) => ({ poly, id: `${fi}.${k}` })) : [],
    ),
  );
}

/**
 * Construction land for one tile. `polys` is the whole list of `construction` land-cover features
 * (the same array every tile, so ids are global); `cap` is `tileCap(tier, ring, "construction", ...)`.
 * `m` is the asset manifest (kit variants, palettes); the signature otherwise follows the other
 * tile planners.
 */
export function planConstruction(
  polys: GeoJSON.Feature[],
  tile: Tile,
  frame: LocalFrame,
  cap: number,
  m: Manifest,
): { kits: Map<string, Placement[]>; tracks: Float32Array } {
  const { kits, tracks } = planConstructionSites(sitesOf(polys, frame), tile.box, cap, m);
  return { kits, tracks };
}
