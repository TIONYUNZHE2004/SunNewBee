import type { MarathonResult } from "../../../closures/closureSimModel";
import { carAt, followedTrip, leadAt, shotAt } from "../../../closures/marathonCinematic";
import { routeOverview } from "../../../journey/followCamera";
import { pointAlong } from "../../../whatif/rolloutModel";
import type { LocalFrame } from "../frame";
import { type CamPose, followPose } from "../journey/followRig";

/**
 * T-031: the one camera of "Watch the marathon", reusing the journey follow rig's pose maths
 * (`followPose`, `routeOverview`). Pure in screen time `t`: overview while the course draws, a
 * dive to the lead runner, a head-on shot moving with it that looks back over the pack, a cut to the
 * followed sample car (the journey's follow pose, wider), and a pull back to the course overview.
 */

/** The run shot: ahead of the lead runner, to its side and up, looking back at the pack. */
export const HEAD_ON = { aheadM: 26, sideM: 9, upM: 11, lookBackM: 10 } as const;
/** The car shot's follow distance, as a multiple of the journey follow pose (8.5 m back, 4.2 up). */
export const CAR_SCALE = 5;
/** Extra camera height (m) over the scaled follow pose: near-side spectators stay below the frame. */
export const LIFT_EXTRA_M = 10;
/** Metres either side the follow direction is averaged over, so corners do not whip the camera. */
const DIR_SPAN_M = { back: 90, ahead: 30 } as const;

type XZ = [number, number];

const ease = (u: number) => {
  const k = Math.max(0, Math.min(1, u));
  return k * k * (3 - 2 * k);
};
const mix = (a: number[], b: number[], u: number) =>
  a.map((v, i) => v + ((b[i] ?? v) - v) * u) as [number, number, number];

/** Blend two poses (eased). */
export function blendPose(a: CamPose, b: CamPose, u: number): CamPose {
  const k = ease(u);
  return { pos: mix(a.pos, b.pos, k), look: mix(a.look, b.look, k) };
}

/** A path in local metres with point / direction lookups by fraction. */
function path(coords: number[][], frame: LocalFrame) {
  const local = coords.map((c) => frame.toLocal(c[0] ?? 0, c[1] ?? 0) as XZ);
  let length = 0;
  for (let i = 1; i < local.length; i++)
    length += Math.hypot(
      (local[i]?.[0] ?? 0) - (local[i - 1]?.[0] ?? 0),
      (local[i]?.[1] ?? 0) - (local[i - 1]?.[1] ?? 0),
    );
  const at = (f: number) => pointAlong(local, f) as XZ;
  const dir = (f: number): XZ => {
    const L = Math.max(length, 1);
    const a = at(f - DIR_SPAN_M.back / L);
    const b = at(f + DIR_SPAN_M.ahead / L);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    return l > 1e-6 ? [dx / l, dz / l] : [0, -1];
  };
  return { local, length, at, dir };
}

/** The journey follow pose around `at`, scaled out by `k` about the subject. */
function wideFollow(at: XZ, dir: XZ, k: number): CamPose {
  const p = followPose(at, dir, 1);
  const s = [at[0], 0, at[1]];
  const pos = mix(s, p.pos, k);
  pos[1] += LIFT_EXTRA_M;
  return { pos, look: mix(s, p.look, k) };
}

/** The camera at screen time t for one proposed course (null without a drawable course). */
export function createCinematicCamera(m: MarathonResult, frame: LocalFrame) {
  const course = path(m.animation.course_coordinates, frame);
  if (course.local.length < 2) return null;
  const trip = followedTrip(m);
  const car = trip ? path(trip.after_coordinates, frame) : null;
  const overview = routeOverview(
    (metres) => course.at(metres / Math.max(course.length, 1)),
    course.length,
  );
  // the TV marathon shot: ahead of the lead and to the side, looking back over the pack behind it
  const runPose = (f: number): CamPose => {
    const at = course.at(f);
    const d = course.dir(f);
    const r: XZ = [-d[1], d[0]];
    return {
      pos: [
        at[0] + d[0] * HEAD_ON.aheadM + r[0] * HEAD_ON.sideM,
        HEAD_ON.upM,
        at[1] + d[1] * HEAD_ON.aheadM + r[1] * HEAD_ON.sideM,
      ],
      look: [at[0] - d[0] * HEAD_ON.lookBackM, 1, at[1] - d[1] * HEAD_ON.lookBackM],
    };
  };
  const carPose = (u: number) => (car ? wideFollow(car.at(u), car.dir(u), CAR_SCALE) : overview);
  const lastRun = runPose(1);

  return (t: number): CamPose => {
    const { id, u } = shotAt(t);
    switch (id) {
      case "reveal":
        return overview;
      case "dive":
        return blendPose(overview, runPose(0), u);
      case "run":
        return runPose(leadAt(t));
      case "cut":
        return car ? blendPose(lastRun, carPose(0), u) : blendPose(lastRun, overview, u);
      case "car":
        return car ? carPose(carAt(t)) : overview;
      default:
        return blendPose(car ? carPose(1) : lastRun, overview, u);
    }
  };
}
