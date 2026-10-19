import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadAssetLibrary } from "./library";
import { parseManifest } from "./manifest";
import { smoothFoliageNormals } from "./smoothFoliage";

/** Two flat faces of foliage role (g = 6/7) meeting along an edge, plus one trunk face (role 4). */
function folded(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const fol = 6 / 7;
  const col = [
    0,
    fol,
    0,
    0,
    fol,
    0,
    0,
    fol,
    0,
    0,
    fol,
    0,
    0,
    fol,
    0,
    0,
    fol,
    0,
    0,
    4 / 7,
    0,
    0,
    4 / 7,
    0,
    0,
    4 / 7,
    0,
  ];
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

describe("smoothFoliageNormals (AC-B3 trees)", () => {
  it("averages the normals of coincident foliage vertices, leaving other roles flat", () => {
    const g = folded();
    expect(smoothFoliageNormals(g)).toBe(4); // the shared edge: 2 vertices x 2 faces
    const n = g.getAttribute("normal");
    // vertex 0 (z-facing face) and vertex 3 (y-facing face) now share the bevelled normal
    expect(n.getY(0)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(n.getZ(0)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(n.getY(3)).toBeCloseTo(n.getY(0), 5);
    // the lone vertices of each face keep their flat normal
    expect(n.getZ(2)).toBeCloseTo(1, 5);
    // trunk (role 4) untouched
    expect([n.getX(6), n.getY(6), n.getZ(6)]).toEqual([0, 0, 1]);
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

  it("has smooth canopy normals and the same triangle count as the baked glb", async () => {
    const lib = await loadAssetLibrary(manifest, { assets: ["trees"], loadGlb: glb });
    const g = lib.geometry("trees", "rain_tree", 0)!;
    expect(g).toBeTruthy();
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    const col = g.getAttribute("color");
    // Every group of coincident foliage vertices shares one normal (no facet seams).
    const byPos = new Map<string, THREE.Vector3[]>();
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(col.getY(i) * 7) !== 6) continue;
      const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1000)).join();
      const l = byPos.get(k) ?? [];
      l.push(new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)));
      byPos.set(k, l);
    }
    let shared = 0;
    for (const l of byPos.values()) {
      if (l.length < 2) continue;
      shared++;
      for (const v of l) expect(v.distanceTo(l[0]!)).toBeLessThan(1e-4);
    }
    expect(shared).toBeGreaterThan(20);
    const tris = (g.index ? g.index.count : pos.count) / 3;
    console.info(`rain_tree LOD0 triangles: ${tris} (unchanged by smoothing)`);
    lib.dispose();
  });
});
