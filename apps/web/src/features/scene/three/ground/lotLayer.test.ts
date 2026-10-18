import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Site } from "../props/construction";
import { CONSTRUCTION_Y, LANDCOVER_MAX_Y, MARKING_Y, PARK_Y, WATER_Y } from "./bands";
import { constructionGround, stallLines } from "./lotLayer";
import { STALL_D_M, STALL_LIFT_Y, STALL_LINE_M, STALL_W_M } from "./parking";

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
const ys = (p: Float32Array) =>
  new Set(Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + 1]));
const facesUp = (p: Float32Array) => {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i);
    b.fromArray(p, i + 3);
    c.fromArray(p, i + 6);
    expect(b.clone().sub(a).cross(c.clone().sub(a)).y).toBeGreaterThan(0);
  }
};

describe("lot ground lifts (Task 10b)", () => {
  it("construction ground sits above land cover and below parks and base water; stall lines at the markings lift", () => {
    expect(CONSTRUCTION_Y).toBeGreaterThan(LANDCOVER_MAX_Y);
    expect(CONSTRUCTION_Y).toBeLessThan(PARK_Y);
    expect(CONSTRUCTION_Y).toBeLessThan(WATER_Y);
    expect(CONSTRUCTION_Y).toBeLessThanOrEqual(0.06);
    expect(STALL_LIFT_Y).toBe(MARKING_Y);
  });
});

describe("constructionGround (folded into the ground-decor mesh)", () => {
  const g = constructionGround([tracks], [site]);

  it("is flat at CONSTRUCTION_Y, upward facing, coloured per vertex", () => {
    expect([...ys(g.pos)]).toEqual([Math.fround(CONSTRUCTION_Y)]);
    expect(g.col.length).toBe(g.pos.length);
    facesUp(g.pos);
  });

  it("gravel covers the site and the tracks stay in it", () => {
    let area = 0;
    for (let i = 0; i < g.pos.length; i += 9) {
      const [ax, az, bx, bz, cx, cz] = [0, 3, 6].flatMap((k) => [g.pos[i + k]!, g.pos[i + k + 2]!]);
      area += Math.abs((bx! - ax!) * (cz! - az!) - (cx! - ax!) * (bz! - az!)) / 2;
    }
    // 8,000 m2 of gravel plus one 80 x 4 m track.
    expect(area).toBeCloseTo(8000 + 320, 0);
    for (let i = 0; i < g.pos.length; i += 3) {
      expect(g.pos[i]!).toBeGreaterThanOrEqual(-1e-3);
      expect(g.pos[i]!).toBeLessThanOrEqual(100 + 1e-3);
    }
  });

  it("is empty when given nothing", () => {
    expect(constructionGround([], []).pos.length).toBe(0);
  });
});

describe("stallLines (folded into the road-markings mesh)", () => {
  const q = stallLines([stalls]);

  it("sits at the markings lift, upward facing", () => {
    expect([...ys(q)]).toEqual([Math.fround(STALL_LIFT_Y)]);
    facesUp(q);
  });

  it("stall lines stay on their stalls: two sides and the back, 6 triangles per stall", () => {
    const halfW = STALL_W_M / 2 + STALL_LINE_M;
    const halfD = STALL_D_M / 2 + STALL_LINE_M;
    for (let i = 0; i < q.length; i += 3) {
      const x = q[i]!;
      const z = q[i + 2]!;
      // Stall 1 (yaw 0): width along x, depth along z; stall 2 (yaw pi/2): the other way round.
      const in1 = Math.abs(x - 200) <= halfW && Math.abs(z - 10) <= halfD;
      const in2 = Math.abs(x - 220) <= halfD && Math.abs(z - 10) <= halfW;
      expect(in1 || in2).toBe(true);
    }
    expect(q.length / 9).toBe(2 * 6);
    expect(stallLines([]).length).toBe(0);
  });
});
