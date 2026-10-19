import type { CrowdLook } from "../assets/crowdManifest";
import { hash01 } from "../assets/fit";
import { type Agent, PEOPLE_SCALE_NEAR } from "./agents";

/**
 * Crowd rules (C-T8): look assignment with no twins nearby (P3), the per-look walking speed, and the
 * keep-out around the hero (P8). DECORATIVE only ("Decorative details are illustrative."): nothing
 * here is a fact, and nothing here reads the journey plan or its events (P9). The keep-out takes the
 * hero's position and heading as plain numbers; the scene glue reads them from the journey store.
 */

// ---------------------------------------------------------------------------------------------
// P3: looks, no twins within 10 m.

/** Two people whose paths come this close (m) may share a frame within it: never the same look (P3). */
export const LOOK_TWIN_M = 10;
/** Grid cell for the path proximity search (m). */
const TWIN_CELL_M = 20;

/** Looks a jogger may take: a lone young or adult body, no prop (a jogging grandparent with a walker reads wrong). */
export const JOGGER_BODIES: ReadonlySet<string> = new Set([
  "school_age",
  "adult_man",
  "adult_woman",
]);

/** Whether `look` suits `agent` (joggers: JOGGER_BODIES without a prop; everyone else: any look). */
export function lookAllowed(agent: Agent, look: CrowdLook): boolean {
  if (agent.variant !== "jogger") return true;
  return JOGGER_BODIES.has(look.body) && look.prop === null;
}

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
export function pathGap(a: Agent, b: Agent): number {
  let best = Number.POSITIVE_INFINITY;
  for (const s of segsOf(a)) for (const t of segsOf(b)) best = Math.min(best, segSeg2(s, t));
  return Math.sqrt(best);
}

/** For each agent index, the indices of agents whose paths come within `r` metres of its path. */
export function pathNeighbours(agents: readonly Agent[], r = LOOK_TWIN_M): number[][] {
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

/** Look index by agent id, kept across motion layer rebuilds (pruned to each rebuild's agents). */
export type LookMemory = Map<string, number>;

/**
 * Seeded, deterministic look per person (P3): no two people whose paths come within LOOK_TWIN_M of
 * each other share a look, so no follow-camera frame shows twins within 10 m. Graph colouring over
 * path proximity: agents in a seeded order (hash of the id), each takes the first free allowed look
 * starting at a seeded index. Agents in `memory` keep their look (a streamed tile arriving never
 * re-dresses the people already on screen); the new ones avoid them. When every allowed look is
 * taken nearby (a dense junction), the look whose nearest same-look path is farthest wins.
 * Returns look index by agent id (person agents only) and updates `memory` when given.
 */
export function assignLooks(
  agents: readonly Agent[],
  looks: readonly CrowdLook[],
  memory?: LookMemory,
): Map<string, number> {
  const people = agents.filter((a) => a.kind === "person");
  const out = new Map<string, number>();
  if (looks.length === 0) return out;
  const nb = pathNeighbours(people);
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
        if (L(o) === l) gap = Math.min(gap, pathGap(a, people[o] as Agent));
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

// ---------------------------------------------------------------------------------------------
// Speed per look.

/**
 * Walking speed share by look (decorative, nothing measured): a prop sets it, else the body.
 *
 * | look                     | share of the planned 1.2–1.5 m/s |
 * |--------------------------|----------------------------------|
 * | walker (older bodies)    | 0.60                             |
 * | older man / older woman  | 0.75                             |
 * | wheelchair               | 0.80                             |
 * | stroller                 | 0.90                             |
 * | child                    | 0.85                             |
 * | school-age, adults       | 1.00                             |
 *
 * Every look is then capped at CADENCE_MAX_HZ walk cycles per second at the near display scale, so
 * short chibi strides never scurry and joggers (2.5 m/s planned) keep a sane run cadence.
 */
export const LOOK_SPEED_SHARE = {
  prop: { walker: 0.6, wheelchair: 0.8, stroller: 0.9 },
  body: {
    child: 0.85,
    school_age: 1,
    adult_man: 1,
    adult_woman: 1,
    older_man: 0.75,
    older_woman: 0.75,
  },
} as const;
/** Walk cycles per second at most (two steps a cycle: 180 steps a minute, a run cadence). */
export const CADENCE_MAX_HZ = 1.5;

/**
 * The speed (m/s) a crowd person walks at with `look`, whose walk clip covers `stride` true metres
 * per cycle: the planned speed times the look's share, capped so the cycle rate at the near display
 * scale (1.55x) stays at most CADENCE_MAX_HZ. The gait integrates the distance walked, so the
 * cadence always matches this speed (P5); see crowdGait.ts.
 */
export function lookSpeed(agent: Agent, look: CrowdLook, stride: number): number {
  const share = look.prop
    ? LOOK_SPEED_SHARE.prop[look.prop]
    : (LOOK_SPEED_SHARE.body[look.body] ?? 1);
  const want = agent.speed * share;
  const cap = stride > 0 ? CADENCE_MAX_HZ * stride * PEOPLE_SCALE_NEAR : want;
  return Math.min(want, cap);
}

// ---------------------------------------------------------------------------------------------
// P8: keep-out around the hero.

/**
 * The hero as the crowd sees her: local metres, heading (yaw = atan2(dx, dz)) and, when the hero side
 * publishes it, `ahead`: points of her path over her next KEEP_OUT_AHEAD_M (position data only, never
 * an event; ruling C-T8 fix 1). Without `ahead` the next 10 m are taken along her heading.
 */
export interface HeroXZ {
  x: number;
  z: number;
  yaw: number;
  ahead?: readonly (readonly [number, number])[];
}
/** No crowd person within this distance (m) of the hero or of her next KEEP_OUT_AHEAD_M (P8). */
export const KEEP_OUT_M = 2;
/** The stretch ahead of her that is kept clear (m). */
export const KEEP_OUT_AHEAD_M = 10;
/** People are moved out to KEEP_OUT_M plus this margin (covers the 0.25 m sampling of `ahead`). */
const KEEP_OUT_PAD_M = 0.25;
/**
 * The zone's two ends (behind her, and the tip of her next 10 m) are half-ellipses this long (m), so
 * a person near her line is eased aside over a few metres instead of swept round a 2 m cap.
 */
export const KEEP_OUT_CAP_M = 6;
/** Pushes per frame against the zone's segments (a bend can push a person into its neighbour). */
const KEEP_OUT_ITER = 4;

export interface KeepOutResult {
  x: number;
  z: number;
  /** True when the person must not be drawn this frame (it crossed her path inside the zone). */
  hidden: boolean;
}
/** Per-person keep-out memory: the side of her path it is held on while inside the zone. */
export interface KeepOutMemory {
  side?: 1 | -1;
}

type XZ = readonly [number, number];
/** The zone's spine: her position, then her path ahead (or 10 m along her heading). */
export function keepOutSpine(hero: HeroXZ): XZ[] {
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
export function keepOut(
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
  const spine = keepOutSpine(hero);
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

/** Distance (m) from a point to a polyline. */
export function polylineDistance(x: number, z: number, pts: readonly XZ[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as XZ;
    const b = pts[i + 1] as XZ;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  if (pts.length === 1) best = Math.hypot(x - (pts[0] as XZ)[0], z - (pts[0] as XZ)[1]);
  return best;
}

/** Distance (m) from a point to the keep-out spine (her and her next 10 m). */
export function keepOutDistance(x: number, z: number, hero: HeroXZ): number {
  return polylineDistance(x, z, keepOutSpine(hero));
}
