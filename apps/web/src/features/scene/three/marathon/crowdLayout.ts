import { runnerAt } from "../../../closures/marathonCinematic";

/**
 * T-031 where the marathon's 3D people stand, in local metres (x east, z south). Pure. Runners
 * jog along the course in lanes, lined up in a grid behind the start until the run shot; spectators
 * stand beside the closed course on both sides (none at side-street junctions) and cluster at the
 * start / finish. Positions are decoration: never crowd sizes.
 */

type XZ = [number, number];

export interface Placement {
  x: number;
  z: number;
  /** Facing (rad), `atan2(dx, dz)` as the crowd models use it. */
  yaw: number;
  /** Runner: jogging (false once finished). Spectator: always false. */
  moving: boolean;
  /** 0..1 per person, for gait phase and cheering. */
  seed: number;
}

/** Runner lanes across the course (metres from its centre line); the lead runs on the centre. */
export const LANES_M = [0, -1.6, 1.6, -3.2, 3.2] as const;
/** Metres between rows in the start grid. */
export const GRID_ROW_M = 2.2;
/** Spectators: one spot every SPECTATOR_STEP_M along the course, this far to the side. */
export const SPECTATOR_STEP_M = 32;
export const SPECTATOR_SIDE_M = 7.5;
/** No spectator within this of a side-street junction (the cones' places). */
export const JUNCTION_GAP_M = 16;
/** People in the cluster at the start / finish arch. */
export const ARCH_CLUSTER = 16;
export const MAX_SPECTATORS = 140;

const seedOf = (i: number) => (((i * 0.754877) % 1) + 1) % 1;

/** A polyline in local metres with lookups by distance along it. */
export function localPath(points: readonly XZ[]) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as XZ;
    const b = points[i] as XZ;
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[cum.length - 1] ?? 0;
  const at = (d: number): XZ => {
    if (points.length < 2) return (points[0] ?? [0, 0]) as XZ;
    const dd = Math.max(0, Math.min(length, d));
    let i = 1;
    while (i < cum.length - 1 && (cum[i] as number) < dd) i++;
    const a = points[i - 1] as XZ;
    const b = points[i] as XZ;
    const span = (cum[i] as number) - (cum[i - 1] as number) || 1;
    const u = (dd - (cum[i - 1] as number)) / span;
    return [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])];
  };
  const dir = (d: number): XZ => {
    const a = at(d - 6);
    const b = at(d + 6);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l > 1e-6 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [0, -1];
  };
  return { length, at, dir };
}

/** Right of travel (x east, z south): facing east (+x), +z is the right. */
const rightOf = (f: XZ): XZ => [-f[1], f[0]];
const yawOf = (f: XZ) => Math.atan2(f[0], f[1]);

/**
 * Runner `i` at screen time t: on its lane at its distance along the course; before the start
 * it waits in the grid behind the start line (row i / lanes); after the finish it stands still.
 */
export function runnerPlacement(p: ReturnType<typeof localPath>, t: number, i: number): Placement {
  const lane = LANES_M[i % LANES_M.length] ?? 0;
  const row = Math.floor(i / LANES_M.length);
  const d = p.length * runnerAt(t, i) - row * GRID_ROW_M;
  const f = p.dir(Math.max(0, d));
  const base = p.at(Math.max(0, d));
  const back = Math.min(0, d); // still behind the start line
  const r = rightOf(f);
  return {
    x: base[0] + f[0] * back + r[0] * lane,
    z: base[1] + f[1] * back + r[1] * lane,
    yaw: yawOf(f),
    moving: runnerAt(t, i) > 0 && runnerAt(t, i) < 1,
    seed: seedOf(i),
  };
}

/**
 * Spectators: a pair every SPECTATOR_STEP_M, alternating sides of the course, facing it, none
 * within JUNCTION_GAP_M of a junction; plus ARCH_CLUSTER around the start (and the finish when it
 * is elsewhere). At most MAX_SPECTATORS.
 */
export function spectatorPlacements(
  p: ReturnType<typeof localPath>,
  junctions: readonly XZ[],
): Placement[] {
  const out: Placement[] = [];
  const face = (x: number, z: number, c: XZ) => Math.atan2(c[0] - x, c[1] - z);
  const near = (x: number, z: number) =>
    junctions.some((j) => Math.hypot(j[0] - x, j[1] - z) < JUNCTION_GAP_M);
  const ends: XZ[] = [p.at(0)];
  const fin = p.at(p.length);
  if (Math.hypot(fin[0] - (ends[0]?.[0] ?? 0), fin[1] - (ends[0]?.[1] ?? 0)) > 30) ends.push(fin);
  for (const [k, c] of ends.entries()) {
    const f = p.dir(k === 0 ? 0 : p.length);
    const r = rightOf(f);
    for (let n = 0; n < ARCH_CLUSTER; n++) {
      const side = n % 2 === 0 ? 1 : -1;
      const along = ((n >> 1) % 4) * 2.4 - 3.6;
      const out2 = SPECTATOR_SIDE_M + Math.floor(n / 8) * 1.8;
      const x = c[0] + f[0] * along + r[0] * side * out2;
      const z = c[1] + f[1] * along + r[1] * side * out2;
      out.push({ x, z, yaw: face(x, z, c), moving: false, seed: seedOf(out.length) });
    }
  }
  for (let d = SPECTATOR_STEP_M, s = 0; d < p.length - 10; d += SPECTATOR_STEP_M, s++) {
    const c = p.at(d);
    const f = p.dir(d);
    const r = rightOf(f);
    const side = s % 2 === 0 ? 1 : -1;
    for (const along of [0, 1.3]) {
      const x = c[0] + f[0] * along + r[0] * side * SPECTATOR_SIDE_M;
      const z = c[1] + f[1] * along + r[1] * side * SPECTATOR_SIDE_M;
      if (near(x, z)) continue;
      out.push({ x, z, yaw: face(x, z, c), moving: false, seed: seedOf(out.length) });
    }
    if (out.length >= MAX_SPECTATORS) break;
  }
  return out.slice(0, MAX_SPECTATORS);
}

/** Cheering (decorative): a small hop and a sway on the idle pose, per person. */
export function cheer(t: number, seed: number): { lift: number; sway: number } {
  const a = t * 7 + seed * Math.PI * 2;
  return { lift: 0.14 * Math.max(0, Math.sin(a)), sway: 0.22 * Math.sin(t * 2.3 + seed * 9) };
}
