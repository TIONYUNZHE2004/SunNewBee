import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, type Pose, VFOV_DEG } from "../scene/three/cameraRig";
import type { Engine } from "../scene/three/engine";
import { createFrame } from "../scene/three/frame";
import { type FollowScene, journeyCameraAt } from "../scene/three/journey/followRig";
import { insideSafe } from "../scene/three/journey/safeFrame";
import demoPlan from "./fixtures/demoPlan.json";
import {
  createFollowController,
  MODE_BLEND_MS,
  orbitPoseAround,
  overviewFor,
  PIN_TOP_M,
  routeOverview,
  routeOverviewFit,
} from "./followCamera";
import { useJourney } from "./journeyStore";
import { createRoutePath } from "./routePath";
import { MARKER_LIFT_M, MARKER_STACK_M } from "./three/journeyLayer";
import { createViewFit, safeRectOf } from "./three/viewFit";
import type { JourneyPlan } from "./timeline";

const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame([101.5135, 3.18]);
const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));

function setup(reduced = false, focus = vi.fn((_p: [number, number, number] | null) => {})) {
  const rig = { set: vi.fn((_p: Pose) => {}), flyTo: vi.fn((_p: Pose, _ms: number) => {}) };
  const engine = { rig, cameraFit: () => null } as unknown as Pick<Engine, "rig" | "cameraFit">;
  const overview = routeOverview(path.pointAt, path.planLength);
  const scene = (): FollowScene | null => {
    const tl = useJourney.getState().timeline;
    return tl ? { timeline: tl, pointAt: path.pointAt, overview } : null;
  };
  const ctl = createFollowController({
    engine,
    scene,
    hero: () => path.pointAt(useJourney.getState().t > 0 ? 100 : 0),
    reduced: () => reduced,
    focus,
  });
  const here = {
    position: [500, 300, 500] as [number, number, number],
    look: [0, 0, 0] as [number, number, number],
  };
  return { ctl, rig, scene, here, focus };
}

beforeEach(() => {
  useJourney.getState().clear();
  useJourney.getState().load(plan);
});
afterEach(() => useJourney.getState().clear());

describe("follow controller (engine camera driver)", () => {
  it("leaves the camera to the rig until the player is used", () => {
    const { ctl, here } = setup();
    expect(ctl.driver(0, here)).toBeNull();
    useJourney.getState().seek(20);
    expect(ctl.driver(0, here)).toBeNull(); // nothing engaged it (the mount subscribes for that)
    ctl.engage();
    expect(ctl.driver(0, here)).not.toBeNull();
  });

  it("eases in from where the camera stands, then is exactly the journey camera at t", () => {
    const { ctl, scene, here } = setup();
    useJourney.getState().seek(20);
    ctl.engage();
    const first = ctl.driver(1000, here);
    expect(first?.animating).toBe(true);
    expect(first?.position).toEqual(here.position);
    const done = ctl.driver(1000 + MODE_BLEND_MS + 1, here);
    const want = journeyCameraAt(scene() as FollowScene, 20, "follow");
    expect(done?.animating).toBeFalsy();
    expect(done?.position).toEqual(want?.pos);
    expect(done?.look).toEqual(want?.look);
    // scrub == play: any later frame at the same t is the same pose
    useJourney.getState().seek(30);
    useJourney.getState().seek(20);
    expect(ctl.driver(99_999, here)?.position).toEqual(want?.pos);
  });

  it("a mode change eases to the overview; reduced motion snaps", () => {
    const a = setup();
    useJourney.getState().seek(20);
    a.ctl.engage();
    a.ctl.driver(0, a.here);
    a.ctl.driver(MODE_BLEND_MS + 1, a.here);
    useJourney.getState().setCam("overview");
    expect(a.ctl.driver(5000, a.here)?.animating).toBe(true);
    const ov = a.ctl.driver(5000 + MODE_BLEND_MS + 1, a.here);
    expect(ov?.position).toEqual(routeOverview(path.pointAt, path.planLength).pos);

    useJourney.getState().setCam("follow");
    const b = setup(true);
    b.ctl.engage();
    const snap = b.ctl.driver(0, b.here);
    expect(snap?.animating).toBeFalsy();
    expect(snap?.position).toEqual(journeyCameraAt(b.scene() as FollowScene, 20, "follow")?.pos);
  });

  it("Free mode hands the camera to the orbit rig around her; the end of the trip releases it", () => {
    const { ctl, rig, here } = setup();
    useJourney.getState().seek(20);
    ctl.engage();
    ctl.driver(0, here);
    useJourney.getState().setCam("free");
    expect(ctl.driver(10, here)).toBeNull();
    expect(rig.flyTo).toHaveBeenCalledTimes(1);
    const [p] = rig.flyTo.mock.calls[0] as [Pose, number];
    expect(p.target).toEqual(path.pointAt(100));
    expect(p.rangeM).toBeGreaterThanOrEqual(LIMITS.minRangeM);
    // once handed over, no more flights
    expect(ctl.driver(20, here)).toBeNull();
    expect(rig.flyTo).toHaveBeenCalledTimes(1);

    useJourney.getState().setCam("follow");
    const total = useJourney.getState().timeline?.total as number;
    useJourney.getState().seek(total);
    expect(ctl.driver(30, here)).toBeNull();
    expect(rig.flyTo).toHaveBeenCalledTimes(1);
    // seeking back takes the camera again
    useJourney.getState().seek(total - 10);
    expect(ctl.driver(40, here)).not.toBeNull();
    ctl.reset();
    expect(ctl.driver(50, here)).toBeNull();
  });

  it("orbitPoseAround keeps the camera where it is around a ground point", () => {
    const p = orbitPoseAround([0, 30, 40], [0, 0]);
    expect(p.rangeM).toBeCloseTo(50);
    expect(p.pitchDeg).toBeCloseTo((-Math.asin(30 / 50) * 180) / Math.PI);
    expect(p.headingDeg).toBeCloseTo(0); // south of the target, facing north
  });

  it("the overview is the slab's derived overview when there is a fit, else the route's", () => {
    const r = overviewFor({ cameraFit: () => null }, path.pointAt, path.planLength);
    expect(r).toEqual(routeOverview(path.pointAt, path.planLength));
    expect(r.pos[1]).toBeGreaterThan(200);
  });

  it("the depth-of-field focus follows her in follow mode, null in overview, free and when idle", () => {
    const { ctl, focus, here } = setup();
    ctl.driver(0, here);
    expect(focus).not.toHaveBeenCalled(); // not engaged: nothing to say (never set)
    useJourney.getState().seek(20);
    ctl.engage();
    ctl.driver(10, here);
    const h = path.pointAt(100);
    expect(focus).toHaveBeenLastCalledWith([h[0], 1.2, h[1]]);
    const n = focus.mock.calls.length;
    ctl.driver(20, here); // unchanged: no repeat call (each call asks the engine for a frame)
    expect(focus.mock.calls.length).toBe(n);
    useJourney.getState().setCam("overview");
    ctl.driver(30, here);
    expect(focus).toHaveBeenLastCalledWith(null);
    useJourney.getState().setCam("follow");
    ctl.driver(40, here);
    expect(focus).toHaveBeenLastCalledWith([h[0], 1.2, h[1]]);
    useJourney.getState().setCam("free");
    ctl.driver(50, here);
    expect(focus).toHaveBeenLastCalledWith(null);
  });

  it("without a scene it stops driving, and blends in again when the scene is back", () => {
    let on = true;
    const rig = { set: vi.fn(), flyTo: vi.fn() };
    const overview = routeOverview(path.pointAt, path.planLength);
    const ctl = createFollowController({
      engine: { rig, cameraFit: () => null } as unknown as Pick<Engine, "rig" | "cameraFit">,
      scene: () => {
        const tl = useJourney.getState().timeline;
        return on && tl ? { timeline: tl, pointAt: path.pointAt, overview } : null;
      },
      hero: () => null,
      reduced: () => false,
    });
    const here = {
      position: [1, 2, 3] as [number, number, number],
      look: [0, 0, 0] as [number, number, number],
    };
    useJourney.getState().seek(20);
    ctl.engage();
    ctl.driver(0, here);
    ctl.driver(MODE_BLEND_MS + 1, here);
    on = false;
    expect(ctl.driver(5000, here)).toBeNull();
    expect(ctl.drivenT).toBeNull();
    on = true;
    // driven again: a fresh blend from where the camera stands, not a snap
    const back = ctl.driver(6000, here);
    expect(back?.animating).toBe(true);
    const bp = back?.position ?? [0, 0, 0];
    for (let i = 0; i < 3; i++) expect(bp[i]).toBeCloseTo(here.position[i] as number, 9);
  });
});

describe("route overview fit (pull-back end, iteration 2)", () => {
  // the owner's window: a short, wide map area with the top stack ending at 150 px
  for (const [w, h, top] of [
    [960, 560, 150],
    [920, 860, 235],
  ] as const) {
    it(`the whole route and every marker with its pin sit in the UI-safe area (${w} x ${h})`, () => {
      const cam = new THREE.PerspectiveCamera(VFOV_DEG, w / h, 0.5, 30000);
      cam.updateProjectionMatrix();
      const view = createViewFit(cam, [w, h], safeRectOf({ w, h, top }));
      const markers = plan.events.map((e, i) => {
        const [x, z] = path.pointAt(e.at_m);
        const stacked = plan.events.filter((f, j) => j < i && Math.abs(f.at_m - e.at_m) < 3).length;
        return [x, MARKER_LIFT_M + stacked * MARKER_STACK_M, z] as const;
      });
      const pose = routeOverviewFit(path.pointAt, path.planLength, view, markers);
      const subjects = [
        ...markers.map((m) => ({ p: [m[0], m[1], m[2]] as [number, number, number], padPx: 36 })),
        ...markers.map((m) => ({
          p: [m[0], m[1] + PIN_TOP_M, m[2]] as [number, number, number],
          padPx: 8,
        })),
      ];
      expect(insideSafe(pose, subjects, view)).toBe(true);
      // still a look-down overview of the route (same heading and pitch as the plain one)
      const plain = routeOverview(path.pointAt, path.planLength);
      const dirOf = (p: { pos: readonly number[]; look: readonly number[] }) => {
        const v = [0, 1, 2].map((i) => (p.look[i] as number) - (p.pos[i] as number));
        const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
        return v.map((c) => c / l);
      };
      const a = dirOf(pose);
      const b = dirOf(plain);
      for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] as number, 6);
    });
  }
});
