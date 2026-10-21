import { type CameraMode, T_MERGE } from "../../../journey/compareTimeline";
import { routeOverviewFit } from "../../../journey/followCamera";
import { safeRectOf } from "../../../journey/three/viewFit";
import { VFOV_DEG } from "../cameraRig";
import { blendPose, type CamPose } from "../journey/followRig";
import type { SafeRect, ViewFit } from "../journey/safeFrame";

/**
 * The compare playback's cameras (demo polish B8, spec §5.3; prototype
 * `docs/03-product/prototypes/demo-storyboards/index.html` `chase`): one chase camera per walker
 * while split, then one overview of both routes. All pure functions of the walkers' metres and the
 * playback time, so play, seek and scrub draw the same frame.
 */

/** Prototype chase values: 42 m behind, 26 m up, looking 12 m ahead, 50 deg vertical fov. */
export const CHASE = { backM: 42, upM: 26, aheadM: 12, fovDeg: 50 } as const;
/**
 * The prototype eases the camera towards its target pose by 0.08 per frame (~0.2 s lag at 60 Hz;
 * the walkers cover about 20 m/s of playback). Pure instead: the heading is the chord from this many
 * metres behind the walker to `aheadM` in front, which smooths corners over a similar distance.
 */
export const CHASE_LAG_M = 8;
/**
 * The pull-back to the overview (prototype): it starts PULL_LEAD_S before the timeline's merge
 * (`T_MERGE`, compareTimeline.ts) and eases over PULL_S, so it is still under way when the timeline
 * switches the camera to "overview" and the full-screen camera carries it on.
 */
export const PULL_LEAD_S = 1;
export const PULL_S = 1.5;
/** AC-N7: the routes stay this far (CSS px) above the reasons card's top edge. */
export const CARD_GAP_PX = 24;
/**
 * The reasons card's height before the overlay reports its top (it shows from 32 s, the overview is
 * framed from the start of the pull-back): a generous estimate, so the real card is never taller than the space kept.
 */
export const CARD_EST_PX = 330;
/** The reasons card sits this far above the map's bottom edge (overlay `bottom-4`). */
export const CARD_BOTTOM_PX = 16;

type PointAt = (m: number) => [number, number];

const ease = (u: number) => {
  const k = Math.max(0, Math.min(1, u));
  return k * k * (3 - 2 * k);
};

/** The chase pose behind a walker at `m` metres of a route of `lengthM` plan metres. */
export function chasePose(pointAt: PointAt, m: number, lengthM: number): CamPose {
  const L = Math.max(0, lengthM);
  const mm = Math.max(0, Math.min(L, Number.isFinite(m) ? m : 0));
  const [x, z] = pointAt(mm);
  let [ax, az] = pointAt(Math.max(0, mm - CHASE_LAG_M));
  let [bx, bz] = pointAt(Math.min(L, mm + CHASE.aheadM));
  // at either end of the route the chord collapses: use the end segment's direction
  if (Math.hypot(bx - ax, bz - az) < 1e-3) {
    [ax, az] = pointAt(Math.max(0, L - CHASE.aheadM - CHASE_LAG_M));
    [bx, bz] = pointAt(L);
  }
  let dx = bx - ax;
  let dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  return {
    pos: [x - dx * CHASE.backM, CHASE.upM, z - dz * CHASE.backM],
    look: [x + dx * CHASE.aheadM, 0, z + dz * CHASE.aheadM],
  };
}

/** One pointAt over two routes end to end (metres 0..a then a..a+b), for a joint overview. */
export function jointPointAt(a: PointAt, aLen: number, b: PointAt): PointAt {
  return (m) => (m <= aLen ? a(m) : b(m - aLen));
}

/**
 * The UI-safe area for the overview (AC-N7): the map's safe rectangle, its bottom kept
 * CARD_GAP_PX above the reasons card's top (`cardTop`, or the estimate before the card shows).
 */
export function overviewSafe(
  vp: { w: number; h: number; top?: number },
  cardTop: number | null,
): SafeRect {
  const s = safeRectOf(vp);
  const top = cardTop ?? vp.h - CARD_BOTTOM_PX - CARD_EST_PX;
  return { ...s, b: Math.max(s.t + 1, Math.min(s.b, top - CARD_GAP_PX)) };
}

/** The overview of both routes, fitted to `view` (its safe rectangle already clear of the card). */
export function compareOverview(
  fast: { pointAt: PointAt; length: number },
  rec: { pointAt: PointAt; length: number },
  view: ViewFit | null,
): CamPose {
  return routeOverviewFit(
    jointPointAt(fast.pointAt, fast.length, rec.pointAt),
    fast.length + rec.length,
    view,
    [],
  ) as CamPose;
}

/** Pull-back weight at playback time t (0 chase .. 1 overview); a cut at the merge with reduced motion. */
export function pullWeight(t: number, reduced: boolean): number {
  if (reduced) return t >= T_MERGE ? 1 : 0;
  return ease((t - (T_MERGE - PULL_LEAD_S)) / PULL_S);
}

export interface CompareCameraState {
  /** "split": two halves (left, right); "overview": one camera (`main`). */
  mode: CameraMode;
  left: CamPose & { fovDeg: number };
  right: CamPose & { fovDeg: number };
  /**
   * The engine camera: while split, between the two chase cameras (LOD, streaming and the
   * shadow-pad reference); after the merge, the overview camera.
   */
  main: CamPose & { fovDeg: number };
}

const mid = (a: CamPose, b: CamPose): CamPose => ({
  pos: [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2],
  look: [(a.look[0] + b.look[0]) / 2, (a.look[1] + b.look[1]) / 2, (a.look[2] + b.look[2]) / 2],
});

/**
 * Both cameras at playback time t: the chase poses blended into the overview by the pull-back
 * weight (fov 50 -> the rig's 30). `mode` is the timeline's camera (`compareStateAt(...).camera`):
 * split, then the right camera's blend carries on full screen, so the merge is continuous.
 */
export function compareCamerasAt(
  t: number,
  mode: CameraMode,
  chase: { left: CamPose; right: CamPose },
  overview: CamPose,
  reduced: boolean,
): CompareCameraState {
  const k = pullWeight(t, reduced);
  const fov = CHASE.fovDeg + (VFOV_DEG - CHASE.fovDeg) * k;
  const blend = (a: CamPose) => (k <= 0 ? a : k >= 1 ? overview : blendPose(a, overview, k));
  const left = { ...blend(chase.left), fovDeg: fov };
  const right = { ...blend(chase.right), fovDeg: fov };
  if (mode === "overview") return { mode, left, right, main: right };
  return { mode: "split", left, right, main: { ...mid(left, right), fovDeg: fov } };
}
