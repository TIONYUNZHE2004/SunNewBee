import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, type Pose } from "../scene/three/cameraRig";
import type { Engine } from "../scene/three/engine";
import { createFrame } from "../scene/three/frame";
import { type FollowScene, journeyCameraAt } from "../scene/three/journey/followRig";
import demoPlan from "./fixtures/demoPlan.json";
import {
  createFollowController,
  MODE_BLEND_MS,
  orbitPoseAround,
  overviewFor,
  routeOverview,
} from "./followCamera";
import { useJourney } from "./journeyStore";
import { createRoutePath } from "./routePath";
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
});
