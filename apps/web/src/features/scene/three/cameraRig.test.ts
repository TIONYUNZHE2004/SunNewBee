import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { fitCost, fitFor, overviewPose, rangeNeededM } from "./cameraFit";
import {
  type CameraRig,
  clampHeading,
  clampPose,
  createThreeCameraOps,
  FIT,
  fitWeight,
  LIMITS,
  type Pose,
  poseToCamera,
  tweenPose,
  VFOV_DEG,
  vfovFor,
  viewOffsetFor,
} from "./cameraRig";
import { createFrame } from "./frame";
import { boundaryOf, edgeDistance, insideBoundary } from "./ground/boundary";

const base: Pose = { target: [0, 0], rangeM: 100, pitchDeg: -45, headingDeg: 0 };
const bounds = { min: [-1000, -1000] as [number, number], max: [1000, 1000] as [number, number] };

describe("poseToCamera", () => {
  it("puts the camera south of and above the target at heading 0", () => {
    const c = poseToCamera(base);
    expect(c.position[0]).toBeCloseTo(0);
    expect(c.position[1]).toBeCloseTo(70.71, 1);
    expect(c.position[2]).toBeCloseTo(70.71, 1);
    expect(c.target).toEqual([0, 0, 0]);
  });
  it("puts the camera west of the target at heading 90", () => {
    const c = poseToCamera({ ...base, headingDeg: 90 });
    expect(c.position[0]).toBeCloseTo(-70.71, 1);
    expect(c.position[2]).toBeCloseTo(0);
  });
});

describe("clampPose", () => {
  it("clamps range and pitch", () => {
    expect(clampPose({ ...base, rangeM: 1 }, bounds).rangeM).toBe(LIMITS.minRangeM);
    expect(clampPose({ ...base, rangeM: 1e6 }, bounds).rangeM).toBe(LIMITS.maxRangeM);
    expect(clampPose({ ...base, pitchDeg: 0 }, bounds).pitchDeg).toBe(-5);
    expect(clampPose({ ...base, pitchDeg: -90 }, bounds).pitchDeg).toBe(-89);
  });
  it("pulls the target back within 5000 m of the bounds", () => {
    const p = clampPose({ ...base, target: [99999, -99999] }, bounds);
    expect(p.target).toEqual([6000, -6000]);
  });
});

describe("tweenPose", () => {
  const b: Pose = { target: [100, 50], rangeM: 500, pitchDeg: -30, headingDeg: 10 };
  it("hits both ends", () => {
    const a = { ...base, headingDeg: 350 };
    expect(tweenPose(a, b, 0)).toEqual(a);
    const end = tweenPose(a, b, 1);
    expect(end.target).toEqual(b.target);
    expect(end.rangeM).toBe(500);
    expect(((end.headingDeg % 360) + 360) % 360).toBeCloseTo(10);
  });
  it("takes the shortest heading arc", () => {
    const m = tweenPose({ ...base, headingDeg: 350 }, b, 0.5);
    expect(((m.headingDeg % 360) + 360) % 360).toBeCloseTo(0);
  });
});

describe("viewOffsetFor", () => {
  it("shifts by half the panel", () => {
    expect(viewOffsetFor(1440, 900, 400)).toEqual([1440, 900, 200, 0, 1440, 900]);
    expect(viewOffsetFor(1440, 900, 0)[2]).toBe(0);
  });
});

describe("createThreeCameraOps", () => {
  const make = () => {
    let pose = { ...base };
    const rig: CameraRig = {
      get: () => pose,
      set: vi.fn((p: Pose) => {
        pose = p;
      }),
      flyTo: vi.fn(),
      pick: vi.fn(() => [10, 20] as [number, number]),
    };
    const moved = vi.fn();
    const homePose: Pose = { ...base, rangeM: 800 };
    const ops = createThreeCameraOps(
      rig,
      () => homePose,
      () => ({ ...base, rangeM: 7000 }),
      moved,
    );
    return { rig, ops, moved, homePose };
  };

  it("zoom halves the range and reports a user move", () => {
    const { rig, ops, moved } = make();
    ops.zoom(0.5);
    expect(rig.get().rangeM).toBe(50);
    expect(moved).toHaveBeenCalled();
  });
  it("faceNorth sets heading 0", () => {
    const { rig, ops } = make();
    rig.set({ ...base, headingDeg: 120 });
    ops.faceNorth();
    expect(rig.get().headingDeg).toBeCloseTo(0);
  });
  it("home flies to the home pose, calling onUserMove first", () => {
    const { rig, ops, moved, homePose } = make();
    ops.home();
    expect(rig.flyTo).toHaveBeenCalledWith(homePose, expect.any(Number));
    expect(moved.mock.invocationCallOrder[0]).toBeLessThan(
      (rig.flyTo as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("move shifts the target along the heading (forward = north at heading 0)", () => {
    const { rig, ops } = make();
    ops.move(0, 1);
    expect(rig.get().target[0]).toBeCloseTo(0);
    expect(rig.get().target[1]).toBeLessThan(0); // z = -north
  });
  it("glideTo flies to the picked ground point", () => {
    const { rig, ops } = make();
    ops.glideTo({ x: 5, y: 5 });
    const arg = (rig.flyTo as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Pose;
    expect(arg.target).toEqual([10, 20]);
    expect(arg.rangeM).toBe(50);
  });
  it("headingRad reports radians", () => {
    const { rig, ops } = make();
    rig.set({ ...base, headingDeg: 90 });
    expect(ops.headingRad()).toBeCloseTo(Math.PI / 2);
  });
});

// ---- A-T5: the camera bound to the Elmina slab (AC-A6) ----

const seed = (p: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
  );
const frame = createFrame(seed("site.json").center);
const B = boundaryOf(seed("base/boundary.geojson").features[0].geometry, frame)!;
const fit = fitFor(B);
const box = {
  min: [B.box[0], B.box[1]] as [number, number],
  max: [B.box[2], B.box[3]] as [number, number],
};

/** Map canvas sizes measured at 1440x900 (acceptance hook `size()`): panel closed and docked open. */
const CANVASES = { full: [1326, 874], panelOpen: [923, 874] } as const;

/** Deterministic PRNG (mulberry32). */
function rng(seed0: number) {
  let a = seed0 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Targets up to 6 km past the outline's box, log-uniform range, any pitch and heading. */
function randomPose(r: () => number, rangeLo = 5, rangeHi = 30000): Pose {
  return {
    target: [
      B.box[0] - 6000 + r() * (B.box[2] - B.box[0] + 12000),
      B.box[1] - 6000 + r() * (B.box[3] - B.box[1] + 12000),
    ],
    rangeM: Math.exp(Math.log(rangeLo) + r() * (Math.log(rangeHi) - Math.log(rangeLo))),
    pitchDeg: -100 + r() * 110,
    headingDeg: -720 + r() * 1440,
  };
}

/** Worst slab-corner position (1 = the safe-frame edge) for a pose drawn on a three camera set up like the engine's. */
function cornersNdc(p: Pose, size: readonly [number, number]): { worst: number; behind: number } {
  const aspect = size[0] / size[1];
  const cam = new THREE.PerspectiveCamera(vfovFor(p, fit, aspect), aspect, 2, 30000);
  const c = poseToCamera(p);
  cam.position.set(...c.position);
  cam.lookAt(new THREE.Vector3(...c.target));
  cam.updateMatrixWorld();
  const q = new THREE.Vector3();
  let worst = 0;
  let behind = 0;
  for (const [x, y, z] of fit.corners) {
    q.set(x, y, z).project(cam);
    if (q.z < -1 || q.z > 1) behind++;
    // In units of the safe frame (FIT.safeTop / safeBottom / safeSide): <= 1 is clear of the chrome.
    const v = q.y >= 0 ? q.y / FIT.safeTop : -q.y / FIT.safeBottom;
    worst = Math.max(worst, Math.abs(q.x) / FIT.safeSide, v);
  }
  return { worst, behind };
}

describe("fitFor (Elmina seed)", () => {
  it("centre inside the outline; the max-range window fits within the field-of-view cap", () => {
    expect(insideBoundary(B, fit.centre[0], fit.centre[1])).toBe(true);
    expect(fit.corners.length).toBe(B.polys.flat().reduce((n, r) => n + r.length, 0) * 2);
    const cost = fitCost(fit);
    const need = rangeNeededM(fit);
    console.info(
      `A-T5 fit (Elmina seed): axis ${fit.axisHeadingDeg} deg, centre ${fit.centre.map(Math.round)}, shift ${Math.round(fit.shiftM)} m, window fov ${cost.toFixed(1)} deg, range needed ${need} m`,
    );
    // If this fails for a new outline, `need` is the range the slab needs (AC-A6 vs AC-A7).
    expect(cost).toBeLessThanOrEqual(FIT.maxVfovDeg);
    expect(need).toBeLessThanOrEqual(LIMITS.maxRangeM);
  });
});

describe("clampPose with the slab fit (AC-A6)", () => {
  it("1,000 random poses: the target is always inside the outline, and clamping is idempotent", () => {
    const r = rng(1);
    for (let i = 0; i < 1000; i++) {
      const p = clampPose(randomPose(r), box, fit);
      expect(insideBoundary(B, p.target[0], p.target[1]), JSON.stringify(p)).toBe(true);
      const again = clampPose(p, box, fit);
      expect(again.target[0]).toBeCloseTo(p.target[0], 6);
      expect(again.target[1]).toBeCloseTo(p.target[1], 6);
      expect(again.pitchDeg).toBeCloseTo(p.pitchDeg, 9);
      expect(again.headingDeg).toBeCloseTo(p.headingDeg, 9);
    }
  });

  it("a target outside goes to the nearest outline point (within 1 m) below the long-range rules", () => {
    const r = rng(2);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const p = randomPose(r, 30, FIT.startRangeM);
      if (insideBoundary(B, p.target[0], p.target[1])) continue;
      n++;
      const c = clampPose(p, box, fit);
      const toEdge = edgeDistance(B, p.target[0], p.target[1]);
      const moved = Math.hypot(c.target[0] - p.target[0], c.target[1] - p.target[1]);
      expect(moved).toBeLessThanOrEqual(toEdge + 1);
    }
    expect(n).toBeGreaterThan(100);
  });

  for (const [name, size] of Object.entries(CANVASES))
    it(`1,000 random poses at max range: every slab corner projects inside the viewport (${name} ${size[0]}x${size[1]})`, () => {
      const r = rng(3);
      let worst = 0;
      for (let i = 0; i < 1000; i++) {
        const p = clampPose(randomPose(r, LIMITS.maxRangeM, 40000), box, fit);
        expect(p.rangeM).toBe(LIMITS.maxRangeM);
        const n = cornersNdc(p, size);
        expect(n.behind).toBe(0);
        worst = Math.max(worst, n.worst);
      }
      expect(worst).toBeLessThanOrEqual(1 + 1e-9);
      console.info(`A-T5 max-range worst (safe-frame units) (${name}): ${worst.toFixed(4)}`);
    });

  it("the derived overview is its own clamp, at max range, with the whole slab in view", () => {
    const p = overviewPose(fit);
    expect(p.rangeM).toBe(LIMITS.maxRangeM);
    const c = clampPose(p, box, fit);
    expect(Math.hypot(c.target[0] - p.target[0], c.target[1] - p.target[1])).toBeLessThan(1);
    expect(c.pitchDeg).toBe(p.pitchDeg);
    expect(c.headingDeg).toBe(p.headingDeg);
    for (const size of Object.values(CANVASES))
      expect(cornersNdc(p, size).worst).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("street and mid-range poses are unchanged (pitch, heading, field of view)", () => {
    const r = rng(4);
    for (let i = 0; i < 500; i++) {
      const raw = randomPose(r, LIMITS.minRangeM, FIT.startRangeM);
      const inside: Pose = { ...raw, target: fit.centre };
      const a = clampPose(inside, box, fit);
      expect(a).toEqual(clampPose(inside, box, null));
      expect(vfovFor(a, fit, 1.5)).toBe(VFOV_DEG);
    }
    // The street acceptance pose: pitch -6 at 30 m.
    const street: Pose = { target: fit.centre, rangeM: 30, pitchDeg: -6, headingDeg: 144 };
    expect(clampPose(street, box, fit)).toEqual(street);
  });

  it("the long-range rules ramp smoothly with range (no step over 1 m of range)", () => {
    let last: { pitch: number; fov: number; head: number } | null = null;
    for (let rM = FIT.startRangeM - 100; rM <= LIMITS.maxRangeM; rM += 1) {
      const p = clampPose(
        { target: fit.centre, rangeM: rM, pitchDeg: -5, headingDeg: 90 },
        box,
        fit,
      );
      const cur = { pitch: p.pitchDeg, fov: vfovFor(p, fit, 1.05), head: p.headingDeg };
      if (last) {
        expect(Math.abs(cur.pitch - last.pitch)).toBeLessThan(0.05);
        expect(Math.abs(cur.fov - last.fov)).toBeLessThan(0.05);
        expect(Math.abs(cur.head - last.head)).toBeLessThan(0.05);
      }
      last = cur;
    }
    expect(fitWeight(FIT.startRangeM)).toBe(0);
    expect(fitWeight(LIMITS.maxRangeM)).toBe(1);
  });

  it("keeps LIMITS.maxRangeM within the AC-A7 notch budget (<= 7,940 m)", () => {
    expect(LIMITS.maxRangeM).toBeLessThanOrEqual(7940);
  });
});

describe("clampHeading", () => {
  it("keeps headings inside the window and moves others to its nearer edge", () => {
    expect(clampHeading(175, 170, 15)).toBe(175);
    expect(clampHeading(350, 170, 15)).toBe(350); // the opposite direction is allowed too
    expect(clampHeading(90, 170, 15)).toBe(155);
    expect(clampHeading(45, 170, 15)).toBe(5);
    expect(clampHeading(-30, 170, 90)).toBe(-30); // a 90 deg window is no constraint
  });
});
