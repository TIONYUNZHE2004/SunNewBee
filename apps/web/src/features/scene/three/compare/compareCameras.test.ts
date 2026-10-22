import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCompareTimeline, compareStateAt, T_MERGE } from "../../../journey/compareTimeline";
import { handCompare } from "../../../journey/fixtures/compareHand";
import { createViewFit } from "../../../journey/three/viewFit";
import { VFOV_DEG } from "../cameraRig";
import { overviewCardTop, screenBox } from "./CompareSceneMount";

import {
  CARD_GAP_PX,
  CHASE,
  chasePose,
  compareCamerasAt,
  compareOverview,
  overviewSafe,
  pullWeight,
} from "./compareCameras";

/** The cameras at t with the timeline's own camera mode (the renderer never re-derives it). */
const tl = buildCompareTimeline(handCompare());
const MERGE_AT = T_MERGE;
const camsAt = (
  t: number,
  chase: Parameters<typeof compareCamerasAt>[2],
  ov: Parameters<typeof compareCamerasAt>[3],
  reduced: boolean,
) => compareCamerasAt(t, compareStateAt(tl, t, { reduced }).camera, chase, ov, reduced);

type P = (m: number) => [number, number];
/** A polyline pointAt over [x, z] vertices (metres = polyline length). */
function poly(pts: [number, number][]): { pointAt: P; length: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number];
    const b = pts[i] as [number, number];
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum.at(-1) as number;
  return {
    length,
    pointAt: (m) => {
      const s = Math.max(0, Math.min(length, m));
      let i = 0;
      while (i < pts.length - 2 && (cum[i + 1] as number) < s) i++;
      const a = pts[i] as [number, number];
      const b = pts[i + 1] as [number, number];
      const L = (cum[i + 1] as number) - (cum[i] as number);
      const u = L > 0 ? (s - (cum[i] as number)) / L : 0;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    },
  };
}

const fast = poly([
  [0, 0],
  [0, 200],
  [150, 260],
]);
const rec = poly([
  [0, 0],
  [120, 30],
  [260, 160],
  [150, 260],
]);

function cameraAt(pose: { pos: number[]; look: number[] }, size: [number, number]) {
  const cam = new THREE.PerspectiveCamera(VFOV_DEG, size[0] / size[1], 2, 30000);
  cam.position.set(pose.pos[0] as number, pose.pos[1] as number, pose.pos[2] as number);
  cam.lookAt(pose.look[0] as number, pose.look[1] as number, pose.look[2] as number);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

const routePts = (): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (const r of [fast, rec])
    for (let i = 0; i <= 48; i++) {
      const [x, z] = r.pointAt((r.length * i) / 48);
      out.push([x, 0.3, z]);
    }
  return out;
};

describe("chase camera (prototype values)", () => {
  it("sits 42 m behind and 26 m above the walker, looking 12 m ahead", () => {
    const p = chasePose(fast.pointAt, 100, fast.length);
    expect(p.pos).toEqual([0, CHASE.upM, 100 - CHASE.backM]);
    expect(p.look).toEqual([0, 0, 100 + CHASE.aheadM]);
  });
  it("keeps a heading at the route ends", () => {
    for (const m of [0, fast.length]) {
      const p = chasePose(fast.pointAt, m, fast.length);
      expect(p.pos.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(p.look[0] - p.pos[0], p.look[2] - p.pos[2])).toBeGreaterThan(40);
    }
  });
});

describe("AC-N7: the overview frames both routes above the reasons card", () => {
  it.each([
    [1440, 900, 600],
    [1440, 900, 520],
    [1024, 700, 380],
    [1180, 820, 470],
  ] as [number, number, number][])(
    "%i x %i, card top %i: the routes' screen box ends >= 24 px above the card",
    (w, h, cardTop) => {
      const size: [number, number] = [w, h];
      const vfCam = new THREE.PerspectiveCamera(VFOV_DEG, w / h, 2, 30000);
      vfCam.updateProjectionMatrix();
      const view = createViewFit(vfCam, size, overviewSafe({ w, h, top: 72 }, cardTop));
      const ov = compareOverview(fast, rec, view);
      // after the merge the engine camera is the overview (pull-back done by 32 s)
      const cams = camsAt(
        32.2,
        {
          left: chasePose(fast.pointAt, fast.length * 0.6, fast.length),
          right: chasePose(rec.pointAt, rec.length, rec.length),
        },
        ov,
        false,
      );
      expect(cams.mode).toBe("overview");
      const box = screenBox(cameraAt(cams.main, size), routePts(), size);
      expect(box).not.toBeNull();
      const b = box as NonNullable<typeof box>;
      expect(b.y1).toBeLessThanOrEqual(cardTop - CARD_GAP_PX);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(w);
      expect(b.y0).toBeGreaterThanOrEqual(0);
    },
  );

  it("the estimated card top is used until the card reports, and a shorter card keeps it", () => {
    const est = overviewCardTop(900, null);
    expect(est).toBeLessThan(900);
    expect(overviewCardTop(900, est + 50)).toBe(est);
    expect(overviewCardTop(900, est - 40)).toBe(est - 40);
  });
});

describe("merge timeline", () => {
  const chase = {
    left: chasePose(fast.pointAt, 50, fast.length),
    right: chasePose(rec.pointAt, 300, rec.length),
  };
  const ov = {
    pos: [100, 600, -300] as [number, number, number],
    look: [100, 0, 130] as [number, number, number],
  };
  it("splits until 31.5 s and is one overview after", () => {
    expect(camsAt(10, chase, ov, false).mode).toBe("split");
    expect(camsAt(MERGE_AT - 0.01, chase, ov, false).mode).toBe("split");
    expect(camsAt(MERGE_AT, chase, ov, false).mode).toBe("overview");
  });
  it("chase poses before the pull-back, the overview once it ends", () => {
    const a = camsAt(20, chase, ov, false);
    expect(a.left.pos).toEqual(chase.left.pos);
    expect(a.right.look).toEqual(chase.right.look);
    expect(a.left.fovDeg).toBe(CHASE.fovDeg);
    const b = camsAt(32.1, chase, ov, false);
    for (let i = 0; i < 3; i++) expect(b.main.pos[i]).toBeCloseTo(ov.pos[i] as number, 6);
    expect(b.main.fovDeg).toBe(VFOV_DEG);
  });
  it("the merge is continuous: the full-screen camera carries on the right half's pull-back", () => {
    const before = camsAt(MERGE_AT - 1e-6, chase, ov, false);
    const after = camsAt(MERGE_AT, chase, ov, false);
    for (let i = 0; i < 3; i++)
      expect(after.main.pos[i]).toBeCloseTo(before.right.pos[i] as number, 2);
  });
  it("reduced motion cuts (no fly): chase until the merge, then the overview at once", () => {
    expect(pullWeight(31.4, true)).toBe(0);
    expect(pullWeight(MERGE_AT, true)).toBe(1);
    const a = camsAt(31, chase, ov, true);
    expect(a.right.pos).toEqual(chase.right.pos);
    const b = camsAt(MERGE_AT, chase, ov, true);
    for (let i = 0; i < 3; i++) expect(b.main.pos[i]).toBeCloseTo(ov.pos[i] as number, 6);
  });
});
