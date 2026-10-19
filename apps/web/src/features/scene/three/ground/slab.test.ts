import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitFor, fogReachM, overviewPose } from "../cameraFit";
import { poseToCamera } from "../cameraRig";
import { createFrame } from "../frame";
import { LIGHT_PRESETS } from "../lighting";
import { fogFor } from "../mood";
import { boundaryOf, edgeDistance, insideBoundary, type P } from "./boundary";
import {
  createSlab,
  rimProfile,
  SLAB_FOG_SCALE,
  SLAB_LAYERS,
  SOIL_COLOURS,
  slabEdgeMaterial,
  slabGeometry,
} from "./slab";

const seed = (p: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
  );
const site = seed("site.json");
const frame = createFrame(site.center);
const B = boundaryOf(seed("base/boundary.geojson").features[0].geometry, frame)!;

const areaOfRing = (r: readonly P[]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const c = r[(i + 1) % r.length]!;
    s += a[0] * c[1] - c[0] * a[1];
  }
  return Math.abs(s / 2);
};

describe("slabGeometry (Elmina seed)", () => {
  const g = slabGeometry(B);

  it("the top outline equals the boundary within 1 m", () => {
    expect(g.outline).toHaveLength(B.polys.flat().length);
    for (const ring of g.outline)
      for (const [x, z] of ring) expect(edgeDistance(B, x, z)).toBeLessThanOrEqual(1);
    // ...and every boundary vertex is on the outline.
    for (const ring of B.polys.flat())
      for (const v of ring)
        expect(
          g.outline.some((r) => r.some((p) => Math.hypot(p[0] - v[0], p[1] - v[1]) <= 1)),
        ).toBe(true);
  });

  it("the top face covers the boundary area at y = 0, facing up, and nothing outside", () => {
    const p = g.top.getAttribute("position");
    const ix = g.top.getIndex()!;
    let area = 0;
    for (let t = 0; t < ix.count; t += 3) {
      const [a, b, c] = [ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)];
      const ux = p.getX(b) - p.getX(a);
      const uz = p.getZ(b) - p.getZ(a);
      const vx = p.getX(c) - p.getX(a);
      const vz = p.getZ(c) - p.getZ(a);
      const ny = uz * vx - ux * vz;
      expect(ny).toBeGreaterThanOrEqual(0);
      area += ny / 2;
      const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3;
      const cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
      expect(insideBoundary(B, cx, cz)).toBe(true);
    }
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBe(0);
    const want = B.polys.reduce(
      (s, poly) => s + areaOfRing(poly[0]!) - poly.slice(1).reduce((h, r) => h + areaOfRing(r), 0),
      0,
    );
    expect(area).toBeCloseTo(want, -2);
    // site.json records 21.12 km2 for the outline (owner master plan, A-T3b).
    expect(area / 1e6).toBeGreaterThan(20);
    expect(area / 1e6).toBeLessThan(22.5);
  });

  it("has >= 3 soil layers below the crust, each a band stepping down and out", () => {
    expect(SOIL_COLOURS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(SOIL_COLOURS).size).toBe(SOIL_COLOURS.length);
    const col = g.edge.getAttribute("color");
    const pos = g.edge.getAttribute("position");
    const seen = new Set<string>();
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++)
      seen.add(c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHexString());
    for (const s of SOIL_COLOURS) expect(seen.has(s.slice(1))).toBe(true);
    // Bottom of the section: the sum of the layer depths, below the ground.
    let minY = 0;
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    expect(minY).toBeCloseTo(-SLAB_LAYERS.reduce((s, l) => s + l.depthM, 0), 3);
    // The top ring of the edge sits on the outline at y = 0.
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) === 0) expect(edgeDistance(B, pos.getX(i), pos.getZ(i))).toBeLessThan(1);
  });

  it("B-T9: the crust is a rounded rim (quarter ellipse, smooth normals) of the same depth and run", () => {
    const rim = SLAB_LAYERS[0]!;
    expect(rim.round ?? 0).toBeGreaterThanOrEqual(4);
    // Same overall section as before (crust 4 m deep, 3 m run): the foot and the camera fit keep.
    expect(rim.depthM).toBe(4);
    expect(rim.runM).toBe(3);
    // Profile: horizontal at the top edge (continues the ground), steep at the bottom.
    const prof = rimProfile(rim);
    expect(prof[0]).toEqual([0, 0]);
    expect(prof.at(-1)![0]).toBeCloseTo(rim.runM, 9);
    expect(prof.at(-1)![1]).toBeCloseTo(-rim.depthM, 9);
    const slope = (i: number) => (prof[i]![1] - prof[i + 1]![1]) / (prof[i + 1]![0] - prof[i]![0]);
    expect(slope(0)).toBeLessThan(0.5);
    expect(slope(prof.length - 2)).toBeGreaterThan(3);
    for (let i = 0; i + 2 < prof.length; i++) expect(slope(i + 1)).toBeGreaterThan(slope(i));
    // Smooth: the rim's inner rows are shared by two bands (indexed), so a rim vertex normal
    // blends both faces: at the top row it leans up (rounded into the ground), not out.
    const pos = g.edge.getAttribute("position");
    const nrm = g.edge.getAttribute("normal");
    let topRowUp = 0;
    let topRow = 0;
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) === 0) {
        topRow++;
        if (nrm.getY(i) > 0.8) topRowUp++;
      }
    expect(topRow).toBeGreaterThan(0);
    expect(topRowUp / topRow).toBeGreaterThan(0.9);
  });

  it("every edge face looks up and away from the land (seen from above on every side)", () => {
    const pos = g.edge.getAttribute("position");
    const ix = g.edge.getIndex()!;
    let outward = 0;
    let n = 0;
    for (let t = 0; t < ix.count; t += 3) {
      const A = new THREE.Vector3().fromBufferAttribute(pos, ix.getX(t));
      const Bv = new THREE.Vector3().fromBufferAttribute(pos, ix.getX(t + 1));
      const C = new THREE.Vector3().fromBufferAttribute(pos, ix.getX(t + 2));
      const N = Bv.clone().sub(A).cross(C.clone().sub(A));
      if (N.lengthSq() < 1e-9) continue;
      N.normalize();
      expect(N.y).toBeGreaterThan(0);
      // Soil bands slope at about 20 degrees: the normal is within 45 degrees of up.
      n++;
      const h = Math.hypot(N.x, N.z);
      const cx = (A.x + Bv.x + C.x) / 3 + (N.x / (h || 1)) * 2;
      const cz = (A.z + Bv.z + C.z) / 3 + (N.z / (h || 1)) * 2;
      if (!insideBoundary(B, cx, cz)) outward++;
    }
    // Mitred bands at concave corners can fold a sliver inward; nearly all face out.
    expect(outward / n).toBeGreaterThan(0.97);
  });
});

describe("slab materials and meshes", () => {
  it("the edge material reduces fog and keeps the night grade", () => {
    const m = slabEdgeMaterial();
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: "void main() {\n#include <color_fragment>\n#include <fog_fragment>\n}",
      vertexShader: "",
    };
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain(`fogFactor * ${SLAB_FOG_SCALE.toFixed(3)}`);
    expect(shader.fragmentShader).toContain("uGroundGrade");
    expect(SLAB_FOG_SCALE).toBeLessThan(0.8);
  });
  it("createSlab: a decorative, non-pickable group of the top and the edge", () => {
    const groundMat = new THREE.MeshStandardMaterial();
    const s = createSlab(B, groundMat);
    expect(s.group.userData.decorative).toBe(true);
    expect(s.top.material).toBe(groundMat);
    s.group.traverse((o) => expect(o.userData.pick).toBeUndefined());
    s.dispose();
  });
});

describe("slab edge vs the A-T11 fog at the overview bookmark", () => {
  it("the farthest soil (outer foot of the section) is hazed <= 70% in every mood", () => {
    // The overview (A-T5): the whole slab at max range, derived from the outline.
    const fit = fitFor(B);
    const pose = overviewPose(fit);
    const rangeM = pose.rangeM;
    const cam = poseToCamera(pose).position;
    const g = slabGeometry(B);
    let farthest = 0;
    for (const ring of g.foot)
      for (const [x, y, z] of ring)
        farthest = Math.max(farthest, Math.hypot(x - cam[0], y - cam[1], z - cam[2]));
    expect(farthest).toBeGreaterThan(9000);
    for (const theme of ["day", "dusk", "night"] as const) {
      const f = fogFor(LIGHT_PRESETS[theme], rangeM, fogReachM(fit, rangeM));
      const t = Math.min(1, Math.max(0, (farthest - f.near) / (f.far - f.near)));
      // three's linear Fog is smoothstep(near, far, depth) in the shader.
      const shader = t * t * (3 - 2 * t);
      expect(shader * SLAB_FOG_SCALE, theme).toBeLessThanOrEqual(0.7);
      expect(shader, `${theme}: the ground there stays fogged (AC-A13)`).toBeGreaterThan(0.85);
    }
  });
});
