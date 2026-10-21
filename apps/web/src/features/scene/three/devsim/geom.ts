import type { DevelopmentPlan } from "../../../devsim/types";
import type { LocalFrame } from "../frame";
import { planExtras } from "./setPieces";

/** A point in the local frame's ground plane: x east, z = -north (metres). */
export type XZ = [x: number, z: number];

/** Storey height of the hypothetical tower (the facade plan's storey). */
export const TOWER_STOREY_M = 3.2;

/**
 * The plan's site in local metres (pure). Everything the devsim scene places derives from the plan
 * (`site`, `anchors`, `facts.detour`) and the closed walk edge, never from the seed directly.
 */
export interface SiteGeom {
  /** Tower footprint ring (local, not closed). */
  ring: XZ[];
  centre: XZ;
  /** Unit vector the door faces (out of the lobby), local x/z. */
  out: XZ;
  /** Unit vector along the door's face (left of `out` seen from above). */
  side: XZ;
  door: XZ;
  /** The entrance path, door first (local). */
  path: XZ[];
  /** Where the entrance path meets the walk network (its last point). */
  node: XZ;
  /** The construction yard centre (behind the tower, away from the entrance). */
  yard: XZ;
  /** The closed walk edge (hoarded frontage), or [] when the plan has no detour. */
  closed: XZ[];
  /** The detour route (after) near the site, or []. */
  detour: XZ[];
  halimPath: XZ[];
  farid: XZ;
  junction: XZ;
  park: XZ;
  mall: XZ;
  /** Unit direction of the frontage street at the junction (along the closed footway, else the door face). */
  street: XZ;
  /** Unit vector from the junction's footway out onto the carriageway (away from the tower). */
  kerbOut: XZ;
  /**
   * The street lane the school-run queue and the Handover lorries stand in (owner fix, 4.png): the
   * mapped street from the junction outward, following the road centreline (never a straight line
   * across lots), with the lane offset to the left of a car facing the junction (left-hand traffic).
   */
  lane: QueueLane;
  /**
   * The plan's lorry route (C7 `lorry_route`, main road first, site gate last), local; [] when the
   * plan has none (today's 66 s plan: the Handover lorries keep the lane).
   */
  lorryRoute: XZ[];
  /** Radius of the footprint (centre to farthest corner). */
  radius: number;
  storeys: number;
}

/** A drawn street centreline (local) and its half width (the stylised road corridor, `roads.ts`). */
export interface LaneRoad {
  pts: XZ[];
  halfW: number;
}

/** A street lane from the junction outward: centreline, the street's half width, the lane offset. */
export interface QueueLane {
  /** Centreline, junction first (local). */
  pts: XZ[];
  halfW: number;
  /** Lane centre's distance from the centreline, to the left of a car facing the junction. */
  off: number;
  /** True when it follows mapped streets (false: the straight fallback without road data). */
  mapped: boolean;
}

const sub = (a: XZ, b: XZ): XZ => [a[0] - b[0], a[1] - b[1]];
const len = (a: XZ) => Math.hypot(a[0], a[1]);
const norm = (a: XZ): XZ => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

export function lengthOf(pts: readonly XZ[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i] as XZ, pts[i - 1] as XZ));
  return s;
}

/** Point and heading (yaw about +y, three.js: 0 faces +x... see `yawOf`) at distance d along pts. */
export function along(pts: readonly XZ[], d: number): { p: XZ; dir: XZ } {
  if (pts.length === 0) return { p: [0, 0], dir: [1, 0] };
  if (pts.length === 1) return { p: [...(pts[0] as XZ)], dir: [1, 0] };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as XZ;
    const b = pts[i] as XZ;
    const l = len(sub(b, a));
    if (acc + l >= d || i === pts.length - 1) {
      const u = Math.max(0, Math.min(1, (d - acc) / Math.max(l, 1e-6)));
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: norm(sub(b, a)) };
    }
    acc += l;
  }
  return { p: [...(pts[0] as XZ)], dir: [1, 0] };
}

/**
 * Three.js yaw (rotation about +y) that turns a model facing +z (glTF forward, the crowd's) to face
 * the ground direction `dir`.
 */
export const yawOf = (dir: XZ) => Math.atan2(dir[0], dir[1]);

/** The part of `before` not on `after` (points not shared within 0.5 m): the closed edge. */
export function closedPart(before: XZ[], after: XZ[]): XZ[] {
  const on = (p: XZ) => after.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5);
  let best: XZ[] = [];
  let run: XZ[] = [];
  for (let i = 0; i < before.length; i++) {
    const p = before[i] as XZ;
    if (!on(p)) {
      // include the shared point the run leaves from
      if (run.length === 0 && i > 0) run.push(before[i - 1] as XZ);
      run.push(p);
    } else if (run.length > 0) {
      run.push(p);
      if (lengthOf(run) > lengthOf(best)) best = run;
      run = [];
    }
  }
  if (lengthOf(run) > lengthOf(best)) best = run;
  return best;
}

/** Trims a polyline to the part within `r` metres of `c` (the longest such run). */
function near(pts: XZ[], c: XZ, r: number): XZ[] {
  let best: XZ[] = [];
  let run: XZ[] = [];
  for (const p of pts) {
    if (len(sub(p, c)) <= r) run.push(p);
    else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  return run.length > best.length ? run : best;
}

/**
 * The site geometry in the local frame. `closedEdge` (lon/lat), when the caller found the plan's
 * `facts.detour.edge_id` in the walk layer, is the closed edge; otherwise the part of the before
 * route that the after route leaves out.
 */
export function siteGeom(
  plan: DevelopmentPlan,
  frame: LocalFrame,
  closedEdge?: number[][] | null,
  /** The drawn streets (lon/lat centrelines and widths), for the queue's lane. */
  roads?: readonly { coords: readonly (readonly number[])[]; widthM: number }[] | null,
): SiteGeom {
  const L = (ll: number[]): XZ => frame.toLocal(ll[0] as number, ll[1] as number);
  const ring = plan.site.footprint.map(L);
  const centre: XZ = ring.reduce<XZ>(
    (a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length],
    [0, 0],
  );
  const b = (plan.site.entrance.facing_deg * Math.PI) / 180;
  // compass bearing: east = sin, north = cos; local z = -north
  const out: XZ = [Math.sin(b), -Math.cos(b)];
  const side: XZ = [-out[1], out[0]];
  // the door sits on the facade: the plan door snapped to the nearest point of the footprint
  const door = nearestOnRing(ring, L(plan.site.entrance.door));
  const path = plan.site.entrance.path.map(L);
  if (path.length > 0) path[0] = door;
  else path.push(door);
  const node = path[path.length - 1] ?? door;
  const radius = Math.max(...ring.map((p) => len(sub(p, centre))));
  const yard: XZ = [centre[0] - out[0] * (radius + 16), centre[1] - out[1] * (radius + 16)];
  const det = plan.facts.detour;
  let closed: XZ[] = [];
  if (closedEdge && closedEdge.length >= 2) closed = closedEdge.map(L);
  else if (det) closed = closedPart(det.before_path.map(L), det.after_path.map(L));
  const detour = det ? near(det.after_path.map(L), centre, 260) : [];
  const junction = L(plan.anchors.junction);
  let street: XZ = side;
  if (closed.length >= 2) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < closed.length; i++) {
      const a = closed[i - 1] as XZ;
      const b = closed[i] as XZ;
      const d = distToLine([a, b], junction[0], junction[1]);
      if (d < best && len(sub(b, a)) > 0.5) {
        best = d;
        street = norm(sub(b, a));
      }
    }
  }
  let kerbOut: XZ = [-street[1], street[0]];
  const away = sub(junction, centre);
  if (kerbOut[0] * away[0] + kerbOut[1] * away[1] < 0) kerbOut = [-kerbOut[0], -kerbOut[1]];
  const byJunction = (c: readonly (readonly number[])[]) =>
    c.some((p) => {
      const q = L(p as number[]);
      return Math.abs(q[0] - junction[0]) < 400 && Math.abs(q[1] - junction[1]) < 400;
    });
  const local: LaneRoad[] = (roads ?? [])
    .filter((r) => r.coords.length >= 2 && byJunction(r.coords))
    .map((r) => ({ pts: r.coords.map((p) => L(p as number[])), halfW: r.widthM / 2 }));
  const lane = queueLane(local, junction, street) ?? {
    pts: [junction, [junction[0] + street[0] * LANE_MAX_M, junction[1] + street[1] * LANE_MAX_M]],
    halfW: 3,
    off: 1.5,
    mapped: false,
  };
  return {
    ring,
    centre,
    out,
    side,
    door,
    path,
    node,
    yard,
    closed,
    detour,
    halimPath: plan.anchors.halim_path.map(L),
    farid: L(plan.anchors.farid),
    junction,
    street,
    kerbOut,
    lane,
    park: L(plan.anchors.park),
    mall: L(plan.anchors.mall),
    lorryRoute: planExtras(plan).lorryRoute?.path.map(L) ?? [],
    radius,
    storeys: plan.site.storeys,
  };
}

/** The nearest point on a closed ring to p. */
export function nearestOnRing(ring: readonly XZ[], p: XZ): XZ {
  let best: XZ = p;
  let bd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XZ;
    const b = ring[(i + 1) % ring.length] as XZ;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    const q: XZ = [a[0] + dx * u, a[1] + dz * u];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** A point `d` metres out from the door along its facing and `lat` metres along its face. */
export function onPath(g: SiteGeom, d: number, lat = 0): XZ {
  return [g.door[0] + g.out[0] * d + g.side[0] * lat, g.door[1] + g.out[1] * d + g.side[1] * lat];
}

/** True when (x, z) is inside the ring (any winding). */
export function inRing(ring: readonly XZ[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i] as XZ;
    const [xj, zj] = ring[j] as XZ;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to a polyline. */
export function distToLine(pts: readonly XZ[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1] as XZ;
    const [bx, bz] = pts[i] as XZ;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * u, z - az - dz * u));
  }
  return best;
}

/** How far the lane runs out from the junction (the lorries drive in along it), metres. */
export const LANE_MAX_M = 140;
/** The junction must lie on a street (within its corridor plus this margin), metres. */
const ON_STREET_M = 1.5;
/** Street ends closer than this join (metres); a turn sharper than ~100 degrees ends the lane. */
const JOIN_M = 1.5;
const MIN_TURN_COS = -0.17;

const dirOf = (pts: readonly XZ[]): XZ | null => {
  for (let i = 1; i < pts.length; i++) {
    const d = sub(pts[i] as XZ, pts[0] as XZ);
    if (len(d) > 0.5) return norm(d);
  }
  return null;
};
const lastDir = (pts: readonly XZ[]): XZ | null => {
  const n = pts.length;
  for (let i = n - 2; i >= 0; i--) {
    const d = sub(pts[n - 1] as XZ, pts[i] as XZ);
    if (len(d) > 0.5) return norm(d);
  }
  return null;
};

/**
 * Pure: the lane the school-run queue stands in (owner fix, 4.png: the queue used to stand on a
 * straight line 4.5 m off the junction's street, across kerbs, verges and lots). From the junction
 * it takes the street arm best aligned with `prefer` (the frontage street the 48 s camera looks
 * up), then follows the mapped streets end to end, the straightest way on, up to LANE_MAX_M. The
 * lane centre sits half the street's half width to the left of a car facing the junction
 * (Malaysia drives on the left). Null when no street passes the junction.
 */
export function queueLane(roads: readonly LaneRoad[], junction: XZ, prefer: XZ): QueueLane | null {
  let best: { pts: XZ[]; halfW: number; score: number; road: number } | null = null;
  for (const [ri, r] of roads.entries()) {
    // the junction's projection onto this street
    let bi = -1;
    let bu = 0;
    let bd = Number.POSITIVE_INFINITY;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1] as XZ;
      const b = r.pts[i] as XZ;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const u = Math.max(
        0,
        Math.min(1, ((junction[0] - a[0]) * dx + (junction[1] - a[1]) * dz) / l2),
      );
      const d = Math.hypot(a[0] + dx * u - junction[0], a[1] + dz * u - junction[1]);
      if (d < bd) {
        bd = d;
        bi = i;
        bu = u;
      }
    }
    if (bi < 0 || bd > r.halfW + ON_STREET_M) continue;
    const a = r.pts[bi - 1] as XZ;
    const b = r.pts[bi] as XZ;
    const q: XZ = [a[0] + (b[0] - a[0]) * bu, a[1] + (b[1] - a[1]) * bu];
    const fwd: XZ[] = [q, ...r.pts.slice(bi)];
    const back: XZ[] = [q, ...r.pts.slice(0, bi).reverse()];
    for (const pts of [fwd, back]) {
      const d = dirOf(pts);
      if (!d || lengthOf(pts) < 4) continue;
      const score = d[0] * prefer[0] + d[1] * prefer[1];
      if (!best || score > best.score) best = { pts, halfW: r.halfW, score, road: ri };
    }
  }
  if (!best) return null;
  const start = best;
  const pts = [...start.pts];
  const used = new Set<number>([start.road]);
  for (let k = 0; k < 40 && lengthOf(pts) < LANE_MAX_M; k++) {
    const end = pts[pts.length - 1] as XZ;
    const din = lastDir(pts);
    if (!din) break;
    let next: { pts: XZ[]; ri: number; turn: number } | null = null;
    for (const [ri, r] of roads.entries()) {
      if (used.has(ri) || r.pts.length < 2) continue;
      const f = r.pts[0] as XZ;
      const l = r.pts[r.pts.length - 1] as XZ;
      const cand =
        len(sub(f, end)) < JOIN_M ? r.pts : len(sub(l, end)) < JOIN_M ? [...r.pts].reverse() : null;
      if (!cand) continue;
      const d0 = dirOf(cand);
      if (!d0) continue;
      const turn = din[0] * d0[0] + din[1] * d0[1];
      if (turn > MIN_TURN_COS && (!next || turn > next.turn)) next = { pts: cand, ri, turn };
    }
    if (!next) break;
    used.add(next.ri);
    pts.push(...next.pts.slice(1));
  }
  return { pts, halfW: start.halfW, off: start.halfW / 2, mapped: true };
}

/**
 * Pure: a car's pose `d` metres up the lane from the junction, facing the junction, in the lane
 * (offset to the car's left of the centreline). `dir` is the facing (unit, local x/z).
 */
export function laneAt(lane: QueueLane, d: number): { p: XZ; dir: XZ } {
  const a = along(lane.pts, d);
  const f: XZ = [-a.dir[0], -a.dir[1]];
  const left: XZ = [f[1], -f[0]];
  return { p: [a.p[0] + left[0] * lane.off, a.p[1] + left[1] * lane.off], dir: f };
}
