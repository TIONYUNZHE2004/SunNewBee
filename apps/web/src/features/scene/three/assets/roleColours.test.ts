import { readdirSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { BAKED_AO_FLOOR, FIXED_ROLE_COLOURS } from "./roleMaterial";

/** AC-A9 (A-T8): no archetype material renders pure black. Relative luminance as the acceptance harness measures it. */
const MIN_LUMINANCE = 0.08;
const url = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const manifest = JSON.parse(readFileSync(url("manifest.json"), "utf8"));

const luminance = (hex: string): number => {
  const c = new THREE.Color(hex); // linear working space
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

describe("AC-A9: archetype role colours are not near black", () => {
  it("every fixed role colour is at least 0.08 luminance (except the emissive-light role, which is pale)", () => {
    for (const [role, hex] of Object.entries(FIXED_ROLE_COLOURS))
      expect(luminance(hex), `${role} ${hex}`).toBeGreaterThanOrEqual(MIN_LUMINANCE);
  });

  it("every manifest palette colour (primary, secondary roof, accent) is at least 0.08 luminance", () => {
    const low: string[] = [];
    for (const [id, spec] of Object.entries(
      manifest.assets as Record<string, { palettes: Record<string, string[][]> }>,
    ))
      for (const [group, list] of Object.entries(spec.palettes))
        for (const trio of list)
          for (const hex of trio)
            if (luminance(hex) < MIN_LUMINANCE) low.push(`${id}/${group}:${hex}`);
    expect(low).toEqual([]);
  });
});

/**
 * The root cause of the black strips: the per-vertex AO bake wrote exact zeros (corners whose smoothed
 * normal points into the ground or body), and role colour x 0 = black. Reads the committed glbs.
 */
describe("AC-A9: baked AO has no black corners in the committed archetypes", () => {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const files = readdirSync(url("archetypes")).filter((f) => f.endsWith(".glb"));

  it("has the archetype glbs to check", () => {
    expect(files).toContain("link_intermediate.glb");
    expect(files).toContain("link_long.glb");
  });

  for (const file of files) {
    it(`${file}: COLOR_0.r (AO) never below the bake floor`, async () => {
      const buf = readFileSync(url(`archetypes/${file}`));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const gltf = await loader.parseAsync(ab, "");
      let min = 1;
      let verts = 0;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        const col = m.isMesh && m.geometry.getAttribute("color");
        if (!col) return;
        for (let i = 0; i < col.count; i++) min = Math.min(min, col.getX(i));
        verts += col.count;
      });
      expect(verts).toBeGreaterThan(0);
      expect(min).toBeGreaterThanOrEqual(BAKED_AO_FLOOR - 0.01);
    });
  }
});
