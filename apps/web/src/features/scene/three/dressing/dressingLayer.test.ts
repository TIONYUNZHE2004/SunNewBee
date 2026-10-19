import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { boundaryOf } from "../ground/boundary";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { createDressingLayer } from "./dressingLayer";
import { buildDressingModels, FLOWER_TINTS, trianglesOf } from "./dressingModels";
import {
  DECOR_MODELS,
  type DressItem,
  FACT_MODELS,
  factItems,
  planDecorProps,
  planFactProps,
  walkLines,
} from "./dressingPlan";

/** Every hex colour of the clay palette, as THREE colours (linear), to check vertex colours against. */
function paletteColours(): THREE.Color[] {
  const out: THREE.Color[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("#")) out.push(new THREE.Color(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(CLAY_PALETTE);
  return out;
}

describe("dressing models: clay, rounded, low poly", () => {
  const models = buildDressingModels();

  it("builds every fact and decorative model (flowers per tint)", () => {
    for (const m of [...FACT_MODELS, ...DECOR_MODELS])
      if (m === "flowers")
        for (let i = 0; i < FLOWER_TINTS; i++) expect(models.has(`flowers:${i}`)).toBe(true);
      else expect(models.has(m), m).toBe(true);
  });

  it("is low poly (each model under 600 triangles; kerb and zebra under 40)", () => {
    for (const [k, g] of models) expect(trianglesOf(g), k).toBeLessThan(600);
    expect(trianglesOf(models.get("kerb")!)).toBeLessThan(40);
    expect(trianglesOf(models.get("zebra")!)).toBeLessThan(40);
  });

  it("is rounded: every box has bevelled (oblique) faces", () => {
    for (const [k, g] of models) {
      const n = g.getAttribute("normal");
      let oblique = 0;
      for (let i = 0; i < n.count; i++) {
        const a = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
        if (a.every((c) => c < 0.99)) oblique++;
      }
      expect(oblique, k).toBeGreaterThan(0);
    }
  });

  it("colours only from the clay palette, on the ground, +y up", () => {
    const pal = paletteColours();
    for (const [k, g] of models) {
      const c = g.getAttribute("color");
      for (let i = 0; i < c.count; i += 7) {
        const col = new THREE.Color(c.getX(i), c.getY(i), c.getZ(i));
        expect(
          pal.some(
            (p) => Math.abs(p.r - col.r) + Math.abs(p.g - col.g) + Math.abs(p.b - col.b) < 1e-4,
          ),
          k,
        ).toBe(true);
      }
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y, k).toBeGreaterThan(-0.2);
    }
  });
});

const item = (
  key: string,
  model: DressItem["model"],
  x: number,
  z: number,
  sourceId?: string,
): DressItem => ({
  key,
  model,
  x,
  z,
  yaw: 0,
  s: 1,
  ...(sourceId ? { sourceId } : {}),
});

describe("dressing layer: instanced, distance gated", () => {
  it("draws only the items within the gate, with fact source ids per instance", () => {
    const layer = createDressingLayer({ tier: "medium" });
    layer.setItems([
      item("a", "bench", 0, 0, "osm-node-1"),
      item("b", "bench", 100, 0, "osm-node-2"),
      item("c", "bench", 400, 0, "osm-node-3"),
      item("d", "planter", 10, 0),
      item("e", "planter", 300, 0),
    ]);
    const s = layer.update([0, 0], 150);
    expect(s.instances).toEqual({ bench: 2, planter: 1 });
    expect(s.facts).toBe(2);
    expect(s.decor).toBe(1);
    const bench = layer.group.getObjectByName("dressing__bench") as THREE.InstancedMesh;
    expect(bench.count).toBe(2);
    expect(bench.userData.sourceIds).toEqual(["osm-node-1", "osm-node-2"]);
    expect(bench.userData.decorative).toBe(false);
    const planter = layer.group.getObjectByName("dressing__planter") as THREE.InstancedMesh;
    expect(planter.userData.decorative).toBe(true);
    expect(planter.userData.sourceIds).toEqual([]);
    // a null focus hides everything
    expect(layer.update(null, 150).instances).toEqual({});
    expect(bench.visible).toBe(false);
    layer.dispose();
  });

  it("a weight scales the instance (the bubble's fade seam)", () => {
    const layer = createDressingLayer({ tier: "low" });
    layer.setItems([item("a", "planter", 0, 0)]);
    layer.update([0, 0], 150, () => 0.5);
    const mesh = layer.group.getObjectByName("dressing__planter") as THREE.InstancedMesh;
    const mat = new THREE.Matrix4();
    mesh.getMatrixAt(0, mat);
    const s = new THREE.Vector3();
    mat.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(0.5, 6);
    layer.dispose();
  });
});

describe("budget on the Elmina seed (150 m around Harmoni 1)", () => {
  const seed = (p: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
    );
  const site = seed("site.json");
  const f = createFrame(site.center);
  const boundary = boundaryOf(seed("base/boundary.geojson").features[0].geometry, f)!;
  const walk = seed("base/walk.geojson");
  const lines = walkLines(walk, f);
  const parks = seed("base/parks.geojson");
  const [hx, hz] = f.toLocal(101.5095, 3.1805);
  const R = 150;
  const facts = factItems(
    planFactProps({
      furniture: seed("base/street_furniture.geojson"),
      walk,
      frame: f,
      boundary,
      lines,
    }),
  );
  const decor = planDecorProps({
    lines,
    parks,
    frame: f,
    boundary,
    box: [hx - R, hz - R, hx + R, hz + R],
  });

  it("stays within the dressing budget (instances and triangles)", () => {
    const layer = createDressingLayer({ tier: "high" });
    layer.setItems([...facts, ...decor]);
    const s = layer.update([hx, hz], R);
    expect(s.decor).toBeGreaterThan(50);
    expect(s.decor + s.facts).toBeLessThan(6000);
    expect(s.triangles).toBeLessThan(200_000);
    // draw calls: one per non-empty bucket
    expect(Object.keys(s.instances).length).toBeLessThanOrEqual(14);
    layer.dispose();
  });
});

describe("B-T8: the dressing fades at the bubble edge (layer + fader)", () => {
  it("leaving the bubble shrinks instances over >= 0.5 s instead of dropping them", async () => {
    const { createBubbleFader, BUBBLE_FADE_S } = await import("../detailBubble");
    const layer = createDressingLayer({ tier: "medium" });
    layer.setItems([item("a", "planter", 0, 0), item("b", "bench", 10, 0, "osm-node-1")]);
    const fader = createBubbleFader();
    const pass = (focus: [number, number] | null, t: number) => {
      fader.begin();
      return layer.update(focus, 150, (it, d) => fader.weight(it.key, d <= 150, t));
    };
    let t = 0;
    expect(pass([0, 0], t).facts + pass([0, 0], t).decor).toBe(0); // first sight: weight 0
    for (; fader.fading() || t === 0; t += 16) pass([0, 0], t + 16);
    expect(pass([0, 0], t).instances).toEqual({ planter: 1, bench: 1 });
    // focus jumps 1 km away: still drawn on the next frame, gone only after the fade
    const t0 = t;
    t += 16;
    let s = pass([1000, 0], t);
    expect(s.instances).toEqual({ planter: 1, bench: 1 });
    while (s.facts + s.decor > 0) {
      t += 16;
      s = pass([1000, 0], t);
    }
    expect(t - t0).toBeGreaterThanOrEqual(BUBBLE_FADE_S * 1000);
    layer.dispose();
  });
});
