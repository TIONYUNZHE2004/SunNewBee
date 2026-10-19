import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { toBuildings } from "../../shared/model";
import { displayHeight } from "../cityMesh";
import { createFrame } from "../frame";
import { boundaryOf } from "../ground/boundary";
import { clipLayer } from "../ground/clipLayer";
import { buildingIdOf } from "./cityInstances";
import { parseManifest } from "./manifest";
import { planCity } from "./plan";

/**
 * Coordinator ruling (B-T2 fix round 1): archetype models are display stand-ins fitted to the
 * footprint OBB (ADR 0012), so their footprint is not a fact, but they keep the one cheap fact,
 * the building's top. For every archetype and landmark placement of the clipped seed (all assets
 * loaded), the drawn top = sy x the LOD0 world max y read straight from the committed glb (not
 * from the manifest) lies within ±0.1 m of the building's `display_height_m`.
 */
const SEED = (p: string) => new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url);
const CITY = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const HAVE = existsSync(SEED("base/buildings.geojson")) && existsSync(CITY("manifest.json"));

/** LOD0 world max y of `node` in a glb: accessor bounds (dequantised) through the node matrices. */
function glbTop(file: URL, node: string): number {
  const buf = readFileSync(file);
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
  const nodes = gltf.nodes as Array<Record<string, unknown>>;
  const parent = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const c of (n.children as number[] | undefined) ?? []) parent.set(c, i);
  });
  const local = (n: Record<string, unknown>) =>
    n.matrix
      ? new THREE.Matrix4().fromArray(n.matrix as number[])
      : new THREE.Matrix4().compose(
          new THREE.Vector3(...((n.translation as number[]) ?? [0, 0, 0])),
          new THREE.Quaternion(...((n.rotation as number[]) ?? [0, 0, 0, 1])),
          new THREE.Vector3(...((n.scale as number[]) ?? [1, 1, 1])),
        );
  const world = (i: number): THREE.Matrix4 => {
    const m = local(nodes[i]!);
    const p = parent.get(i);
    return p === undefined ? m : world(p).multiply(m);
  };
  const NORM: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
  const i = nodes.findIndex((n) => n.name === node);
  expect(i, node).toBeGreaterThanOrEqual(0);
  const m = world(i);
  let top = Number.NEGATIVE_INFINITY;
  for (const prim of gltf.meshes[nodes[i]!.mesh as number].primitives) {
    const acc = gltf.accessors[prim.attributes.POSITION];
    const dq = (v: number) =>
      acc.normalized && NORM[acc.componentType] ? Math.max(v / NORM[acc.componentType]!, -1) : v;
    for (const x of [acc.min[0], acc.max[0]])
      for (const y of [acc.min[1], acc.max[1]])
        for (const z of [acc.min[2], acc.max[2]])
          top = Math.max(top, new THREE.Vector3(dq(x), dq(y), dq(z)).applyMatrix4(m).y);
  }
  return top;
}

describe.skipIf(!HAVE)(
  "archetype and landmark tops match display_height_m (B-T2 fix round 1)",
  () => {
    const read = (u: URL) => JSON.parse(readFileSync(u, "utf8"));
    const frame = createFrame(read(SEED("site.json")).center);
    const boundary = boundaryOf(read(SEED("base/boundary.geojson")).features[0].geometry, frame)!;
    const raw = {
      buildings: read(SEED("base/buildings.geojson")),
      landmarks: read(SEED("base/landmarks.geojson")),
    } as unknown as BuildingsLayer;
    const { layer } = clipLayer(raw, boundary, frame);
    const { manifest } = parseManifest(read(CITY("manifest.json")));
    const m = manifest!;
    const height = new Map(
      toBuildings(layer.buildings, displayHeight).buildings.map((b) => [b.id, b.height] as const),
    );
    const tops = new Map<string, number>();
    const topOf = (asset: string, variant: string) => {
      const k = `${asset}/${variant}`;
      if (!tops.has(k))
        tops.set(k, glbTop(CITY(m.assets[asset]!.file), `${asset}__${variant}__LOD0`));
      return tops.get(k)!;
    };
    const plan = planCity(layer, frame, m, () => true, boundary);
    const landmarkBuilding = new Map<string, { bid: string | null; traced: boolean }>();
    for (const f of (
      layer.landmarks as { features: Array<{ properties: Record<string, unknown> }> }
    ).features) {
      const p = f.properties;
      landmarkBuilding.set(String(p.id ?? p.model), {
        bid: typeof p.building_id === "string" ? p.building_id : null,
        traced: p.match === "traced_outline",
      });
    }

    it("every archetype unit: sy x LOD0 top within ±0.1 m of its building's display height", () => {
      const fails: string[] = [];
      let units = 0;
      for (const [key, list] of plan.placements) {
        const [asset, variant] = key.split("/") as [string, string];
        const t = topOf(asset, variant);
        for (const u of list) {
          units++;
          const h = height.get(buildingIdOf(u.id))!;
          const top = u.sy * t;
          if (!(Math.abs(top - h) <= 0.1))
            fails.push(`${u.id} ${key} top ${top.toFixed(2)} vs ${h}`);
        }
      }
      expect(units).toBeGreaterThan(1000);
      expect(fails.slice(0, 10)).toEqual([]);
    });

    it("every landmark: the drawn top is its building's display height, or the documented design height", () => {
      expect(plan.landmarks.length).toBeGreaterThan(0);
      for (const l of plan.landmarks) {
        const top = l.sy * topOf(l.asset, l.variant);
        const src = landmarkBuilding.get(l.id)!;
        if (src.traced) {
          // A traced tower outline (Kanopi) stands on a real OSM podium that stays drawn at its own
          // height; the tower is drawn at the manifest's documented design height (heightBasis).
          expect(m.assets[l.asset]!.heightBasis, l.id).toBeTruthy();
          expect(
            Math.abs(top - m.assets[l.asset]!.variants[l.variant]!.size[1]),
            l.id,
          ).toBeLessThan(0.1);
        } else {
          expect(Math.abs(top - height.get(src.bid!)!), l.id).toBeLessThanOrEqual(0.1);
        }
      }
    });
  },
);
