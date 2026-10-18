import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import type { Site } from "../props/construction";
import { CONSTRUCTION_Y, GROUND_BANDS, LANDCOVER_MAX_Y, MARKING_Y, PARK_Y, WATER_Y } from "./bands";
import { createGroundLayer } from "./groundLayer";
import { landcoverMesh } from "./landcover";
import { createLotLayer } from "./lotLayer";
import { STALL_D_M, STALL_LIFT_Y, STALL_LINE_M, STALL_W_M } from "./parking";
import { ribbonsFromWalk } from "./ribbons";

const site: Site = {
  id: "0.0",
  poly: [
    [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
    ],
  ],
};
// Two stalls: one nosing +z (yaw 0), one nosing +x (yaw pi/2).
const stalls = new Float32Array([200, 10, 0, 220, 10, Math.PI / 2]);
const tracks = new Float32Array([10, 40, 90, 40]);
const meshes = (g: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};
const ys = (m: THREE.Mesh) => {
  const p = m.geometry.getAttribute("position");
  return new Set(Array.from({ length: p.count }, (_, i) => p.getY(i)));
};

describe("construction band (Task 10b)", () => {
  it("sits above land cover and below parks and base water, inside the 0.00-0.06 m ground range", () => {
    expect(CONSTRUCTION_Y).toBeGreaterThan(LANDCOVER_MAX_Y);
    expect(CONSTRUCTION_Y).toBeLessThan(PARK_Y);
    expect(CONSTRUCTION_Y).toBeLessThan(WATER_Y);
    expect(CONSTRUCTION_Y).toBeLessThanOrEqual(0.06);
    const { landcover, construction, parks } = GROUND_BANDS;
    expect(construction.order).toBeGreaterThan(landcover.order);
    expect(construction.order).toBeLessThan(parks.order);
    expect(construction.offset).toBeLessThan(landcover.offset);
    expect(construction.offset).toBeGreaterThan(parks.offset);
    expect(STALL_LIFT_Y).toBe(MARKING_Y);
  });
});

describe("createLotLayer (Task 10b)", () => {
  const layer = createLotLayer({ stalls: [stalls], tracks: [tracks], gravel: [site] });
  const all = meshes(layer.group);
  const ground = all.find((m) => m.name === "lots-construction")!;
  const marks = all.find((m) => m.name === "lots-markings")!;

  it("is at most two draws: the construction ground and the stall markings", () => {
    expect(all).toHaveLength(2);
    expect(ground.renderOrder).toBe(GROUND_BANDS.construction.order);
    expect(marks.renderOrder).toBe(GROUND_BANDS.markings.order);
    expect([...ys(ground)]).toEqual([Math.fround(CONSTRUCTION_Y)]);
    expect([...ys(marks)]).toEqual([Math.fround(STALL_LIFT_Y)]);
    // Painted in order without depth writes (gravel, then tracks), like land cover.
    expect((ground.material as THREE.Material).depthWrite).toBe(false);
  });

  it("is decorative: never picked, receives shadows, casts none", () => {
    const ray = new THREE.Raycaster(new THREE.Vector3(50, 10, 40), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]);
    const ray2 = new THREE.Raycaster(new THREE.Vector3(200, 10, 10), new THREE.Vector3(0, -1, 0));
    expect(ray2.intersectObject(layer.group, true)).toEqual([]);
    for (const m of all) {
      expect(m.userData.decorative).toBe(true);
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(true);
    }
  });

  it("every triangle faces up", () => {
    for (const m of all) {
      const p = m.geometry.getAttribute("position");
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i);
        b.fromBufferAttribute(p, i + 1);
        c.fromBufferAttribute(p, i + 2);
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        expect(n.y).toBeGreaterThan(0);
      }
    }
  });

  it("gravel covers the site, tracks stay in it, stall lines stay on their stalls", () => {
    const p = ground.geometry.getAttribute("position");
    let area = 0;
    for (let i = 0; i < p.count; i += 3) {
      const [ax, az, bx, bz, cx, cz] = [0, 1, 2].flatMap((k) => [p.getX(i + k), p.getZ(i + k)]);
      area += Math.abs((bx! - ax!) * (cz! - az!) - (cx! - ax!) * (bz! - az!)) / 2;
    }
    // 8,000 m2 of gravel plus one 80 x 4 m track.
    expect(area).toBeCloseTo(8000 + 320, 0);
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i)).toBeGreaterThanOrEqual(-1e-3);
      expect(p.getX(i)).toBeLessThanOrEqual(100 + 1e-3);
    }
    const q = marks.geometry.getAttribute("position");
    const halfW = STALL_W_M / 2 + STALL_LINE_M;
    const halfD = STALL_D_M / 2 + STALL_LINE_M;
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i);
      const z = q.getZ(i);
      // Stall 1 (yaw 0): width along x, depth along z; stall 2 (yaw pi/2): the other way round.
      const in1 = Math.abs(x - 200) <= halfW && Math.abs(z - 10) <= halfD;
      const in2 = Math.abs(x - 220) <= halfD && Math.abs(z - 10) <= halfW;
      expect(in1 || in2).toBe(true);
    }
    // Two sides and the back of each stall: 3 quads, 6 triangles per stall.
    expect(q.count / 3).toBe(2 * 6);
  });

  it("draws nothing it was not given, and disposes what it built", () => {
    expect(meshes(createLotLayer({ stalls: [], tracks: [], gravel: [] }).group)).toHaveLength(0);
    expect(meshes(createLotLayer({ stalls: [stalls], tracks: [], gravel: [] }).group)).toHaveLength(
      1,
    );
    const l = createLotLayer({ stalls: [stalls], tracks: [tracks], gravel: [site] });
    const geos = meshes(l.group).map((m) => m.geometry);
    let disposed = 0;
    for (const g of geos) g.addEventListener("dispose", () => disposed++);
    l.dispose();
    expect(disposed).toBe(2);
  });

  it("streamed ground draws stay within 6: land cover + roads (surface, markings) + lots, one left for verges (9b)", () => {
    const frame = createFrame([101.6, 3.3]);
    const ll = (x: number, z: number) => frame.toLonLat(x, z);
    const walk = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: { id: "m", type: "major_road" },
          geometry: {
            type: "LineString" as const,
            coordinates: [ll(0, 0), ll(200, 0)],
          },
        },
      ],
    };
    const lc = landcoverMesh(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { class: "grass" },
            geometry: {
              type: "Polygon",
              coordinates: [[ll(0, 0), ll(50, 0), ll(50, 50), ll(0, 50), ll(0, 0)]],
            },
          },
        ],
      },
      frame,
    );
    const land = createGroundLayer([], lc, "high");
    const roads = createGroundLayer(
      ribbonsFromWalk(walk, frame),
      new THREE.BufferGeometry(),
      "high",
    );
    const draws = meshes(land.group).length + meshes(roads.group).length + all.length;
    expect(meshes(roads.group)).toHaveLength(2);
    expect(draws).toBe(5);
    expect(draws + 1).toBeLessThanOrEqual(6);
  });
});
