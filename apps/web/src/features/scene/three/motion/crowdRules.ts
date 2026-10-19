import type { CrowdLook } from "../assets/crowdManifest";
import { hash01 } from "../assets/fit";
import { nearRadius } from "../assets/treeCut";
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

/**
 * A path's segments and, per proximity-grid cell its segments reach (each segment's box grown by
 * LOOK_TWIN_M / 2), the indices of those segments. Built once per path array and cached (GATE
 * AC-D18: the look search re-cut every path on every motion-layer rebuild). Two segments closer
 * than LOOK_TWIN_M always share a cell (the midpoint of their closest points is in both grown
 * boxes), so testing only the segments that share a cell finds exactly the same neighbours.
 */
interface PathCells {
  segs: Seg[];
  cells: Map<number, number[]>;
  /** nearGap2 results by the other path (many people share a path: copies, pavements). */
  gaps: WeakMap<PathCells, number>;
}
const cellKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
const pathCellsCache = new WeakMap<Float32Array, PathCells>();
function pathCellsOf(a: Agent): PathCells {
  const hit = pathCellsCache.get(a.path);
  if (hit) return hit;
  const segs = segsOf(a);
  const cells = new Map<number, number[]>();
  const r = LOOK_TWIN_M;
  const cell = (v: number) => Math.floor(v / TWIN_CELL_M);
  segs.forEach((s, k) => {
    for (let i = cell(Math.min(s[0], s[2]) - r / 2); i <= cell(Math.max(s[0], s[2]) + r / 2); i++)
      for (
        let j = cell(Math.min(s[1], s[3]) - r / 2);
        j <= cell(Math.max(s[1], s[3]) + r / 2);
        j++
      ) {
        const key = cellKey(i, j);
        const l = cells.get(key);
        if (l) l.push(k);
        else cells.set(key, [k]);
      }
  });
  const out: PathCells = { segs, cells, gaps: new WeakMap() };
  pathCellsCache.set(a.path, out);
  return out;
}

/**
 * The smallest squared distance between segments of two paths that share a grid cell (infinity when
 * none do), cached per pair of paths. When it is under LOOK_TWIN_M^2 it is the paths' true closest
 * approach squared (the closest pair shares a cell), so it serves both the neighbour test and the
 * fallback's gap.
 */
function nearGap2(a: PathCells, b: PathCells): number {
  if (a === b) return 0;
  const hit = a.gaps.get(b);
  if (hit !== undefined) return hit;
  const small = a.cells.size <= b.cells.size ? a : b;
  const big = small === a ? b : a;
  let best = Number.POSITIVE_INFINITY;
  for (const [c, ks] of small.cells) {
    const os = big.cells.get(c);
    if (!os) continue;
    for (const k of ks)
      for (const o of os) best = Math.min(best, segSeg2(small.segs[k] as Seg, big.segs[o] as Seg));
  }
  a.gaps.set(b, best);
  b.gaps.set(a, best);
  return best;
}

/** Whether two paths come within LOOK_TWIN_M (only the segments sharing a grid cell are tested). */
function pathsNear(a: PathCells, b: PathCells): boolean {
  return nearGap2(a, b) < LOOK_TWIN_M * LOOK_TWIN_M;
}

/** Closest approach (m) of two agents' paths: an upper bound on how close they can ever be. */
export function pathGap(a: Agent, b: Agent): number {
  let best = Number.POSITIVE_INFINITY;
  const sa = pathCellsOf(a).segs;
  const sb = pathCellsOf(b).segs;
  for (const s of sa) for (const t of sb) best = Math.min(best, segSeg2(s, t));
  return Math.sqrt(best);
}

/**
 * The proximity index of one agent set: its distinct paths by grid cell, and the people on each path
 * (copies and pavement walkers often share one), so neighbours are found path to path.
 */
interface ProxIndex {
  grid: Map<number, PathCells[]>;
  people: Map<PathCells, number[]>;
  near: Map<PathCells, PathCells[]>;
}
function proxIndexOf(agents: readonly Agent[]): ProxIndex {
  const grid = new Map<number, PathCells[]>();
  const people = new Map<PathCells, number[]>();
  agents.forEach((a, k) => {
    const pc = pathCellsOf(a);
    const on = people.get(pc);
    if (on) {
      on.push(k);
      return;
    }
    people.set(pc, [k]);
    for (const c of pc.cells.keys()) {
      const l = grid.get(c);
      if (l) l.push(pc);
      else grid.set(c, [pc]);
    }
  });
  return { grid, people, near: new Map() };
}

/** Indices of the agents (other than `k`) whose paths come within LOOK_TWIN_M of agent k's path. */
function neighboursOf(agents: readonly Agent[], ix: ProxIndex, k: number): number[] {
  const mine = pathCellsOf(agents[k] as Agent);
  let near = ix.near.get(mine);
  if (!near) {
    const seen = new Set<PathCells>();
    near = [];
    for (const c of mine.cells.keys())
      for (const o of ix.grid.get(c) ?? []) {
        if (seen.has(o)) continue;
        seen.add(o);
        if (pathsNear(mine, o)) near.push(o);
      }
    ix.near.set(mine, near);
  }
  const out: number[] = [];
  for (const pc of near) for (const o of ix.people.get(pc) ?? []) if (o !== k) out.push(o);
  return out;
}

/** For each agent index, the indices of agents whose paths come within LOOK_TWIN_M of its path. */
export function pathNeighbours(agents: readonly Agent[]): number[][] {
  const ix = proxIndexOf(agents);
  return agents.map((_a, k) => neighboursOf(agents, ix, k));
}

/** Look index by agent id, kept across motion layer rebuilds (pruned to each rebuild's agents). */
export type LookMemory = Map<string, number>;

/**
 * An incremental look assignment (assignLooks in slices). `step(budgetMs)` works until the budget is
 * spent and returns true when done; `result()` is then the same map assignLooks returns for the same
 * inputs, and `memory` (when given) is updated once, at the end. Only people who are not in memory
 * are searched for neighbours (survivors keep their look and cost nothing), and the paths' grid
 * cells are cached per path, so a streamed tile arriving costs work for its own people only.
 * Slicing changes when the work happens, never the result (GATE AC-D18).
 */
export interface LookJob {
  /** Works for about `budgetMs` (at least one unit of work); true when done. */
  step(budgetMs: number, now?: () => number): boolean;
  readonly done: boolean;
  result(): Map<string, number>;
  /** Neighbour searches run so far (tests: survivors cost none). */
  readonly searched: number;
}

export function lookJob(
  agents: readonly Agent[],
  looks: readonly CrowdLook[],
  memory?: LookMemory,
): LookJob {
  const people = agents.filter((a) => a.kind === "person");
  const out = new Map<string, number>();
  const lookOf = new Int32Array(people.length).fill(-1);
  const L = (k: number): number => lookOf[k] ?? -1;
  const n = looks.length;
  // Phases: 0 order + survivors, 1 path cells (cached per path), 2 grid, 3 new people, 4 done.
  let phase = 0;
  let order: number[] = [];
  let cursor = 0;
  let grid: ProxIndex = { grid: new Map(), people: new Map(), near: new Map() };
  let searched = 0;

  const assignOne = (i: number) => {
    const a = people[i] as Agent;
    const nb = neighboursOf(people, grid, i);
    const mine = pathCellsOf(a);
    searched++;
    const taken = new Set<number>();
    for (const o of nb) if (L(o) >= 0) taken.add(L(o));
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
      // Neighbours are within LOOK_TWIN_M, so the cached shared-cell gap is their exact pathGap.
      for (const o of nb)
        if (L(o) === l)
          gap = Math.min(gap, Math.sqrt(nearGap2(mine, pathCellsOf(people[o] as Agent))));
      if (gap > fallbackGap) {
        fallbackGap = gap;
        fallback = l;
      }
    }
    lookOf[i] = pick >= 0 ? pick : fallback >= 0 ? fallback : start;
  };

  const finish = () => {
    if (n > 0)
      people.forEach((a, i) => {
        out.set(a.id, L(i));
      });
    if (memory && n > 0) {
      memory.clear();
      for (const [id, l] of out) memory.set(id, l);
    }
    phase = 4;
  };

  /** One unit of work; false when there is none left. */
  const unit = (): boolean => {
    if (phase === 0) {
      if (n === 0) {
        finish();
        return false;
      }
      order = people
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
      phase = 1;
      cursor = 0;
      return true;
    }
    if (phase === 1) {
      if (cursor < people.length) {
        pathCellsOf(people[cursor] as Agent);
        cursor++;
        return true;
      }
      grid = proxIndexOf(people);
      phase = 3;
      cursor = 0;
      return true;
    }
    if (phase === 3) {
      while (cursor < order.length && L(order[cursor] as number) >= 0) cursor++;
      if (cursor < order.length) {
        assignOne(order[cursor] as number);
        cursor++;
        return true;
      }
      finish();
      return false;
    }
    return false;
  };

  return {
    get done() {
      return phase === 4;
    },
    get searched() {
      return searched;
    },
    result() {
      if (phase !== 4) throw new Error("lookJob: not done");
      return out;
    },
    step(budgetMs, now = () => performance.now()) {
      const t0 = now();
      while (unit()) if (now() - t0 >= budgetMs) return phase === 4;
      return true;
    },
  };
}

/**
 * Seeded, deterministic look per person (P3): no two people whose paths come within LOOK_TWIN_M of
 * each other share a look, so no follow-camera frame shows twins within 10 m. Graph colouring over
 * path proximity: agents in a seeded order (hash of the id), each takes the first free allowed look
 * starting at a seeded index. Agents in `memory` keep their look (a streamed tile arriving never
 * re-dresses the people already on screen); the new ones avoid them. When every allowed look is
 * taken nearby (a dense junction), the look whose nearest same-look path is farthest wins.
 * Returns look index by agent id (person agents only) and updates `memory` when given. This is the
 * whole `lookJob` at once; the scene runs the job in slices instead (useMotion).
 */
export function assignLooks(
  agents: readonly Agent[],
  looks: readonly CrowdLook[],
  memory?: LookMemory,
): Map<string, number> {
  const job = lookJob(agents, looks, memory);
  while (!job.step(Number.POSITIVE_INFINITY));
  return job.result();
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
  /**
   * True while she is not walking (a rest, a look, sitting down or standing up: her drawn clip is
   * not the walk). Position-like data from her pose, never an event (P9): the crowd keeps
   * HOLD_KEEP_OUT_M from her then (ITER2).
   */
  hold?: boolean;
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
 * The spine as plain numbers, reused by every keepOut call (GATE C-T8 review minor: no per-person,
 * per-frame allocations). Filled by `fillSpine`; `spineN` points are valid.
 */
let spineX = new Float64Array(64);
let spineZ = new Float64Array(64);
let spineN = 0;
function pushSpine(x: number, z: number): void {
  if (spineN === spineX.length) {
    const nx = new Float64Array(spineN * 2);
    const nz = new Float64Array(spineN * 2);
    nx.set(spineX);
    nz.set(spineZ);
    spineX = nx;
    spineZ = nz;
  }
  spineX[spineN] = x;
  spineZ[spineN] = z;
  spineN++;
}
/** keepOutSpine(hero) into the shared buffers, without allocating. */
function fillSpine(hero: HeroXZ): void {
  spineN = 0;
  pushSpine(hero.x, hero.z);
  const ahead = hero.ahead;
  if (ahead && ahead.length > 0) {
    for (const p of ahead) {
      const lx = spineX[spineN - 1] as number;
      const lz = spineZ[spineN - 1] as number;
      if (Math.hypot(p[0] - lx, p[1] - lz) > 1e-6) pushSpine(p[0], p[1]);
    }
    if (spineN > 1) return;
  }
  pushSpine(
    hero.x + Math.sin(hero.yaw) * KEEP_OUT_AHEAD_M,
    hero.z + Math.cos(hero.yaw) * KEEP_OUT_AHEAD_M,
  );
}

/** One segment's zone test, written in place (see segZone). */
interface Zone {
  a: number;
  s: number;
  need: number;
  fx: number;
  fz: number;
  ox: number;
  oz: number;
}
const newZone = (): Zone => ({ a: 0, s: 0, need: 0, fx: 0, fz: 0, ox: 0, oz: 0 });
const _zone = newZone();
const _best = newZone();

/**
 * Inside test for segment `i` of the spine (the shared buffers): (along, across, need) in the
 * segment's frame, written into `out`, where the person is inside when |across| < need. The first
 * segment's start and the last segment's end are half-ellipses KEEP_OUT_CAP_M long; joints between
 * segments are round (radius R).
 */
function segZone(i: number, x: number, z: number, R: number, out: Zone): Zone {
  const ax = spineX[i] as number;
  const az = spineZ[i] as number;
  const bx = spineX[i + 1] as number;
  const bz = spineZ[i + 1] as number;
  const L = Math.hypot(bx - ax, bz - az);
  const fx = (bx - ax) / L;
  const fz = (bz - az) / L;
  const rx = x - ax;
  const rz = z - az;
  const a = rx * fx + rz * fz;
  const s = rx * fz - rz * fx;
  const da = a - Math.max(0, Math.min(L, a));
  const cap = da < 0 ? (i === 0 ? KEEP_OUT_CAP_M : R) : i === spineN - 2 ? KEEP_OUT_CAP_M : R;
  const e = da / cap;
  out.a = a;
  out.s = s;
  out.need = Math.abs(e) >= 1 ? 0 : R * Math.sqrt(1 - e * e);
  out.fx = fx;
  out.fz = fz;
  out.ox = ax;
  out.oz = az;
  return out;
}

/**
 * Moves a crowd person out of the keep-out zone around the hero: everything within KEEP_OUT_M
 * (+0.25 m) of her and of her path over the next KEEP_OUT_AHEAD_M (`hero.ahead`, else her heading),
 * with half-ellipse ends KEEP_OUT_CAP_M long. A person inside is moved across the nearest zone
 * segment to its edge, on the side it entered (remembered in `mem` while inside), so it steps aside
 * as she passes; positions stay continuous in time. A person on the other side of her path from its
 * remembered side (it crossed her line inside the zone), or one a bend cannot push clear, is hidden
 * until it is clear (never drawn through her). Outside the zone nothing changes. The crowd never
 * stops the hero: she never reads this (P8). Allocation-free (shared spine and zone buffers): the
 * motion layer calls it for every person on every frame.
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
  fillSpine(hero);
  let px = x;
  let pz = z;
  let touched = false;
  for (let it = 0; it < KEEP_OUT_ITER; it++) {
    // The segment whose zone the person is deepest in (largest need - |across|).
    let found = false;
    let depth = 0;
    for (let i = 0; i < spineN - 1; i++) {
      const zn = segZone(i, px, pz, R, _zone);
      const d = zn.need - Math.abs(zn.s);
      if (d > depth) {
        depth = d;
        Object.assign(_best, zn);
        found = true;
      }
    }
    if (!found) {
      if (!touched) mem.side = undefined;
      out.x = px;
      out.z = pz;
      return out;
    }
    touched = true;
    const best = _best;
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
  for (let i = 0; i < spineN - 1; i++) {
    const zn = segZone(i, px, pz, R, _zone);
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

// ---------------------------------------------------------------------------------------------
// ITER2 (owner video): journey decor clearance. DECORATIVE only; pure functions of the agent's
// pose, her drawn pose and the camera at that frame, so a seek and a play to t agree (AC-D17).

/** While she holds (not walking), no crowd person within this distance (m) of her. */
export const HOLD_KEEP_OUT_M = 6;
/**
 * While a journey is shown, no crowd person this close (m, ground distance) to the camera at the
 * follow distance (`nearRadius`): for a farther hold camera, nobody nearer the camera than
 * PEOPLE_NEAR_SHARE of her distance (a figure that close is drawn far larger than her, cut by the
 * frame's edge: the giant heads of f_011 / f_021).
 */
export const NEAR_CAMERA_PEOPLE_M = 6.5;
/** ... nor this close (m, ground) to the line from the camera to her (a whole figure, never half cut). */
export const PEOPLE_LINE_M = 2.5;
export const PEOPLE_NEAR_SHARE = 0.75;
/**
 * While a journey is shown, no decorative vehicle (moving traffic) with its centre within this
 * distance (m) of her, of her next 10 m (the keep-out spine), or of the ground line from the camera
 * to her: a car is ~4.5 m long, so ~4 m clear of its body near her route.
 */
export const VEHICLE_CLEAR_M = 6.5;

function segDist2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  const ex = x - ax - dx * t;
  const ez = z - az - dz * t;
  return ex * ex + ez * ez;
}

/**
 * Whether a decorative vehicle at (x, z) may be drawn: false near her route (her and her next 10 m)
 * or between the camera and her (ITER2: a pickup parked beside her, a car across her path at the
 * crossing, a car at the camera's feet at the rest). Always true without a journey hero.
 */
export function vehicleClear(
  x: number,
  z: number,
  hero: HeroXZ | null | undefined,
  camera: { x: number; z: number },
): boolean {
  if (!hero) return true;
  const r2 = VEHICLE_CLEAR_M * VEHICLE_CLEAR_M;
  if (segDist2(x, z, camera.x, camera.z, hero.x, hero.z) < r2) return false;
  if (Math.hypot(x - hero.x, z - hero.z) > KEEP_OUT_AHEAD_M + VEHICLE_CLEAR_M + 1) return true;
  fillSpine(hero);
  for (let i = 0; i < spineN - 1; i++) {
    const d2 = segDist2(
      x,
      z,
      spineX[i] as number,
      spineZ[i] as number,
      spineX[i + 1] as number,
      spineZ[i + 1] as number,
    );
    if (d2 < r2) return false;
  }
  return true;
}

/**
 * Whether a decorative person at (x, z) may be drawn while a journey is shown: never within
 * NEAR_CAMERA_PEOPLE_M of the camera (giant heads at the frame's edge) nor, while she holds, within
 * HOLD_KEEP_OUT_M of her. Always true without a journey hero.
 */
export function personClear(
  x: number,
  z: number,
  hero: HeroXZ | null | undefined,
  camera: { x: number; z: number },
): boolean {
  if (!hero) return true;
  const d = Math.hypot(camera.x - hero.x, camera.z - hero.z);
  if (
    Math.hypot(x - camera.x, z - camera.z) < nearRadius(d, NEAR_CAMERA_PEOPLE_M, PEOPLE_NEAR_SHARE)
  )
    return false;
  if (segDist2(x, z, camera.x, camera.z, hero.x, hero.z) < PEOPLE_LINE_M * PEOPLE_LINE_M)
    return false;
  if (hero.hold && Math.hypot(x - hero.x, z - hero.z) < HOLD_KEEP_OUT_M) return false;
  return true;
}

/**
 * Whether an agent is in the mood's thinned share (`share` in [0, 1]): a hash of its own id, so
 * the decision never depends on which other agents (streamed tiles) are in the set (ITER2 AC-D17:
 * a rank in the union of streamed tiles drew one more crowd figure after a different seek history).
 */
export function densityShown(id: string, share: number): boolean {
  if (share >= 1) return true;
  return hash01(id, "density") < share;
}
