import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Pose } from "../cameraRig";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import {
  acceptanceEnabled,
  createAcceptanceApi,
  frameSummary,
  maskCode,
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
