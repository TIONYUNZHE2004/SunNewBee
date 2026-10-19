import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { type Agent, easedDistance, PEOPLE_VISIBLE_M, poseAt, smoothYaw } from "./agents";
import { AGENT_VISIBLE_M, agentLods, createMotionLayer, type YawMemory } from "./motionLayer";

const kit = (lods: { node: string; tris: number; maxM: number | null }[]) => ({
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
      lods,
    },
  },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "",
  precinctGroups: [],
  assets: {
    people: kit([
      { node: "p0", tris: 12, maxM: 80 },
      { node: "p1", tris: 12, maxM: 300 },
    ]),
    vehicles: kit([
      { node: "c0", tris: 12, maxM: 150 },
      { node: "c1", tris: 12, maxM: 1500 },
    ]),
  },
  landmarks: {},
});
/** 1.74 m tall boxes standing on the ground. */
const lib = (): AssetLibrary & { geos: THREE.BufferGeometry[] } => {
  const geos = new Map<string, THREE.BufferGeometry>();
  const all: THREE.BufferGeometry[] = [];
  return {
    geos: all,
    geometry(a, v, l) {
      const k = `${a}/${v}/${l}`;
      if (!geos.has(k)) {
        const g = new THREE.BoxGeometry(1, 1.74, 1);
        g.translate(0, 0.87, 0);
        geos.set(k, g);
        all.push(g);
      }
      return geos.get(k) ?? null;
    },
    has: () => true,
    gpuBytes: () => 0,
    failed: [],
    dispose() {},
  };
};
const agent = (id: string, kind: Agent["kind"], x0: number, z0: number): Agent => ({
  id,
  kind,
  variant: "v",
  path: new Float32Array([x0, z0, x0 + 100, z0]),
  length: 100,
  speed: kind === "vehicle" ? 10 : 1.3,
  offset: 0,
});
const meshes = (g: THREE.Object3D) => {
  const out: THREE.InstancedMesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
};
const drawn = (g: THREE.Object3D) =>
  meshes(g)
    .filter((m) => m.visible)
    .reduce((n, m) => n + m.count, 0);
const translationOf = (m: THREE.InstancedMesh, i: number) => {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  return new THREE.Vector3().setFromMatrixPosition(mat);
};
const make = (agents: Agent[], l = lib(), yaw?: YawMemory) =>
  createMotionLayer(agents, l, manifest(), createRoleUniforms(), createMotionUniforms(), { yaw });
const cam = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("createMotionLayer", () => {
  it("tick moves instances along their paths (real time, not frames)", () => {
    const layer = make([agent("a", "person", 0, 0)]);
    layer.tick(0, cam(0, 30, 0));
    const m = meshes(layer.group).find((x) => x.visible)!;
    const p0 = translationOf(m, 0);
    layer.tick(2000, cam(0, 30, 0));
    const p1 = translationOf(m, 0);
    const a = agent("a", "person", 0, 0);
    expect(p1.x - p0.x).toBeCloseTo(easedDistance(a, 2) - easedDistance(a, 0), 3);
    // About 1.3 m/s, eased by at most 15 %.
    expect(p1.x - p0.x).toBeGreaterThan(2.6 * 0.85);
    expect(p1.x - p0.x).toBeLessThan(2.6 * 1.15);
    // The same time gives the same pose, however many ticks ran in between.
    layer.tick(2000, cam(0, 30, 0));
    expect(translationOf(m, 0).x).toBeCloseTo(p1.x, 5);
  });

  it("setOpacity(0) hides people and vehicles; setOpacity fades their materials", () => {
    const layer = make([agent("a", "person", 0, 0), agent("b", "vehicle", 0, 5)]);
    layer.tick(0, cam(0, 30, 0));
    expect(drawn(layer.group)).toBe(2);
    layer.setOpacity(0.5);
    for (const m of meshes(layer.group))
      expect((m.material as THREE.Material).opacity).toBeCloseTo(0.5);
    layer.setOpacity(0);
    expect(layer.group.visible).toBe(false);
    layer.setOpacity(1);
    expect(layer.group.visible).toBe(true);
  });

  it("meshes are decorative with a no-op raycast and cast no shadow", () => {
    const layer = make([agent("a", "person", 0, 0), agent("b", "vehicle", 0, 5)]);
    layer.tick(0, cam(0, 30, 0));
    expect(layer.group.userData.decorative).toBe(true);
    const ms = meshes(layer.group);
    expect(ms.length).toBe(4);
    for (const m of ms) {
      expect(m.userData.decorative).toBe(true);
      expect(m.castShadow).toBe(false);
      const hits: THREE.Intersection[] = [];
      m.raycast(new THREE.Raycaster(cam(0, 30, 0), new THREE.Vector3(0, -1, 0)), hits);
      expect(hits).toHaveLength(0);
    }
  });

  it("distance scale-up: a 1.74 m agent 800 m away draws 5.22 m tall; the geometry is unchanged", () => {
    const l = lib();
    const layer = make([agent("a", "vehicle", 0, 0)], l);
    layer.tick(0, cam(0, 800, 0));
    const m = meshes(layer.group).find((x) => x.visible)!;
    const mat = new THREE.Matrix4();
    m.getMatrixAt(0, mat);
    const s = new THREE.Vector3();
    mat.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    m.geometry.computeBoundingBox();
    const h = m.geometry.boundingBox!.max.y - m.geometry.boundingBox!.min.y;
    expect(h).toBeCloseTo(1.74);
    expect(h * s.y).toBeCloseTo(5.22, 2);
    for (const g of l.geos) {
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeCloseTo(1.74);
    }
  });

  it("LOD by camera distance; the last LOD stays visible to AGENT_VISIBLE_M, then hides", () => {
    const layer = make([agent("a", "person", 0, 0)]);
    layer.tick(0, cam(0, 30, 0));
    const lodOf = () => meshes(layer.group).find((m) => m.visible && m.count > 0)?.userData.lod;
    expect(lodOf()).toBe(0);
    layer.tick(0, cam(0, 200, 0));
    expect(lodOf()).toBe(1);
    // Past the kit's own 300 m, still on LOD1 (owner ruling P2: legible at hero-mid).
    layer.tick(0, cam(0, 600, 0));
    expect(lodOf()).toBe(1);
    layer.tick(0, cam(0, 1000, 0));
    expect(drawn(layer.group)).toBe(0);
  });

  it("R-J7: a person 800 m away is visible at 2.5x and hidden beyond 800 m; a vehicle keeps displayScale (3x)", () => {
    expect(AGENT_VISIBLE_M).toBe(900);
    expect(PEOPLE_VISIBLE_M).toBe(800);
    const scaleAt = (kind: Agent["kind"], h: number) => {
      const layer = make([agent("a", kind, 0, 0)]);
      layer.tick(0, cam(0, h, 0));
      const m = meshes(layer.group).find((x) => x.visible && x.count > 0);
      if (!m) return null;
      expect(m.userData.lod).toBe(h > 300 ? 1 : 0);
      const mat = new THREE.Matrix4();
      m.getMatrixAt(0, mat);
      const s = new THREE.Vector3();
      mat.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      return s.y;
    };
    expect(scaleAt("person", 800)).toBeCloseTo(2.5, 5);
    expect(scaleAt("person", 30)).toBeCloseTo(1.55, 5);
    expect(scaleAt("person", 850)).toBeNull();
    expect(scaleAt("vehicle", 800)).toBeCloseTo(3, 2);
    expect(scaleAt("vehicle", 880)).toBeCloseTo(3, 2);
    // This test kit's vehicle LOD1 reaches 1,500 m (agentLods never shortens a band).
    const far = make([agent("b", "vehicle", 0, 0)]);
    far.tick(0, cam(0, 1700, 0));
    expect(drawn(far.group)).toBe(0);
  });

  it("agentLods stretches only the last band, never shortens one, keeps null", () => {
    expect(agentLods([{ maxM: 80 }, { maxM: 300 }])).toEqual([{ maxM: 80 }, { maxM: 900 }]);
    expect(agentLods([{ maxM: 150 }, { maxM: 1500 }])).toEqual([{ maxM: 150 }, { maxM: 1500 }]);
    expect(agentLods([{ maxM: 150 }, { maxM: null }])).toEqual([{ maxM: 150 }, { maxM: null }]);
  });

  it("frustum: only agents within the view (plus a 50 m margin) get matrices", () => {
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    camera.position.set(0, 50, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const layer = make([agent("in", "vehicle", -50, 0), agent("out", "vehicle", 600, 600)]);
    layer.tick(0, camera.position, frustum);
    expect(drawn(layer.group)).toBe(1);
    layer.tick(0, camera.position);
    expect(drawn(layer.group)).toBe(2);
  });

  it("setDensity thins each kind to its share of the peak (night 0.45 / 1.15)", () => {
    const people = Array.from({ length: 100 }, (_, i) => agent(`p${i}`, "person", 0, i * 0.1));
    const layer = make(people);
    layer.setDensity({ day: 0, dusk: 0, night: 1 });
    layer.tick(0, cam(0, 30, 0));
    expect(drawn(layer.group)).toBe(Math.round((100 * 0.45) / 1.15));
    layer.setDensity({ day: 0, dusk: 1, night: 0 });
    layer.tick(0, cam(0, 30, 0));
    expect(drawn(layer.group)).toBe(100);
  });

  it("dispose leaves the library geometry intact", () => {
    const l = lib();
    const layer = make([agent("a", "person", 0, 0)], l);
    layer.tick(0, cam(0, 30, 0));
    layer.dispose();
    for (const g of l.geos) expect(g.getAttribute("position")).toBeTruthy();
  });

  it("yaw is smoothed across a corner (no snap), carried per agent id", () => {
    // Heading +x, then a right-angle corner to -z at (10, 0).
    const a: Agent = {
      id: "corner",
      kind: "person",
      variant: "v",
      path: new Float32Array([0, 0, 10, 0, 10, -10]),
      length: 20,
      speed: 1.3,
      offset: 9.5,
    };
    const layer = make([a]);
    const yawOf = () => {
      const m = meshes(layer.group).find((x) => x.visible && x.count > 0)!;
      const mat = new THREE.Matrix4();
      m.getMatrixAt(0, mat);
      const q = new THREE.Quaternion();
      mat.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      return 2 * Math.atan2(q.y, q.w);
    };
    const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
    let prev: number | null = null;
    let expected = 0;
    let lagged = false;
    for (let i = 0; i <= 120; i++) {
      const t = i * 16.7;
      layer.tick(t, cam(0, 30, 0));
      const y = yawOf();
      const raw = poseAt(a, t / 1000).yaw;
      expected = i === 0 ? raw : smoothYaw(expected, raw, 0.0167);
      expect(wrap(y - expected)).toBeCloseTo(0, 4);
      if (prev !== null)
        expect(Math.abs(wrap(y - prev))).toBeLessThanOrEqual((2 * Math.PI * 0.0167) / 0.5);
      if (Math.abs(wrap(raw - y)) > 0.3) lagged = true;
      prev = y;
    }
    expect(lagged).toBe(true);
  });

  it("a shared YawMemory keeps an agent's smoothed yaw when the layer is rebuilt with other agents", () => {
    const a: Agent = {
      id: "keep",
      kind: "person",
      variant: "v",
      path: new Float32Array([0, 0, 10, 0, 10, -10]),
      length: 20,
      speed: 1.3,
      offset: 9.9,
    };
    const memory: YawMemory = new Map();
    const one = make([a], lib(), memory);
    one.tick(0, cam(0, 30, 0));
    one.tick(300, cam(0, 30, 0));
    const kept = { ...memory.get("keep")! };
    // Task 4 rebuilds the union of active tiles: a new agent arrives, "keep" continues smoothly.
    const two = make([agent("new", "person", 50, 50), a], lib(), memory);
    two.tick(316.7, cam(0, 30, 0));
    const after = memory.get("keep")!;
    const raw = poseAt(a, 0.3167).yaw;
    expect(after.yaw).toBeCloseTo(smoothYaw(kept.yaw, raw, 0.0167), 6);
    expect(memory.get("new")).toBeDefined();
  });

  it("a rebuild prunes YawMemory to the latest agent set (streaming never grows it)", () => {
    const memory: YawMemory = new Map();
    const first = make([agent("a", "person", 0, 0), agent("b", "person", 0, 5)], lib(), memory);
    first.tick(0, cam(0, 30, 0));
    expect([...memory.keys()].sort()).toEqual(["a", "b"]);
    // Tile of "a" leaves, "c" arrives: "a" is dropped at once, "b" keeps its entry.
    const kept = memory.get("b");
    make([agent("b", "person", 0, 5), agent("c", "vehicle", 0, 10)], lib(), memory);
    expect([...memory.keys()]).toEqual(["b"]);
    expect(memory.get("b")).toBe(kept);
    for (let i = 0; i < 50; i++) {
      const l = make([agent(`s${i}`, "person", 0, 0)], lib(), memory);
      l.tick(i * 16.7, cam(0, 30, 0));
    }
    expect(memory.size).toBe(1);
  });
});
