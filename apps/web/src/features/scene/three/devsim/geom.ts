import type { DevelopmentPlan } from "../../../devsim/types";
import type { LocalFrame } from "../frame";

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
  /** Radius of the footprint (centre to farthest corner). */
  radius: number;
  storeys: number;
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
    park: L(plan.anchors.park),
    mall: L(plan.anchors.mall),
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
