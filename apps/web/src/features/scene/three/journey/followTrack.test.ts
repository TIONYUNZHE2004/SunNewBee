import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import demoPlan from "../../../journey/fixtures/demoPlan.json";
import { createRoutePath } from "../../../journey/routePath";
import { MARKER_LIFT_M, MARKER_STACK_M } from "../../../journey/three/journeyLayer";
import { createViewFit, safeRectOf } from "../../../journey/three/viewFit";
import { buildTimeline, type JourneyPlan, stateAt } from "../../../journey/timeline";
import { HERO_CENTRE } from "../bookmarks";
import { createClearance, obstaclesFromCity } from "../clearance";
import { createFrame } from "../frame";
import { type CamPose, type FollowScene, journeyCameraAt } from "./followRig";
import { heroPositionAt } from "./heroDriver";

/**
 * Iteration 2 (owner's screen recording): the journey camera sampled at 60 Hz over the whole demo
 * trip on the seed city, with the acceptance view's UI-safe hold fit and markers. The camera must
 * be smooth in trip time: no zoom see-saw in the dive, no heading swings, no jumps, bounded
 * acceleration and jerk, and a 3/4 look-down (never overhead, never a flat street view).
 */
const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame(HERO_CENTRE);
const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));
const tl = buildTimeline(plan);
const helpers = { pointAt: path.pointAt };
const SEED = new URL(
  "../../../../../../../data/seed/elmina/base/buildings.geojson",
  import.meta.url,
);
const RAD = 180 / Math.PI;
const HZ = 60;

/** Smoothness limits (per second, per s², per s³) on the follow camera at 60 Hz. */
export const SMOOTH_LIMITS = {
  /** View heading and pitch rate (deg/s). */
  angVelDeg: 60,
  /** View heading and pitch acceleration (deg/s²). */
  angAccDeg: 240,
  /**
   * Camera position jerk (m/s³), in the follow span: she walks ~23 m/s on screen and turns each
   * corner of the path in one frame, so a camera that keeps her framed has corner jerks of a few
   * thousand m/s³; a cut or a pop is millions (the camera before iteration 2: 13 million).
   */
  jerkM: 3000,
  /** Largest single 60 Hz step of the camera in the follow span (m); she walks ~0.4 m a frame. */
  stepM: 0.9,
  /** Pitch band of the follow and hold camera (deg below the horizon): a 3/4 view at most. */
  pitchMinDeg: 8,
  pitchMaxDeg: 45.5,
} as const;

function sceneOf(): FollowScene {
  const size: [number, number] = [920, 875];
  const vp = { w: 920, h: 860, top: 235 };
  const cam = new THREE.PerspectiveCamera(30, size[0] / size[1], 0.5, 30000);
  cam.updateProjectionMatrix();
  const markerOf = (i: number): [number, number, number] | null => {
    const e = plan.events[i];
    if (!e) return null;
    const [x, z] = path.pointAt(e.at_m);
    const stacked = plan.events.filter((f, j) => j < i && Math.abs(f.at_m - e.at_m) < 3).length;
    return [x, MARKER_LIFT_M + stacked * MARKER_STACK_M, z];
  };
  const layer = { buildings: JSON.parse(readFileSync(SEED, "utf8")) } as unknown as BuildingsLayer;
  return {
    timeline: tl,
    pointAt: path.pointAt,
    overview: { pos: [0, 5600, 5600], look: [0, 0, 0] },
    pullBackTo: { pos: [10, 600, 450], look: [10, 0, 0] },
    heroAt: (t) => heroPositionAt(tl, t, helpers),
    clearance: createClearance(obstaclesFromCity(layer, frame)),
    view: createViewFit(cam, size, safeRectOf(vp)),
    markerOf,
  };
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The 60 Hz trace of the follow camera: heading, pitch, distance, position. */
function trace(sc: FollowScene) {
  const n = Math.floor(tl.total * HZ);
  const out: {
    t: number;
    kind: string;
    yaw: number;
    pitch: number;
    d: number;
    pos: CamPose["pos"];
  }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / HZ;
    const p = journeyCameraAt(sc, t, "follow") as CamPose;
    const v = [p.look[0] - p.pos[0], p.look[1] - p.pos[1], p.look[2] - p.pos[2]] as const;
    const d = Math.hypot(v[0], v[1], v[2]);
    out.push({
      t,
      kind: stateAt(tl, t).phase.kind,
      yaw: Math.atan2(v[0], -v[2]) * RAD,
      pitch: -Math.asin(v[1] / d) * RAD,
      d,
      pos: p.pos,
    });
  }
  return out;
}

export function smoothnessOf(sc: FollowScene) {
  const tr = trace(sc);
  const dt = 1 / HZ;
  let diveReversals = 0;
  let diveDir = 0;
  let angVel = 0;
  let angVelAt = 0;
  let angAcc = 0;
  let jerk = 0;
  let step = 0;
  let stepAt = 0;
  let pitchOut = 0;
  const pitchOutAt: number[] = [];
  const follow = (k: string) => k === "walk" || k === "event";
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1] as (typeof tr)[number];
    const b = tr[i] as (typeof tr)[number];
    if (a.kind === "dive" && b.kind === "dive") {
      const dd = Math.sign(Math.round((b.d - a.d) * 1e6));
      if (dd !== 0) {
        if (diveDir !== 0 && dd !== diveDir) diveReversals++;
        diveDir = dd;
      }
    }
    if (!follow(b.kind) || !follow(a.kind)) continue;
    const w = Math.max(Math.abs(wrap(b.yaw - a.yaw)), Math.abs(b.pitch - a.pitch)) / dt;
    if (w > angVel) {
      angVel = w;
      angVelAt = b.t;
    }
    const s = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
    if (s > step) {
      step = s;
      stepAt = b.t;
    }
    if (b.pitch < SMOOTH_LIMITS.pitchMinDeg || b.pitch > SMOOTH_LIMITS.pitchMaxDeg) {
      pitchOut++;
      if (pitchOutAt.length < 6) pitchOutAt.push(Math.round(b.t * 10) / 10);
    }
    if (i >= 3) {
      const z = tr[i - 2] as (typeof tr)[number];
      const y = tr[i - 3] as (typeof tr)[number];
      if (follow(z.kind) && follow(y.kind)) {
        const acc = Math.max(
          Math.abs(wrap(b.yaw - a.yaw) - wrap(a.yaw - z.yaw)),
          Math.abs(b.pitch - 2 * a.pitch + z.pitch),
        );
        angAcc = Math.max(angAcc, acc / (dt * dt));
        let j = 0;
        for (let k = 0; k < 3; k++)
          j = Math.max(
            j,
            Math.abs(
              (b.pos[k] as number) -
                3 * (a.pos[k] as number) +
                3 * (z.pos[k] as number) -
                (y.pos[k] as number),
            ),
          );
        jerk = Math.max(jerk, j / dt ** 3);
      }
    }
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    diveReversals,
    angVel: r(angVel),
    angVelAt: r(angVelAt),
    angAcc: r(angAcc),
    jerk: r(jerk),
    step: Math.round(step * 1000) / 1000,
    stepAt: r(stepAt),
    pitchOut,
    pitchOutAt,
  };
}

describe.skipIf(!existsSync(SEED))("journey camera smoothness at 60 Hz (iteration 2)", () => {
  const sc = sceneOf();
  const m = smoothnessOf(sc);

  it("reports its numbers", () => {
    console.log(`camera smoothness ${JSON.stringify(m)}`);
  });
  it("the dive zooms in only (no see-saw)", () => {
    expect(m.diveReversals).toBe(0);
  });
  it("heading and pitch turn at most ~60 deg/s, with bounded angular acceleration", () => {
    expect(m.angVel, `at t=${m.angVelAt}`).toBeLessThanOrEqual(SMOOTH_LIMITS.angVelDeg);
    expect(m.angAcc).toBeLessThanOrEqual(SMOOTH_LIMITS.angAccDeg);
  });
  it("no jump and bounded jerk (no cuts)", () => {
    expect(m.step, `at t=${m.stepAt}`).toBeLessThanOrEqual(SMOOTH_LIMITS.stepM);
    expect(m.jerk).toBeLessThanOrEqual(SMOOTH_LIMITS.jerkM);
  });
  it("a 3/4 look-down through follow and holds (never overhead, never street level)", () => {
    expect(m.pitchOut, `at ${m.pitchOutAt.join(", ")}`).toBe(0);
  });
});
