import * as THREE from "three";
import { hash01 } from "../assets/fit";
import type { LocalFrame } from "../frame";
import {
  bboxOf,
  distSeg,
  distToPoly,
  inPoly,
  netArea,
  type P,
  type Poly,
  polygonsOf,
} from "../props/polyGeom";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { type Box, inBox, touchesBox } from "../stream/area";
import { VERGE_Y } from "./bands";

/**
 * A-T10 land dressing by class (flowers, crop rows, construction cones and mounds). Pure,
 * seeded by global ids, so adjacent tiles never double a piece (a piece belongs to the box holding
 * its position). DECORATIVE ("Decorative details are illustrative."): display only, never read by
 * routing, flood or answers, never within DRESS_WALK_CLEAR_M of a walk line, cut to the boundary by
 * `guardTile`. The trees of forest, scrub and oil palm are kit instances of the props planner, the
 * parked cars are the parking planner's, and the hoardings, cabins and machines are the
 * construction kit's; this planner adds what those lack. No buildings are ever added here.
 */

/** Floats per dressing triangle: three vertices of x y z r g b. */
export const DRESS_STRIDE = 18;
/** A dressing piece stays this far (plus its own reach) from any walk line. */
export const DRESS_WALK_CLEAR_M = 1;

/** Per ring: flower clumps per tile, cones, mounds, farm row spacing and triangle cap. */
export const DRESS_LOD = {
  flowers: { 0: 90, 1: 18, 2: 0 },
  cones: { 0: 48, 1: 0, 2: 0 },
  mounds: { 0: 8, 1: 8, 2: 4 },
  rowSpacingM: { 0: 3, 1: 4.5, 2: 9 },
  rowMaxTris: { 0: 900, 1: 400, 2: 120 },
} as const;
const FLOWER_CELL_M = 7;
const FLOWER_SHARE = 0.4;
const FLOWER_R_M = 0.3;
const FLOWER_LIFT = 0.02;
const CONE_STEP_M = 14;
const CONE_INSET_M = 2.2;
const CONE_R_M = 0.28;
const CONE_H_M = 0.65;
const MOUND_R_M = [1.8, 3.2] as const;
const MOUND_H_M = [0.7, 1.3] as const;
const MOUND_PER_M2 = 1500;
const MOUND_MAX_PER_SITE = 6;
const ROW_W_FRAC = 0.5;
const ROW_STEP_M = 3;

export interface DressingInput {
  /** `buildings.landcover` FeatureCollection (`class`), already cut to the outline. */
  landcover: unknown;
  /** The walk layer (LineStrings): every line is a keep-out. */
  walk: unknown;
  frame: LocalFrame;
  box: Box;
  /** Ring distance of the tile (0 near). */
  ring: 0 | 1 | 2;
  tier: "low" | "medium" | "high";
}

export interface DressingCounts {
  flowerClumps: number;
  rowStripes: number;
  cones: number;
  mounds: number;
  triangles: number;
}
export interface DressingPlan {
  tris: Float32Array;
  counts: DressingCounts;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

interface Land {
  poly: Poly;
  id: string;
  bb: [number, number, number, number];
}

/** The polygons of the given classes that touch the box, by class. */
function landsOf(
  landcover: unknown,
  frame: LocalFrame,
  classes: readonly string[],
  box: Box,
): Map<string, Land[]> {
  const out = new Map<string, Land[]>(classes.map((c) => [c, []]));
  const feats = isRec(landcover) && Array.isArray(landcover.features) ? landcover.features : [];
  feats.forEach((f, fi) => {
    if (!isRec(f)) return;
    const props = isRec(f.properties) ? f.properties : {};
    const list = typeof props.class === "string" ? out.get(props.class) : undefined;
    if (!list) return;
    const fid = String(props.osm ?? props.id ?? fi);
    polygonsOf(f.geometry, frame).forEach((poly, pi) => {
      const bb = bboxOf(poly[0]!);
      if (touchesBox(box, ...bb)) list.push({ poly, id: `${fid}:${pi}`, bb });
    });
  });
  return out;
}

/** Walk segments within `reach` of the box. */
function walkNear(walk: unknown, frame: LocalFrame, box: Box, reach: number): [P, P][] {
  const feats = isRec(walk) && Array.isArray(walk.features) ? walk.features : [];
  const out: [P, P][] = [];
  for (const f of feats) {
    const g = isRec(f) && isRec(f.geometry) ? f.geometry : null;
    if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates)) continue;
    const pts: P[] = [];
    for (const c of g.coordinates) {
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        pts.push(frame.toLocal(c[0] as number, c[1] as number));
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const hit = touchesBox(
        box,
        Math.min(a[0], b[0]) - reach,
        Math.min(a[1], b[1]) - reach,
        Math.max(a[0], b[0]) + reach,
        Math.max(a[1], b[1]) + reach,
      );
      if (hit) out.push([a, b]);
    }
  }
  return out;
}

type V3 = [number, number, number];
class Soup {
  readonly f: number[] = [];
  tri(a: V3, b: V3, c: V3, col: THREE.Color) {
    for (const v of [a, b, c]) this.f.push(v[0], v[1], v[2], col.r, col.g, col.b);
  }
  get triangles() {
    return this.f.length / DRESS_STRIDE;
  }
}

/** One tile's land dressing. Counts are reported per kind. Low plans nothing, Medium half. */
export function planDressing(inp: DressingInput): DressingPlan {
  const { frame, box, ring, tier } = inp;
  const counts: DressingCounts = {
    flowerClumps: 0,
    rowStripes: 0,
    cones: 0,
    mounds: 0,
    triangles: 0,
  };
  if (tier === "low") return { tris: new Float32Array(0), counts };
  const scale = tier === "medium" ? 0.5 : 1;
  const lands = landsOf(inp.landcover, frame, ["grass", "farmland", "construction"], box);
  const grass = lands.get("grass")!;
  const farm = lands.get("farmland")!;
  const sites = lands.get("construction")!;
  if (grass.length + farm.length + sites.length === 0) return { tris: new Float32Array(0), counts };
  const soup = new Soup();
  const walk = walkNear(inp.walk, frame, box, 12);
  const nearWalk = (x: number, z: number, r: number) =>
    walk.some(([a, b]) => distSeg(x, z, a, b) < r + DRESS_WALK_CLEAR_M);

  // Flower clumps on grass: a global 7 m lattice, 40 % of the cells, three flowers each.
  const flowerCap = Math.floor(DRESS_LOD.flowers[ring] * scale);
  if (grass.length > 0 && flowerCap > 0) {
    const cand: { x: number; z: number; id: string; rank: number }[] = [];
    const i0 = Math.floor(box.x0 / FLOWER_CELL_M);
    const i1 = Math.floor((box.x1 - 1e-6) / FLOWER_CELL_M);
    const j0 = Math.floor(box.z0 / FLOWER_CELL_M);
    const j1 = Math.floor((box.z1 - 1e-6) / FLOWER_CELL_M);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const id = `fl:${i},${j}`;
        if (hash01(id, "on") >= FLOWER_SHARE) continue;
        const x = (i + 0.15 + 0.7 * hash01(id, "x")) * FLOWER_CELL_M;
        const z = (j + 0.15 + 0.7 * hash01(id, "z")) * FLOWER_CELL_M;
        if (!inBox(box, x, z)) continue;
        if (!grass.some((l) => inPoly(x, z, l.poly) && distToPoly(x, z, l.poly) > 1.5)) continue;
        if (nearWalk(x, z, 1.2)) continue;
        cand.push({ x, z, id, rank: hash01(id, "rank") });
      }
    cand.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
    const palette = CLAY_PALETTE.prop.flowers;
    for (const c of cand.slice(0, flowerCap)) {
      for (let k = 0; k < 3; k++) {
        const a = hash01(c.id, `a${k}`) * Math.PI * 2;
        const off = k > 0 ? 0.45 : 0;
        const fx = c.x + Math.cos(a) * off;
        const fz = c.z + Math.sin(a) * off;
        const col = new THREE.Color(palette[Math.floor(hash01(c.id, `c${k}`) * palette.length)]);
        const y = VERGE_Y + FLOWER_LIFT;
        for (let t = 0; t < 6; t++) {
          const a0 = (t / 6) * Math.PI * 2;
          const a1 = ((t + 1) / 6) * Math.PI * 2;
          soup.tri(
            [fx, y, fz],
            [fx + Math.cos(a0) * FLOWER_R_M, y, fz + Math.sin(a0) * FLOWER_R_M],
            [fx + Math.cos(a1) * FLOWER_R_M, y, fz + Math.sin(a1) * FLOWER_R_M],
            col,
          );
        }
      }
      counts.flowerClumps++;
    }
  }

  // Crop rows on farmland: alternating tone stripes along a per-field heading.
  const rowCap = Math.floor(DRESS_LOD.rowMaxTris[ring] * scale);
  const spacing = DRESS_LOD.rowSpacingM[ring];
  const rowCol = new THREE.Color(CLAY_PALETTE.dress.farmRow);
  const rowAlt = new THREE.Color(CLAY_PALETTE.dress.farmRowAlt);
  let rowTris = 0;
  for (const l of farm) {
    const yaw = hash01(l.id, "yaw") * Math.PI;
    const ux = Math.cos(yaw);
    const uz = Math.sin(yaw);
    const vx = -uz;
    const vz = ux;
    const us: number[] = [];
    const vs: number[] = [];
    for (const [x, z] of l.poly[0]!) {
      us.push(x * ux + z * uz);
      vs.push(x * vx + z * vz);
    }
    const u0 = Math.min(...us);
    const u1 = Math.max(...us);
    const v0 = Math.min(...vs);
    const v1 = Math.max(...vs);
    const w = spacing * ROW_W_FRAC;
    const at = (uu: number, vv: number, y = VERGE_Y + 0.01): V3 => [
      uu * ux + vv * vx,
      y,
      uu * uz + vv * vz,
    ];
    for (let v = Math.ceil(v0 / spacing) * spacing; v < v1 && rowTris < rowCap; v += spacing) {
      const col = Math.round(v / spacing) % 2 !== 0 ? rowAlt : rowCol;
      const cur: { r: [number, number] | null } = { r: null };
      const flush = () => {
        const r = cur.r;
        cur.r = null;
        if (!r || rowTris + 2 > rowCap) return;
        const m = at((r[0] + r[1]) / 2, v);
        if (!inBox(box, m[0], m[2])) return;
        soup.tri(at(r[0], v - w / 2), at(r[1], v - w / 2), at(r[1], v + w / 2), col);
        soup.tri(at(r[0], v - w / 2), at(r[1], v + w / 2), at(r[0], v + w / 2), col);
        rowTris += 2;
        counts.rowStripes++;
      };
      for (let u = Math.floor(u0 / ROW_STEP_M) * ROW_STEP_M; u <= u1; u += ROW_STEP_M) {
        const c = at(u + ROW_STEP_M / 2, v);
        const ok =
          inPoly(c[0], c[2], l.poly) &&
          distToPoly(c[0], c[2], l.poly) > w &&
          !nearWalk(c[0], c[2], w / 2 + ROW_STEP_M / 2);
        if (ok) cur.r = cur.r ? [cur.r[0], u + ROW_STEP_M] : [u, u + ROW_STEP_M];
        else flush();
      }
      flush();
    }
  }

  // Construction land: dirt mounds inside, traffic cones just inside the hoarding line.
  const coneCap = Math.floor(DRESS_LOD.cones[ring] * scale);
  const moundCap = Math.floor(DRESS_LOD.mounds[ring] * scale);
  const coneCol = new THREE.Color(CLAY_PALETTE.prop.awningRed);
  const moundCol = new THREE.Color(CLAY_PALETTE.dress.mound);
  const fan = (x: number, z: number, r: number, h: number, n: number, col: THREE.Color) => {
    for (let t = 0; t < n; t++) {
      const a0 = (t / n) * Math.PI * 2;
      const a1 = ((t + 1) / n) * Math.PI * 2;
      soup.tri(
        [x + Math.cos(a0) * r, VERGE_Y, z + Math.sin(a0) * r],
        [x + Math.cos(a1) * r, VERGE_Y, z + Math.sin(a1) * r],
        [x, VERGE_Y + h, z],
        col,
      );
    }
  };
  for (const l of sites) {
    // Candidates are drawn inside this tile's part of the site (a site can span many tiles).
    const rx0 = Math.max(l.bb[0], box.x0);
    const rz0 = Math.max(l.bb[1], box.z0);
    const rx1 = Math.min(l.bb[2], box.x1);
    const rz1 = Math.min(l.bb[3], box.z1);
    const part = Math.min(netArea(l.poly), (rx1 - rx0) * (rz1 - rz0));
    const want = Math.min(MOUND_MAX_PER_SITE, Math.max(1, Math.floor(part / MOUND_PER_M2)));
    let placed = 0;
    for (let k = 0; k < want * 10 && placed < want && counts.mounds < moundCap; k++) {
      const id = `${l.id}:${Math.round(box.x0)},${Math.round(box.z0)}:m${k}`;
      const x = rx0 + hash01(id, "x") * (rx1 - rx0);
      const z = rz0 + hash01(id, "z") * (rz1 - rz0);
      const r = MOUND_R_M[0] + (MOUND_R_M[1] - MOUND_R_M[0]) * hash01(id, "r");
      if (!inPoly(x, z, l.poly) || distToPoly(x, z, l.poly) < r + 1.5 || nearWalk(x, z, r))
        continue;
      fan(x, z, r, MOUND_H_M[0] + (MOUND_H_M[1] - MOUND_H_M[0]) * hash01(id, "h"), 8, moundCol);
      counts.mounds++;
      placed++;
    }
    if (coneCap === 0) continue;
    const rg = l.poly[0]!;
    for (let i = 0; i < rg.length && counts.cones < coneCap; i++) {
      const a = rg[i]!;
      const b = rg[(i + 1) % rg.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const tx = (b[0] - a[0]) / len;
      const tz = (b[1] - a[1]) / len;
      for (let s = CONE_STEP_M / 2; s < len && counts.cones < coneCap; s += CONE_STEP_M) {
        for (const sign of [1, -1]) {
          const x = a[0] + tx * s - tz * sign * CONE_INSET_M;
          const z = a[1] + tz * s + tx * sign * CONE_INSET_M;
          if (!inPoly(x, z, l.poly)) continue;
          if (inBox(box, x, z) && !nearWalk(x, z, CONE_R_M)) {
            fan(x, z, CONE_R_M, CONE_H_M, 6, coneCol);
            counts.cones++;
          }
          break;
        }
      }
    }
  }
  counts.triangles = soup.triangles;
  return { tris: Float32Array.from(soup.f), counts };
}
