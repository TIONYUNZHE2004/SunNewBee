import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { projectToScreen } from "../../../journey/three/project";
import {
  applySideProjection,
  pickCameraFor,
  sideAt,
  splitLayout,
  splitViewports,
  UnionFrustum,
} from "./splitView";

const sizes: [number, number, number][] = [
  [1440, 900, 0],
  [1441, 900, 0],
  [1024, 700, 0],
  [1013, 768, 0],
  [390, 844, 0],
  [1440, 900, 420],
  [1439, 900, 377],
];

describe("splitLayout (AC-N2: two halves of equal width)", () => {
  it.each(sizes)(
    "%i x %i, panel %i: halves within 1 px, contiguous, covering the visible map",
    (w, h, panel) => {
      const l = splitLayout(w, h, panel);
      const vp = splitViewports(l);
      expect(Math.abs(vp.left.w - vp.right.w)).toBeLessThanOrEqual(1);
      expect(vp.left.x).toBe(0);
      expect(vp.right.x).toBe(vp.left.w);
      expect(vp.left.w + vp.right.w).toBe(w - panel);
      // both render rects have the composer's width; together they cover the whole canvas
      expect(l.left.vx + l.renderW).toBe(l.right.x);
      expect(l.right.vx + l.renderW).toBe(w);
      for (const v of [vp.left.w, vp.right.w, vp.left.x, vp.right.x])
        expect(Number.isInteger(v)).toBe(true);
    },
  );

  it("sideAt picks the half under x", () => {
    const l = splitLayout(1440, 900);
    expect(sideAt(l, 0)).toBe("left");
    expect(sideAt(l, 719)).toBe("left");
    expect(sideAt(l, 720)).toBe("right");
    expect(sideAt(l, 1439)).toBe("right");
  });

  it.each(sizes)(
    "%i x %i, panel %i: a side camera's centre lands on the middle of its visible half",
    (w, h, panel) => {
      const l = splitLayout(w, h, panel);
      for (const side of ["left", "right"] as const) {
        const cam = new THREE.PerspectiveCamera(50, 1, 1, 1000);
        cam.position.set(0, 20, 40);
        cam.lookAt(0, 0, 0);
        applySideProjection(cam, l, side);
        cam.updateMatrixWorld(true);
        const q = projectToScreen(cam, [0, 0, 0], [l.renderW, h]);
        expect(q).not.toBeNull();
        const x = l[side].vx + (q as { x: number }).x;
        expect(x).toBeCloseTo(l[side].x + l[side].w / 2, 3);
      }
    },
  );

  it.each(sizes)(
    "%i x %i, panel %i: the pick camera maps whole-canvas pixels as the side draws them",
    (w, h, panel) => {
      const l = splitLayout(w, h, panel);
      for (const side of ["left", "right"] as const) {
        const cam = new THREE.PerspectiveCamera(50, 1, 1, 1000);
        cam.position.set(5, 26, 42);
        cam.lookAt(0, 0, 0);
        applySideProjection(cam, l, side);
        cam.updateMatrixWorld(true);
        const pick = pickCameraFor(cam, l, side);
        for (const p of [
          [0, 0, 0],
          [6, 1, -3],
          [-4, 2, 8],
        ] as [number, number, number][]) {
          const drawn = projectToScreen(cam, p, [l.renderW, h]) as { x: number; y: number };
          const picked = projectToScreen(pick, p, [w, h]) as { x: number; y: number };
          expect(picked.x).toBeCloseTo(l[side].vx + drawn.x, 3);
          expect(picked.y).toBeCloseTo(drawn.y, 3);
        }
      }
    },
  );
});

describe("UnionFrustum", () => {
  it("holds what either view holds", () => {
    const a = new THREE.PerspectiveCamera(50, 1, 1, 100);
    a.position.set(0, 0, 0);
    a.lookAt(0, 0, -1);
    a.updateMatrixWorld(true);
    const b = a.clone();
    b.position.set(500, 0, 0);
    b.updateMatrixWorld(true);
    const u = new UnionFrustum();
    const set = (f: THREE.Frustum, c: THREE.Camera) =>
      f.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse),
      );
    set(u.a, a);
    set(u.b, b);
    expect(u.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 0, -10), 1))).toBe(true);
    expect(u.intersectsSphere(new THREE.Sphere(new THREE.Vector3(500, 0, -10), 1))).toBe(true);
    expect(u.intersectsSphere(new THREE.Sphere(new THREE.Vector3(250, 0, -10), 1))).toBe(false);
    expect(
      u.intersectsBox(
        new THREE.Box3(new THREE.Vector3(499, -1, -12), new THREE.Vector3(501, 1, -8)),
      ),
    ).toBe(true);
    expect(u.containsPoint(new THREE.Vector3(250, 0, 50))).toBe(false);
  });
});
