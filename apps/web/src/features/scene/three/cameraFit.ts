import {
  type CameraFit,
  clampHeading,
  FIT,
  fitCentre,
  fitWeight,
  LIMITS,
  type Pose,
  poseToCamera,
  requiredVfovDeg,
} from "./cameraRig";
import { type Boundary, insideBoundary } from "./ground/boundary";
import { slabGeometry } from "./ground/slab";

/**
 * The max-range framing of the diorama slab (spec 2026-10-19 resident journey A6, task A-T5):
 * which heading and target show the whole slab (outline and soil-section foot) at LIMITS.maxRangeM
 * with the least widening of the field of view. Display only. Computed once per outline at
 * runtime: nothing here is tuned to one outline (the overview pose, the max-range target and axis
 * all come from the boundary data).
 */

/**
 * Canvas aspects (width / height) the framing is chosen for: the map canvas at 1440x900 measures
 * 923x874 with the assistant docked beside it (1.056) and 1326x874 with it closed (1.517); the
 * range covers both with a margin. Narrower canvases (a phone in portrait) get the FIT.maxVfovDeg
 * cap and may crop the slab ends.
 */
export const FIT_ASPECTS = [1.05, 1.6] as const;

const AXIS_STEP_DEG = 5;

type Corner = readonly [number, number, number];

/** Slab corners: every outline vertex at y 0 and the outer foot of its soil section. */
export function slabCorners(b: Boundary): Corner[] {
  const g = slabGeometry(b);
  g.top.dispose();
  g.edge.dispose();
  const out: Corner[] = [];
  for (const ring of g.outline) for (const [x, z] of ring) out.push([x, 0, z]);
  for (const ring of g.foot) for (const p of ring) out.push([p[0], p[1], p[2]]);
  return out;
}

/** 2D convex hull (monotone chain) of x, z points; collinear points dropped. */
function hull2(pts: readonly Corner[]): Corner[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  if (s.length < 3) return s;
  const cross = (o: Corner, a: Corner, b: Corner) =>
    (a[0] - o[0]) * (b[2] - o[2]) - (a[2] - o[2]) * (b[0] - o[0]);
  const lower: Corner[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Corner[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The corners on the 2D convex hull of each height level (see `CameraFit.hull`). */
export function cornerHull(corners: readonly Corner[]): Corner[] {
  const byY = new Map<number, Corner[]>();
  for (const c of corners) byY.set(c[1], [...(byY.get(c[1]) ?? []), c]);
  return [...byY.values()].flatMap(hull2);
}

/** The poses that bound the max-range window for an axis: both directions, edge and middle. */
function windowPoses(fit: CameraFit, rangeM: number): Pose[] {
  const out: Pose[] = [];
  const mid = (FIT.farPitchMinDeg + FIT.farPitchMaxDeg) / 2;
  for (const base of [fit.axisHeadingDeg, fit.axisHeadingDeg + 180])
    for (const dh of [-FIT.farHeadingDevDeg, 0, FIT.farHeadingDevDeg])
      for (const pitchDeg of [FIT.farPitchMinDeg, mid, FIT.farPitchMaxDeg]) {
        const headingDeg = (base + dh + 360) % 360;
        out.push({
          target: fitCentre(fit, headingDeg),
          rangeM,
          pitchDeg,
          headingDeg,
        });
      }
  return out;
}

/**
 * The widest field of view (deg) the max-range window needs over the reference aspects (at
 * `rangeM`, default LIMITS.maxRangeM). Above FIT.maxVfovDeg the slab does not fit: see `rangeNeededM`.
 */
export function fitCost(fit: CameraFit, rangeM: number = LIMITS.maxRangeM): number {
  let worst = 0;
  for (const p of windowPoses(fit, rangeM))
    for (const a of FIT_ASPECTS) worst = Math.max(worst, requiredVfovDeg(p, fit.hull, a));
  return worst;
}

/** Centre of the corners' extent in the frame of a heading (local x, z). */
function extentCentre(corners: readonly Corner[], headingDeg: number): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  let r0 = Infinity;
  let r1 = -Infinity;
  let f0 = Infinity;
  let f1 = -Infinity;
  for (const [x, , z] of corners) {
    const r = x * rx + z * rz;
    const f = x * rz - z * rx;
    r0 = Math.min(r0, r);
    r1 = Math.max(r1, r);
    f0 = Math.min(f0, f);
    f1 = Math.max(f1, f);
  }
  const r = (r0 + r1) / 2;
  const f = (f0 + f1) / 2;
  return [r * rx + f * rz, r * rz - f * rx];
}

/**
 * Pattern search over the centre (kept inside the outline) and the shift along the view, for one
 * axis: the least-cost fit. A generator: it yields after every pass over the six moves, so a
 * caller can spread the search over idle slices (`fitSteps`).
 */
function* bestFit(
  b: Boundary,
  corners: readonly Corner[],
  hull: readonly Corner[],
  axis: number,
  minStep: number,
): Generator<void, { fit: CameraFit; cost: number }> {
  let centre = extentCentre(hull, axis);
  if (!insideBoundary(b, centre[0], centre[1]))
    // The extent centre fell in a notch: start from the outline's own box centre.
    centre = [(b.box[0] + b.box[2]) / 2, (b.box[1] + b.box[3]) / 2];
  let fit: CameraFit = { boundary: b, corners, hull, centre, shiftM: 0, axisHeadingDeg: axis };
  let best = fitCost(fit);
  for (let step = 400; step >= minStep; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [dx, dz, ds] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        const c: [number, number] = [fit.centre[0] + dx * step, fit.centre[1] + dz * step];
        if (!insideBoundary(b, c[0], c[1])) continue;
        const next: CameraFit = { ...fit, centre: c, shiftM: fit.shiftM + ds * step };
        const v = fitCost(next);
        if (v < best - 1e-9) {
          best = v;
          fit = next;
          moved = true;
        }
      }
      yield;
    }
  }
  return { fit, cost: best };
}

/**
 * The fit for an outline, as resumable steps (each a few ms): the axis heading (scanned every 5
 * deg, each with a coarse search) and the centre and view shift (a fine pattern search, centre
 * kept inside the outline) that need the least field of view over the max-range window and the
 * reference aspects. The search runs on the corner hull (`cornerHull`). The engine runs it in idle
 * slices so it never blocks a frame; `fitFor` runs it to the end.
 */
export function* fitSteps(b: Boundary): Generator<void, CameraFit> {
  const corners = slabCorners(b);
  const hull = cornerHull(corners);
  yield;
  let axis = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let a = 0; a < 180; a += AXIS_STEP_DEG) {
    const v = (yield* bestFit(b, corners, hull, a, 100)).cost;
    if (v < best - 1e-9) {
      best = v;
      axis = a;
    }
  }
  return (yield* bestFit(b, corners, hull, axis, 5)).fit;
}

/** The fit for an outline, computed synchronously (`fitSteps` run to the end). Pure apart from a temporary geometry. */
export function fitFor(b: Boundary): CameraFit {
  const it = fitSteps(b);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The overview: the whole slab at max range, from the in-window heading nearest north, at the
 * pitch in the far band (2.5 deg steps) that needs the least field of view on the narrowest
 * reference canvas; the target is the fit's max-range target. A fixed point of clampPose.
 */
export function overviewPose(fit: CameraFit): Pose {
  const headingDeg = clampHeading(0, fit.axisHeadingDeg, FIT.farHeadingDevDeg);
  const target = fitCentre(fit, headingDeg);
  let best: Pose | null = null;
  let bestV = Number.POSITIVE_INFINITY;
  for (let pitchDeg = FIT.farPitchMinDeg; pitchDeg <= FIT.farPitchMaxDeg + 1e-9; pitchDeg += 2.5) {
    const p: Pose = { target, rangeM: LIMITS.maxRangeM, pitchDeg, headingDeg };
    const v = requiredVfovDeg(p, fit.hull, Math.min(...FIT_ASPECTS));
    if (v < bestV - 1e-9) {
      bestV = v;
      best = p;
    }
  }
  return best ?? { target, rangeM: LIMITS.maxRangeM, pitchDeg: FIT.farPitchMaxDeg, headingDeg };
}

/**
 * The least camera range (m, 100 m steps) at which the max-range window fits within
 * FIT.maxVfovDeg, for the fit's own target and axis: LIMITS.maxRangeM or less when the slab fits.
 * A report for a larger outline (AC-A6 vs AC-A7: the range must stay <= 7,940 m).
 */
export function rangeNeededM(fit: CameraFit): number {
  let r = 1000;
  while (r < 100_000 && fitCost(fit, r) > FIT.maxVfovDeg) r += 100;
  return r;
}

/**
 * The slab's fog reach (m) at a camera range: 0 below FIT.startRangeM; towards max range
 * (fitWeight) the distance from the overview camera to the farthest outline vertex. `fogFor` puts
 * that vertex at FOG_REACH_SHARE of the fog ramp, so the far fog follows the outline's size
 * instead of a fixed multiple of the range (fix: a 7 km outline seen along its length).
 */
export function fogReachM(fit: CameraFit | null | undefined, rangeM: number): number {
  if (!fit) return 0;
  const t = fitWeight(rangeM);
  if (t === 0) return 0;
  const c = poseToCamera(overviewPose(fit)).position;
  let far = 0;
  for (const [x, y, z] of fit.corners)
    if (y === 0) far = Math.max(far, Math.hypot(x - c[0], y - c[1], z - c[2]));
  return far * t;
}
