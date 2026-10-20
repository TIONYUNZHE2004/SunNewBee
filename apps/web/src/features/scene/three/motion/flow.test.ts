import * as THREE from "three";
import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { stateAt } from "../devsim/state";
import { type Agent, poseAt } from "./agents";
import { createMotionDriver } from "./motionClock";
import { createMotionLayer, flowShare } from "./motionLayer";

/** Devsim fast-forward flow (spec §7, 3D5): speed multiplier and density curve on the motion layer. */

const kit = () => ({
  group: "kit" as const,
  file: "x.glb",
  bytes: 1,
  repeat: "none" as const,
  frontage: "long" as const,
  fit: { xz: [0.5, 2], y: [0.5, 2] } as { xz: [number, number]; y: [number, number] },
  decorative: true,
  placement: null,
  jitter: {},
  variantByGroup: {},
  palettes: { default: [["#112233", "#445566", "#778899"]] as [string, string, string][] },
  variants: {
    v: {
      size: [1, 1.74, 1] as [number, number, number],
      lods: [{ node: "n", tris: 12, maxM: null }],
    },
  },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "",
  precinctGroups: [],
  assets: { people: kit(), vehicles: kit() },
  landmarks: {},
});
const lib = (): AssetLibrary => ({
  geometry: () => new THREE.BoxGeometry(1, 1, 1),
  has: () => true,
  gpuBytes: () => 0,
  failed: [],
  dispose() {},
});
const road = (id: string, kind: Agent["kind"], z = 0): Agent => ({
  id,
  kind,
  variant: "v",
  path: new Float32Array([0, z, 2000, z]),
  length: 2000,
  speed: kind === "vehicle" ? 10 : 1.3,
  offset: 0,
});
const layerOf = (agents: Agent[]) =>
  createMotionLayer(agents, lib(), manifest(), createRoleUniforms(), createMotionUniforms(), {});
const camera = new THREE.Vector3(0, 50, 0);
const P = plan as DevelopmentPlan;

describe("motion flow input", () => {
  it("timeScale 8 moves agents 8x per second on the motion clock", () => {
    const a = road("car", "vehicle");
    const plain = layerOf([a]);
    const fast = layerOf([a]);
    fast.setFlow({ timeScale: 8, peopleDensity: 2, vehicleDensity: 2 });
    for (const l of [plain, fast]) {
      l.tick(10_000, camera);
      l.tick(11_000, camera);
    }
    const x0 = plain.samples().vehicles[0]?.[0] as number;
    const x1 = fast.samples().vehicles[0]?.[0] as number;
    // the plain layer is at clock 11 s; the flow layer anchored at 10 s then ran 1 s x 8
    expect(x0).toBeCloseTo(poseAt(a, 11).x, 4);
    expect(x1).toBeCloseTo(poseAt(a, 10 + 8).x, 4);
    const d0 = x0 - poseAt(a, 10).x;
    const d1 = x1 - poseAt(a, 10).x;
    expect(d1 / d0).toBeGreaterThan(6.5); // the speed easing (+-15 %) varies along the way
    plain.dispose();
    fast.dispose();
  });

  it("a timeScale change re-anchors the flow clock: nobody jumps", () => {
    const a = road("car", "vehicle");
    const l = layerOf([a]);
    l.setFlow({ timeScale: 8, peopleDensity: 2, vehicleDensity: 2 });
    l.tick(0, camera);
    l.tick(1000, camera); // flow 8 s
    const before = l.samples().vehicles[0]?.[0] as number;
    l.setFlow({ timeScale: 1, peopleDensity: 2, vehicleDensity: 2 });
    l.tick(1000, camera);
    expect(l.samples().vehicles[0]?.[0]).toBeCloseTo(before, 6);
    l.tick(2000, camera); // 1 s at x1
    expect(l.samples().vehicles[0]?.[0]).toBeCloseTo(poseAt(a, 9).x, 4);
    l.dispose();
  });

  it("a pure clock is taken as given (the devsim flow clock already carries the scale)", () => {
    const a = road("car", "vehicle");
    const l = layerOf([a]);
    l.setFlow({ timeScale: 8, peopleDensity: 2, vehicleDensity: 2 });
    l.tick(5000, camera, undefined, true);
    expect(l.samples().vehicles[0]?.[0]).toBeCloseTo(poseAt(a, 5).x, 4);
    l.dispose();
  });

  it("density by sim day is at least 2x by sim night (devsim flow curve)", () => {
    const agents = Array.from({ length: 300 }, (_, i) =>
      road(`p${i}`, i % 2 ? "person" : "vehicle", i * 0.5),
    );
    const l = layerOf(agents);
    const count = (t: number) => {
      const f = stateAt(t, P).flow;
      l.setFlow({
        timeScale: f.timeScale,
        peopleDensity: f.peopleDensity,
        vehicleDensity: f.vehicleDensity,
      });
      l.tick(1000, camera, undefined, true);
      const s = l.samples();
      const n = (xs: readonly (readonly number[])[]) =>
        xs.filter((p) => Number.isFinite(p[0])).length;
      return { people: n(s.people), vehicles: n(s.vehicles) };
    };
    let day = { people: 0, vehicles: 0 };
    let night = { people: Number.POSITIVE_INFINITY, vehicles: Number.POSITIVE_INFINITY };
    for (let t = 4; t < 32; t += 0.25) {
      const c = count(t);
      if (stateAt(t, P).sun.isNight)
        night = {
          people: Math.min(night.people, c.people),
          vehicles: Math.min(night.vehicles, c.vehicles),
        };
      else
        day = {
          people: Math.max(day.people, c.people),
          vehicles: Math.max(day.vehicles, c.vehicles),
        };
    }
    expect(day.people).toBeGreaterThanOrEqual(2 * night.people);
    expect(day.vehicles).toBeGreaterThanOrEqual(2 * night.vehicles);
    expect(night.people).toBeGreaterThan(0); // sparse but not empty
    expect(flowShare(1)).toBeGreaterThan(flowShare(0.35));
    l.dispose();
  });

  it("people inside the avoid zone (the hoarded footway) are not drawn; vehicles are", () => {
    const l = layerOf([road("p", "person"), road("v", "vehicle", 1)]);
    l.setFlow({ timeScale: 1, peopleDensity: 2, vehicleDensity: 2, avoid: () => true });
    l.tick(1000, camera, undefined, true);
    expect(Number.isNaN(l.samples().people[0]?.[0])).toBe(true);
    expect(Number.isFinite(l.samples().vehicles[0]?.[0])).toBe(true);
    l.dispose();
  });

  it("the driver hands its flow to a later agent layer; null restores the default", () => {
    const d = createMotionDriver({
      role: createRoleUniforms(),
      ambient: () => null,
      running: () => true,
    });
    const flow = { timeScale: 8, peopleDensity: 2, vehicleDensity: 2 };
    d.setFlow(flow);
    const l = layerOf([road("car", "vehicle")]);
    let got: unknown = "unset";
    const orig = l.setFlow;
    l.setFlow = (f) => {
      got = f;
      orig(f);
    };
    d.setAgents(l);
    expect(got).toBe(flow);
    d.setFlow(null);
    expect(got).toBeNull();
    expect(d.samples()?.vehicles).toHaveLength(1);
    d.dispose();
  });
});
