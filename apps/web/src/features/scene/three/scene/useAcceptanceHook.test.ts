import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Pose } from "../cameraRig";
import { createClearance } from "../clearance";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import {
  acceptanceEnabled,
  createAcceptanceApi,
  emptyCameraLog,
  frameSummary,
  logCameraFrame,
  logRoofRay,
  maskCode,
  roofHit,
  uncappedSummary,
} from "./useAcceptanceHook";

describe("acceptanceEnabled", () => {
  it("is on in dev builds", () => {
    expect(acceptanceEnabled(true, "")).toBe(true);
  });
  it("is off in production builds unless ?acceptance=1", () => {
    expect(acceptanceEnabled(false, "")).toBe(false);
    expect(acceptanceEnabled(false, "?acceptance=0")).toBe(false);
    expect(acceptanceEnabled(false, "?bookmark=hero-mid&acceptance=1")).toBe(true);
  });
});

describe("maskCode", () => {
  it("one character per kind, and every kind distinct", () => {
    const kinds = ["sky", "ground", "road", "building", "other"] as const;
    const codes = kinds.map(maskCode);
    expect(new Set(codes).size).toBe(kinds.length);
    for (const c of codes) expect(c).toHaveLength(1);
  });
});

describe("frameSummary", () => {
  it("median fps and p95 frame time from frame gaps", () => {
    const dts = [...Array.from({ length: 18 }, () => 10), 50, 50];
    const s = frameSummary(dts);
    expect(s.frames).toBe(20);
    expect(s.medianFps).toBeCloseTo(100, 6);
    expect(s.p95FrameMs).toBe(50);
    expect(s.meanFps).toBeCloseTo(1000 / 14, 6);
  });
  it("ignores idle gaps (0 and > 500 ms) like frameStats", () => {
    const s = frameSummary([0, 16, 16, 900, 16]);
    expect(s.frames).toBe(3);
    expect(s.medianFps).toBeCloseTo(62.5, 6);
  });
  it("no frames: zeros, never NaN", () => {
    expect(frameSummary([])).toEqual({ frames: 0, medianFps: 0, meanFps: 0, p95FrameMs: 0 });
  });
});

describe("uncappedSummary", () => {
  it("median / p95 frame ms and the fps they allow", () => {
    const s = uncappedSummary([4, 5, 5, 6, 30]);
    expect(s).toEqual({ frames: 5, medianFrameMs: 5, p95FrameMs: 30, fps: 200 });
  });
  it("empty: zeros", () => {
    expect(uncappedSummary([])).toEqual({ frames: 0, medianFrameMs: 0, p95FrameMs: 0, fps: 0 });
  });
});

function fakeEngine() {
  let pose: Pose = { target: [10, 20], rangeM: 800, pitchDeg: -45, headingDeg: 30 };
  const headings: number[] = [];
  const calls = { finish: 0, render: 0 };
  const roots = [new THREE.Group()];
  const gl = {
    VENDOR: 1,
    RENDERER: 2,
    getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 }),
    getParameter: (k: number) => ({ 1: "WebKit", 2: "WebKit WebGL", 3: "NVIDIA", 4: "RTX" })[k],
    finish: () => {
      calls.finish++;
    },
  };
  const engine = {
    rig: {
      get: () => ({ ...pose }),
      set: (p: Pose) => {
        pose = p;
      },
    },
    renderNow: () => {
      calls.render++;
      headings.push(pose.headingDeg);
    },
    requestRender: () => {},
    gl: () => gl,
    pickView: () => ({ camera: new THREE.PerspectiveCamera(), roots, size: [100, 100] }),
  } as unknown as Engine;
  const frame = { toLocal: () => [0, 0], toLonLat: () => [0, 0] } as unknown as LocalFrame;
  return { api: createAcceptanceApi(engine, frame), calls, headings, pose: () => pose, roots };
}

describe("createAcceptanceApi", () => {
  it("measureUncapped renders back to back with a finish each, orbits, then restores the pose", () => {
    const f = fakeEngine();
    const r = f.api.measureUncapped(4, 2);
    expect(r.frames).toBe(4);
    expect(f.calls).toEqual({ render: 4, finish: 4 });
    expect(f.headings).toEqual([32, 34, 36, 38]);
    expect(f.pose().headingDeg).toBe(30);
  });
  it("gpu() reads the unmasked vendor and renderer", () => {
    expect(fakeEngine().api.gpu()).toEqual({ vendor: "NVIDIA", renderer: "RTX" });
  });
});

describe("roadVertices (settle waits on the streamed road layer)", () => {
  it("sums the vertices of visible road-band meshes only", () => {
    const f = fakeEngine();
    const tri = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
      return g;
    };
    const road = new THREE.Mesh(tri());
    road.userData.groundBand = "roads";
    const hidden = new THREE.Mesh(tri());
    hidden.userData.groundBand = "roads";
    hidden.visible = false;
    const land = new THREE.Mesh(tri());
    land.userData.groundBand = "landcover";
    f.roots[0]?.add(road, hidden, land);
    expect(f.api.roadVertices()).toBe(3);
  });
});

describe("camera log and footprint lookup (AC-A8)", () => {
  it("logCameraFrame counts frames over roofs and violations below roof + clearance", () => {
    const log = emptyCameraLog();
    logCameraFrame(log, [0, 50, 0], 0, 2);
    logCameraFrame(log, [0, 33, 0], 30, 2);
    logCameraFrame(log, [0, 31, 0], 30, 2);
    expect(log.frames).toBe(3);
    expect(log.overRoof).toBe(2);
    expect(log.violations).toBe(1);
    expect(log.worstDeficitM).toBeCloseTo(1);
    expect(log.minMarginM).toBeCloseTo(-1);
    expect(log.samples).toEqual([[0, 31, 0, 30]]);
    expect([log.minY, log.maxY]).toEqual([31, 50]);
  });

  it("footprintTop reads the engine's clearance grid; the log runs on rendered frames", () => {
    const c = createClearance([
      {
        id: "a",
        ring: [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ],
        topM: 20,
      },
    ]);
    const cbs = new Set<() => void>();
    const camera = new THREE.PerspectiveCamera();
    const engine = {
      clearance: () => c,
      onFrame: (cb: () => void) => {
        cbs.add(cb);
        return () => cbs.delete(cb);
      },
      pickView: () => ({ camera, roots: [], size: [100, 100] }),
    } as unknown as Engine;
    const frame = { toLocal: () => [0, 0], toLonLat: () => [0, 0] } as unknown as LocalFrame;
    const api = createAcceptanceApi(engine, frame);
    expect(api.footprintTop(0, 0)).toBe(20);
    expect(api.footprintTop(50, 0)).toBe(0);
    expect(api.clearance()).toEqual({ count: 1, clearanceM: 2, maxTopM: 20 });
    api.startCameraLog();
    camera.position.set(0, 25, 0);
    for (const cb of cbs) cb();
    camera.position.set(1, 10, 1);
    for (const cb of cbs) cb();
    const log = api.stopCameraLog();
    expect(cbs.size).toBe(0);
    expect(log.frames).toBe(2);
    expect(log.violations).toBe(1);
    const none = createAcceptanceApi({} as unknown as Engine, frame);
    expect(none.footprintTop(0, 0)).toBeNull();
    expect(none.clearance()).toBeNull();
  });
});

describe("independent checks (A-T7 review r1)", () => {
  it("logCameraFrame tracks per-frame dy and lift steps", () => {
    const log = emptyCameraLog();
    logCameraFrame(log, [0, 10, 0], 0, 2, 0);
    logCameraFrame(log, [0, 13, 0], 0, 2, 3);
    logCameraFrame(log, [0, 12, 0], 0, 2, 2);
    expect(log.maxDyM).toBe(3);
    expect(log.maxLiftStepM).toBe(3);
    expect(log.liftedFrames).toBe(2);
  });

  it("logRoofRay counts hits, violations and drawn surfaces above the grid", () => {
    const log = emptyCameraLog();
    logRoofRay(log, [0, 50, 0], 0, 0, 2);
    logRoofRay(log, [0, 50, 0], 30, 30, 2);
    logRoofRay(log, [0, 31, 0], 30, 29, 2);
    expect(log.ray.checked).toBe(3);
    expect(log.ray.hits).toBe(2);
    expect(log.ray.violations).toBe(1);
    expect(log.ray.gridBelowMesh).toBe(1);
    expect(log.ray.worstGridBelowM).toBeCloseTo(1);
  });

  it("roofHit finds the top of plain and instanced building meshes, decorative ones included", () => {
    const root = new THREE.Group();
    const box = new THREE.BoxGeometry(10, 20, 10);
    box.translate(0, 10, 0);
    const plain = new THREE.Mesh(box, new THREE.MeshBasicMaterial());
    plain.userData.pick = { kind: "building" };
    plain.raycast = () => {}; // decorative: opted out of picking
    const inst = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), 2);
    inst.userData.pick = { kind: "landmark" };
    inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(100, 0, 0));
    inst.setMatrixAt(
      1,
      new THREE.Matrix4().compose(
        new THREE.Vector3(200, 0, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 3, 1),
      ),
    );
    const tree = new THREE.Mesh(box, new THREE.MeshBasicMaterial());
    tree.position.set(300, 0, 0);
    root.add(plain, inst, tree);
    root.updateMatrixWorld(true);
    expect(roofHit([root], 0, 0)).toBeCloseTo(20);
    expect(roofHit([root], 100, 0)).toBeCloseTo(20);
    expect(roofHit([root], 200, 0)).toBeCloseTo(60);
    // Not a building: ignored.
    expect(roofHit([root], 300, 0)).toBe(0);
    expect(roofHit([root], 50, 50)).toBe(0);
  });
});
