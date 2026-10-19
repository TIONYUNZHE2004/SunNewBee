import * as THREE from "three";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { area, cleanRing, distToEdges, inside, writeBox } from "./roofPlan";

/**
 * The Kanopi podium deck (ruling P4-M): planter boxes, a raised pool and a pergola on the roof of
 * the OSM podium under the Kanopi slab (the source's facility plan shows a Level 7 deck). Pure and
 * decorative only: nothing here is a fact about the deck's layout, and it never changes the
 * podium's footprint or height. The podium stays drawn and pickable under it.
 */

/** The pool plane sits this far above the podium roof (a raised basin). */
export const POOL_LIFT_M = 1.2;
/** Base-water colour (never the flood blue). */
export const DECK_POOL_COLOUR: string = CLAY_PALETTE.baseWater;
/** Nothing within this distance of the podium edge. */
const EDGE_CLEAR_M = 1.0;
/** Nothing within this distance of the tower plate (and never on it). */
const TOWER_CLEAR_M = 1.5;
/** Pool sizes tried, largest first: length along the long axis, width (m). */
const POOL_SIZES: ReadonlyArray<[number, number]> = [
  [22, 8],
  [16, 6],
  [10, 4],
];
const COPING_M = 0.4;
const PERGOLA = { l: 8, w: 4, h: 2.6, post: 0.25, slats: 7 } as const;
const PLANTER = { l: 3, w: 1, h: 0.6 } as const;
const PLANTER_PITCH_M = 7;
const MAX_PLANTERS = 24;
/** Keep-out gap around the pool and the pergola for other items (m). */
const ITEM_GAP_M = 1.5;
/** Rectangles are probed along their outline at this step (m). */
const PROBE_M = 1;

const COLOUR = CLAY_PALETTE.deck;

type Pt = [number, number];

export interface PodiumDeck {
  /** mat4 per box (unit box with its base at y = 0 of its own frame): basin, pergola, planters. */
  boxes: Float32Array;
  /** rgb (0..1) per box. */
  colours: Float32Array;
  /** mat4 of the pool plane (unit plane in x-z), at y = podium height + POOL_LIFT_M. */
  pool: Float32Array;
  parts: { planters: number; pergola: number };
}

/** An axis-aligned rectangle in the roof's (u, v) frame. */
interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.u0 < b.u1 + gap && b.u0 < a.u1 + gap && a.v0 < b.v1 + gap && b.v0 < a.v1 + gap;

/**
 * Deck items for one podium roof: `avoid` are the plates standing on it (the tower), kept clear
 * by 1.5 m. Null when the roof is degenerate or has no room for the pool. Deterministic.
 */
export function podiumDeck(
  b: { id: string; ring: ReadonlyArray<readonly [number, number]>; heightM: number },
  avoid: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [],
): PodiumDeck | null {
  const pts = cleanRing(b.ring);
  if (!pts || !Number.isFinite(b.heightM) || Math.abs(area(pts)) < 100) return null;
  const plates = avoid.map((r) => cleanRing(r)).filter((r): r is Pt[] => !!r);
  const y = b.heightM;

  // Long axis: the longest edge's direction.
  let ux = 1;
  let uz = 0;
  let longest = -1;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[(i + 1) % pts.length]!;
    const l = Math.hypot(bx - ax, bz - az);
    if (l > longest) {
      longest = l;
      ux = (bx - ax) / l;
      uz = (bz - az) / l;
    }
  }
  const vx = -uz;
  const vz = ux;
  const at = (pu: number, pv: number): Pt => [pu * ux + pv * vx, pu * uz + pv * vz];
  const toU = (p: readonly [number, number]) => p[0] * ux + p[1] * uz;
  const toV = (p: readonly [number, number]) => p[0] * vx + p[1] * vz;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    minU = Math.min(minU, toU(p));
    maxU = Math.max(maxU, toU(p));
    minV = Math.min(minV, toV(p));
    maxV = Math.max(maxV, toV(p));
  }

  /**
   * Distance from (x, z) to the edge of the free deck (the podium inset by 1.0 m, minus the plates
   * grown by 1.5 m); negative outside it.
   */
  const clearance = (x: number, z: number) => {
    if (!inside(pts, x, z)) return Number.NEGATIVE_INFINITY;
    let c = distToEdges(pts, x, z) - EDGE_CLEAR_M;
    for (const r of plates) {
      if (inside(r, x, z)) return Number.NEGATIVE_INFINITY;
      c = Math.min(c, distToEdges(r, x, z) - TOWER_CLEAR_M);
    }
    return c;
  };
  const freeUv = (pu: number, pv: number) => clearance(pu * ux + pv * vx, pu * uz + pv * vz) >= 0;
  const cornersUv = [...plates.flat(), ...pts].map((p) => [toU(p), toV(p)] as const);
  const taken: Rect[] = [];
  /**
   * The whole rectangle is free. Its centre's clearance decides most cases (below the inscribed
   * radius: an obstacle is inside; above the circumscribed radius: all clear); otherwise its
   * outline is probed every PROBE_M and no plate or podium corner may poke into it.
   */
  const fits = (r: Rect, gap = ITEM_GAP_M) => {
    if (taken.some((t) => overlaps(r, t, gap))) return false;
    const hu = (r.u1 - r.u0) / 2;
    const hv = (r.v1 - r.v0) / 2;
    const cu = r.u0 + hu;
    const cv = r.v0 + hv;
    const c = clearance(cu * ux + cv * vx, cu * uz + cv * vz);
    if (c < Math.min(hu, hv)) return false;
    if (c >= Math.hypot(hu, hv)) return true;
    // Corners first: most rejections happen there.
    if (!freeUv(r.u0, r.v0) || !freeUv(r.u1, r.v0) || !freeUv(r.u0, r.v1) || !freeUv(r.u1, r.v1))
      return false;
    const nu = Math.max(1, Math.ceil((r.u1 - r.u0) / PROBE_M));
    const nv = Math.max(1, Math.ceil((r.v1 - r.v0) / PROBE_M));
    for (let i = 0; i <= nu; i++) {
      const pu = r.u0 + ((r.u1 - r.u0) * i) / nu;
      if (!freeUv(pu, r.v0) || !freeUv(pu, r.v1)) return false;
    }
    for (let j = 1; j < nv; j++) {
      const pv = r.v0 + ((r.v1 - r.v0) * j) / nv;
      if (!freeUv(r.u0, pv) || !freeUv(r.u1, pv)) return false;
    }
    for (const [pu, pv] of cornersUv)
      if (pu > r.u0 && pu < r.u1 && pv > r.v0 && pv < r.v1) return false;
    return true;
  };
  const rectAt = (cu: number, cv: number, l: number, w: number): Rect => ({
    u0: cu - l / 2,
    u1: cu + l / 2,
    v0: cv - w / 2,
    v1: cv + w / 2,
  });

  // Candidate centres on a 2 m grid; the pool goes as far from the tower as it fits.
  const grid: Pt[] = [];
  for (let pu = minU; pu <= maxU; pu += 2)
    for (let pv = minV; pv <= maxV; pv += 2) grid.push([pu, pv]);
  let cu0 = (minU + maxU) / 2;
  let cv0 = (minV + maxV) / 2;
  const plateCentre = plates[0];
  if (plateCentre) {
    cu0 = plateCentre.reduce((s, p) => s + toU(p), 0) / plateCentre.length;
    cv0 = plateCentre.reduce((s, p) => s + toV(p), 0) / plateCentre.length;
  }
  const sortedBy = (key: (p: Pt) => number) => {
    const k = grid.map(key);
    return grid
      .map((_, i) => i)
      .sort((a, c) => k[a]! - k[c]!)
      .map((i) => grid[i]!);
  };
  const sign = plateCentre ? -1 : 1;
  const byFar = sortedBy((p) => sign * Math.hypot(p[0] - cu0, p[1] - cv0));

  let pool: Rect | null = null;
  for (const [l, w] of POOL_SIZES) {
    for (const [pu, pv] of byFar) {
      const r = rectAt(pu, pv, l + 2 * COPING_M, w + 2 * COPING_M);
      if (fits(r, 0)) {
        pool = r;
        break;
      }
    }
    if (pool) break;
  }
  if (!pool) return null;
  taken.push(pool);

  const boxes: number[] = [];
  const colours: number[] = [];
  const box = (r: Rect, base: number, h: number, hex: string) => {
    const [cx, cz] = at((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    writeBox(boxes, cx, base, cz, ux, uz, r.u1 - r.u0, h, r.v1 - r.v0);
    colours.push(...new THREE.Color(hex).toArray());
  };
  // Basin (coping) under the water: its top just below the pool plane.
  box(pool, y, POOL_LIFT_M - 0.05, COLOUR.coping);
  const water = rectAt(
    (pool.u0 + pool.u1) / 2,
    (pool.v0 + pool.v1) / 2,
    pool.u1 - pool.u0 - 2 * COPING_M,
    pool.v1 - pool.v0 - 2 * COPING_M,
  );
  const poolM: number[] = [];
  const [wx, wz] = at((water.u0 + water.u1) / 2, (water.v0 + water.v1) / 2);
  writeBox(poolM, wx, y + POOL_LIFT_M, wz, ux, uz, water.u1 - water.u0, 1, water.v1 - water.v0);

  // Pergola: the free spot nearest the pool.
  const pc: Pt = [(pool.u0 + pool.u1) / 2, (pool.v0 + pool.v1) / 2];
  const near = sortedBy((p) => Math.hypot(p[0] - pc[0], p[1] - pc[1]));
  let pergola = 0;
  for (const [pu, pv] of near) {
    const r = rectAt(pu, pv, PERGOLA.l, PERGOLA.w);
    if (!fits(r)) continue;
    taken.push(r);
    const p = PERGOLA.post;
    for (const [qu, qv] of [
      [r.u0 + p / 2, r.v0 + p / 2],
      [r.u1 - p / 2, r.v0 + p / 2],
      [r.u0 + p / 2, r.v1 - p / 2],
      [r.u1 - p / 2, r.v1 - p / 2],
    ] as const)
      box(rectAt(qu, qv, p, p), y, PERGOLA.h, COLOUR.timber);
    // Two beams along the long side, then slats across them.
    for (const qv of [r.v0 + p / 2, r.v1 - p / 2])
      box(rectAt((r.u0 + r.u1) / 2, qv, PERGOLA.l, p), y + PERGOLA.h, 0.25, COLOUR.timber);
    for (let i = 0; i < PERGOLA.slats; i++) {
      const qu = r.u0 + 0.3 + ((PERGOLA.l - 0.6) * i) / (PERGOLA.slats - 1);
      box(
        rectAt(qu, (r.v0 + r.v1) / 2, 0.15, PERGOLA.w),
        y + PERGOLA.h + 0.25,
        0.12,
        COLOUR.timber,
      );
    }
    pergola = 4 + 2 + PERGOLA.slats;
    break;
  }

  // Planters: a regular grid over the free deck, each a concrete box with a green top.
  let planters = 0;
  for (
    let pu = minU + PLANTER_PITCH_M / 2;
    pu <= maxU && planters < MAX_PLANTERS;
    pu += PLANTER_PITCH_M
  )
    for (
      let pv = minV + PLANTER_PITCH_M / 2;
      pv <= maxV && planters < MAX_PLANTERS;
      pv += PLANTER_PITCH_M
    ) {
      const r = rectAt(pu, pv, PLANTER.l, PLANTER.w);
      if (!fits(r)) continue;
      taken.push(r);
      box(r, y, PLANTER.h, COLOUR.planter);
      box(rectAt(pu, pv, PLANTER.l - 0.3, PLANTER.w - 0.3), y + PLANTER.h, 0.5, COLOUR.green);
      planters++;
    }

  return {
    boxes: new Float32Array(boxes),
    colours: new Float32Array(colours),
    pool: new Float32Array(poolM),
    parts: { planters, pergola },
  };
}
