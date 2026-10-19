/**
 * TEST ONLY: the crowd rules and path walk as they were before the GATE AC-D18 fix (look search over
 * every pair of paths, allocating keep-out, linear path walk), kept verbatim as the reference the
 * optimised versions must match exactly.
 */
import type { CrowdLook } from "../assets/crowdManifest";
import { hash01 } from "../assets/fit";
import type { Agent, Pose2 } from "./agents";
import {
  type HeroXZ,
  KEEP_OUT_AHEAD_M,
  KEEP_OUT_CAP_M,
  KEEP_OUT_M,
  type KeepOutMemory,
  type KeepOutResult,
  LOOK_TWIN_M,
  lookAllowed,
} from "./crowdRules";

const TWIN_CELL_M = 20;
const KEEP_OUT_PAD_M = 0.25;
const KEEP_OUT_ITER = 4;
type LookMemory = Map<string, number>;
const setPose = (out: Pose2, x: number, z: number, yaw: number) => {
  out.x = x;
  out.z = z;
  out.yaw = yaw;
  return out;
};

type Seg = [number, number, number, number];

function segsOf(a: Agent): Seg[] {
  const p = a.path;
  const out: Seg[] = [];
  for (let i = 0; i + 3 < p.length; i += 2)
    out.push([p[i] as number, p[i + 1] as number, p[i + 2] as number, p[i + 3] as number]);
  if (out.length === 0 && p.length >= 2)
    out.push([p[0] as number, p[1] as number, p[0] as number, p[1] as number]);
  return out;
}

function ptSeg2(px: number, pz: number, s: Seg): number {
  const dx = s[2] - s[0];
  const dz = s[3] - s[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / l2));
  const ex = px - (s[0] + t * dx);
  const ez = pz - (s[1] + t * dz);
  return ex * ex + ez * ez;
}

const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;

/** Squared distance between two segments (0 when they cross). */
function segSeg2(a: Seg, b: Seg): number {
  const d1 = cross(a[2] - a[0], a[3] - a[1], b[0] - a[0], b[1] - a[1]);
  const d2 = cross(a[2] - a[0], a[3] - a[1], b[2] - a[0], b[3] - a[1]);
  const d3 = cross(b[2] - b[0], b[3] - b[1], a[0] - b[0], a[1] - b[1]);
  const d4 = cross(b[2] - b[0], b[3] - b[1], a[2] - b[0], a[3] - b[1]);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    ptSeg2(a[0], a[1], b),
    ptSeg2(a[2], a[3], b),
    ptSeg2(b[0], b[1], a),
    ptSeg2(b[2], b[3], a),
  );
}

/** Closest approach (m) of two agents' paths: an upper bound on how close they can ever be. */
export function refPathGap(a: Agent, b: Agent): number {
  let best = Number.POSITIVE_INFINITY;
  for (const s of segsOf(a)) for (const t of segsOf(b)) best = Math.min(best, segSeg2(s, t));
  return Math.sqrt(best);
}

/** For each agent index, the indices of agents whose paths come within `r` metres of its path. */
export function refPathNeighbours(agents: readonly Agent[], r = LOOK_TWIN_M): number[][] {
  const cell = (v: number) => Math.floor(v / TWIN_CELL_M);
  const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
  const grid = new Map<number, number[]>();
  const segs = agents.map(segsOf);
  const cellsOf = (k: number) => {
    const set = new Set<number>();
    for (const s of segs[k] as Seg[])
      for (let i = cell(Math.min(s[0], s[2]) - r / 2); i <= cell(Math.max(s[0], s[2]) + r / 2); i++)
        for (
          let j = cell(Math.min(s[1], s[3]) - r / 2);
          j <= cell(Math.max(s[1], s[3]) + r / 2);
          j++
        )
          set.add(key(i, j));
    return set;
  };
  const cells = agents.map((_a, k) => cellsOf(k));
  cells.forEach((set, k) => {
    for (const c of set) {
      const l = grid.get(c);
      if (l) l.push(k);
      else grid.set(c, [k]);
    }
  });
  const r2 = r * r;
  return agents.map((_a, k) => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const c of cells[k] as Set<number>)
      for (const o of grid.get(c) ?? []) {
        if (o === k || seen.has(o)) continue;
        seen.add(o);
        let near = false;
        for (const s of segs[k] as Seg[]) {
          for (const t of segs[o] as Seg[])
            if (segSeg2(s, t) < r2) {
              near = true;
              break;
            }
          if (near) break;
        }
        if (near) out.push(o);
      }
    return out;
  });
}

export function refAssignLooks(
  agents: readonly Agent[],
  looks: readonly CrowdLook[],
  memory?: LookMemory,
): Map<string, number> {
  const people = agents.filter((a) => a.kind === "person");
  const out = new Map<string, number>();
  if (looks.length === 0) return out;
  const nb = refPathNeighbours(people);
  const lookOf = new Int32Array(people.length).fill(-1);
  const L = (k: number): number => lookOf[k] ?? -1;
  const order = people
    .map((a, i) => ({ i, h: hash01(a.id, "look-order"), id: a.id }))
    .sort((a, b) => a.h - b.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((o) => o.i);
  // Survivors first, in the same seeded order.
  for (const i of order) {
    const a = people[i] as Agent;
    const kept = memory?.get(a.id);
    if (kept !== undefined && looks[kept] && lookAllowed(a, looks[kept] as CrowdLook))
      lookOf[i] = kept;
  }
  for (const i of order) {
    if (L(i) >= 0) continue;
    const a = people[i] as Agent;
    const taken = new Set<number>();
    for (const o of nb[i] as number[]) if (L(o) >= 0) taken.add(L(o));
    const n = looks.length;
    const start = Math.floor(hash01(a.id, "look") * n) % n;
    let pick = -1;
    let fallback = -1;
    let fallbackGap = -1;
    for (let s = 0; s < n; s++) {
      const l = (start + s) % n;
      if (!lookAllowed(a, looks[l] as CrowdLook)) continue;
      if (!taken.has(l)) {
        pick = l;
        break;
      }
      let gap = Number.POSITIVE_INFINITY;
      for (const o of nb[i] as number[])
        if (L(o) === l) gap = Math.min(gap, refPathGap(a, people[o] as Agent));
      if (gap > fallbackGap) {
        fallbackGap = gap;
        fallback = l;
      }
    }
    lookOf[i] = pick >= 0 ? pick : fallback >= 0 ? fallback : start;
  }
  people.forEach((a, i) => {
    out.set(a.id, L(i));
  });
  if (memory) {
    memory.clear();
    for (const [id, l] of out) memory.set(id, l);
  }
  return out;
}

type XZ = readonly [number, number];
/** The zone's spine: her position, then her path ahead (or 10 m along her heading). */
function refSpine(hero: HeroXZ): XZ[] {
  const out: XZ[] = [[hero.x, hero.z]];
  if (hero.ahead && hero.ahead.length > 0) {
    for (const p of hero.ahead) {
      const l = out[out.length - 1] as XZ;
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) out.push(p);
    }
    if (out.length > 1) return out;
  }
  out.push([
    hero.x + Math.sin(hero.yaw) * KEEP_OUT_AHEAD_M,
    hero.z + Math.cos(hero.yaw) * KEEP_OUT_AHEAD_M,
  ]);
  return out;
}

/**
 * Inside test for segment `i` of the spine: (along, across, need) in the segment's frame, where the
 * person is inside when |across| < need. The first segment's start and the last segment's end are
 * half-ellipses KEEP_OUT_CAP_M long; joints between segments are round (radius R).
 */
function segZone(spine: XZ[], i: number, x: number, z: number, R: number) {
  const a0 = spine[i] as XZ;
  const b0 = spine[i + 1] as XZ;
  const L = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const fx = (b0[0] - a0[0]) / L;
  const fz = (b0[1] - a0[1]) / L;
  const rx = x - a0[0];
  const rz = z - a0[1];
  const a = rx * fx + rz * fz;
  const s = rx * fz - rz * fx;
  const da = a - Math.max(0, Math.min(L, a));
  const cap = da < 0 ? (i === 0 ? KEEP_OUT_CAP_M : R) : i === spine.length - 2 ? KEEP_OUT_CAP_M : R;
  const e = da / cap;
  const need = Math.abs(e) >= 1 ? 0 : R * Math.sqrt(1 - e * e);
  return { a, s, need, fx, fz, ox: a0[0], oz: a0[1] };
}

/**
 * Moves a crowd person out of the keep-out zone around the hero: everything within KEEP_OUT_M
 * (+0.25 m) of her and of her path over the next KEEP_OUT_AHEAD_M (`hero.ahead`, else her heading),
 * with half-ellipse ends KEEP_OUT_CAP_M long. A person inside is moved across the nearest zone
 * segment to its edge, on the side it entered (remembered in `mem` while inside), so it steps aside
 * as she passes; positions stay continuous in time. A person on the other side of her path from its
 * remembered side (it crossed her line inside the zone), or one a bend cannot push clear, is hidden
 * until it is clear (never drawn through her). Outside the zone nothing changes. The crowd never
 * stops the hero: she never reads this (P8).
 */
export function refKeepOut(
  x: number,
  z: number,
  hero: HeroXZ | null | undefined,
  mem: KeepOutMemory,
  out: KeepOutResult = { x: 0, z: 0, hidden: false },
): KeepOutResult {
  out.x = x;
  out.z = z;
  out.hidden = false;
  if (!hero) {
    mem.side = undefined;
    return out;
  }
  const R = KEEP_OUT_M + KEEP_OUT_PAD_M;
  // Far from her: nothing to do (the spine is at most ~10 m long, the caps 6 m).
  if (Math.hypot(x - hero.x, z - hero.z) > KEEP_OUT_AHEAD_M + KEEP_OUT_CAP_M + R + 1) {
    mem.side = undefined;
    return out;
  }
  const spine = refSpine(hero);
  let px = x;
  let pz = z;
  let touched = false;
  for (let it = 0; it < KEEP_OUT_ITER; it++) {
    // The segment whose zone the person is deepest in (largest need - |across|).
    let best: ReturnType<typeof segZone> | null = null;
    let depth = 0;
    for (let i = 0; i < spine.length - 1; i++) {
      const zn = segZone(spine, i, px, pz, R);
      const d = zn.need - Math.abs(zn.s);
      if (d > depth) {
        depth = d;
        best = zn;
      }
    }
    if (!best) {
      if (!touched) mem.side = undefined;
      out.x = px;
      out.z = pz;
      return out;
    }
    touched = true;
    const sign: 1 | -1 = best.s > 0 ? 1 : best.s < 0 ? -1 : (mem.side ?? 1);
    if (mem.side === undefined) mem.side = sign;
    if (sign !== mem.side && Math.abs(best.s) > 1e-6) {
      out.hidden = true;
      return out;
    }
    const ns = mem.side * best.need;
    px = best.ox + best.fx * best.a + best.fz * ns;
    pz = best.oz + best.fz * best.a - best.fx * ns;
  }
  // Still inside after the pushes (the inside of a sharp bend): not drawn this frame.
  for (let i = 0; i < spine.length - 1; i++) {
    const zn = segZone(spine, i, px, pz, R);
    if (Math.abs(zn.s) < zn.need - 1e-9) {
      out.hidden = true;
      return out;
    }
  }
  out.x = px;
  out.z = pz;
  return out;
}

/** Point and tangent yaw at arc length s along the polyline (zero-length segments skipped). */
export function refAlong(p: Float32Array, s: number, out: Pose2): Pose2 {
  const n = p.length / 2;
  let lastYaw = 0;
  let lx = p[0] as number;
  let lz = p[1] as number;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[2 * i] as number;
    const az = p[2 * i + 1] as number;
    const dx = (p[2 * i + 2] as number) - ax;
    const dz = (p[2 * i + 3] as number) - az;
    const l = Math.hypot(dx, dz);
    if (l === 0) continue;
    lastYaw = Math.atan2(dx, dz);
    lx = ax + dx;
    lz = az + dz;
    if (s <= l) {
      const t = Math.max(0, s / l);
      return setPose(out, ax + dx * t, az + dz * t, lastYaw);
    }
    s -= l;
  }
  return setPose(out, lx, lz, lastYaw);
}
