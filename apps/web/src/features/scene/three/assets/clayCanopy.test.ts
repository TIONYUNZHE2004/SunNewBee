import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NEAR_LOBE_SEGS, roundCanopies } from "./clayCanopy";
import { loadAssetLibrary } from "./library";
import { parseManifest } from "./manifest";

/** A closed 10 x 6 faceted ellipsoid lobe of foliage role (flat normals), plus a trunk triangle. */
function faceted(): THREE.BufferGeometry {
  const s = new THREE.SphereGeometry(1, 10, 6).toNonIndexed();
  s.scale(2, 1.5, 2);
  s.translate(0, 4, 0);
  s.computeVertexNormals(); // flat: non-indexed
  const pos = [...s.getAttribute("position").array, 5, 0, 0, 6, 0, 0, 5, 1, 0];
  const nrm = [...s.getAttribute("normal").array, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const n = pos.length / 3;
  const col: number[] = [];
  for (let i = 0; i < n; i++) col.push(0.5, i < n - 3 ? 6 / 7 : 4 / 7, 0.2, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  return g;
}

describe("roundCanopies (AC-B3 trees)", () => {
  it("replaces a closed faceted lobe by a smooth 10 x 7 sphere and keeps the trunk", () => {
    const g = faceted();
    const r = roundCanopies(g);
    expect(r.lobes).toBe(1);
    expect(r.trisBefore).toBe(100 + 1); // 10 x 6 lobe + trunk triangle
    expect(r.trisAfter).toBe(2 * NEAR_LOBE_SEGS[0] * (NEAR_LOBE_SEGS[1] - 1) + 1);
    const p = r.geometry.getAttribute("position");
    const n = r.geometry.getAttribute("normal");
    const c = r.geometry.getAttribute("color");
    // Same extents (silhouette box), ground clearance kept.
    const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
    expect(box.max.y).toBeCloseTo(5.5, 3);
    // Every lobe vertex normal is the smooth ellipsoid normal (radial), and keeps the foliage role.
    let lobeVerts = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.round(c.getY(i) * 7) !== 6) continue;
      lobeVerts++;
      const nn = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
      const ell = new THREE.Vector3(
        p.getX(i) / 4,
        (p.getY(i) - 4) / 2.25,
        p.getZ(i) / 4,
      ).normalize();
      expect(nn.dot(ell)).toBeGreaterThan(0.99);
    }
    expect(lobeVerts).toBe((NEAR_LOBE_SEGS[0] + 1) * (NEAR_LOBE_SEGS[1] + 1));
    // Trunk (role 4) untouched.
    expect([...Array(p.count).keys()].filter((i) => Math.round(c.getY(i) * 7) === 4)).toHaveLength(
      3,
    );
  });

  it("leaves an open frond sheet alone", () => {
    const g = new THREE.PlaneGeometry(4, 1, 6, 2).toNonIndexed();
    const n = g.getAttribute("position").count;
    g.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        Array(n * 4)
          .fill(0)
          .map((_, i) => (i % 4 === 1 ? 6 / 7 : 0.3)),
        4,
      ),
    );
    const r = roundCanopies(g);
    expect(r.lobes).toBe(0);
    expect(r.geometry).toBe(g);
  });
});

describe("the shipped trees kit", () => {
  const manifest = parseManifest(
    JSON.parse(
      readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
    ),
  ).manifest!;
  const glb = async () =>
    readFileSync(
      new URL("../../../../../public/city/kits/trees.glb", import.meta.url),
    ).buffer.slice(0) as ArrayBuffer;
  /** LOD0 triangles of the baked glb (before) per variant, measured before B-T3. */
  const BEFORE: Record<string, number> = {
    rain_tree: 2878,
    coconut_palm: 590,
    royal_palm: 569,
    frangipani: 902,
    flame_tree: 1890,
    oil_palm: 934,
    shrub_round: 338,
    shrub_hedge: 622,
  };
  /** After B-T3: lobes become 10 x 7 spheres (120 triangles instead of ~100). */
  const AFTER: Record<string, number> = {
    rain_tree: 3418,
    coconut_palm: 590,
    royal_palm: 569,
    frangipani: 1022,
    flame_tree: 2190,
    oil_palm: 934,
    shrub_round: 398,
    shrub_hedge: 722,
  };

  it("asserts LOD0 triangle counts per variant before and after; LOD1/2 are unchanged", async () => {
    const lib = await loadAssetLibrary(manifest, { assets: ["trees"], loadGlb: glb });
    for (const [v, after] of Object.entries(AFTER)) {
      const tris = (lod: number) => {
        const g = lib.geometry("trees", v, lod)!;
        return (g.index ? g.index.count : g.getAttribute("position").count) / 3;
      };
      expect(tris(0), v).toBe(after);
      expect(tris(0) / BEFORE[v]!, v).toBeLessThanOrEqual(1.2);
    }
    // Far LODs keep their triangle counts (lobes there are re-fitted 6 x 4 / 8 x 3).
    expect(lib.geometry("trees", "rain_tree", 1)!.index!.count / 3).toBe(397);
    expect(lib.geometry("trees", "rain_tree", 2)!.index!.count / 3).toBe(42);
    lib.dispose();
  });
});
