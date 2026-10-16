import * as Cesium from "cesium";
import { describe, expect, it } from "vitest";
import { fakeCesium } from "../fakeCesium.test-util";
import { paletteFor } from "../palette";
import { ANIMATED_VS, buildSky } from "./sky";

const viewer = () => {
  let renders = 0;
  return {
    v: {
      scene: {
        primitives: { add: (p: unknown) => p, remove: () => true },
        requestRender: () => {
          renders++;
        },
      },
    },
    renders: () => renders,
  };
};

const OPTS = {
  at: { lon: 101.51, lat: 3.18 },
  loops: [{ cx: 0, cy: 0, rx: 100, ry: 60, z: 60, period: 40, phase: 0 }],
  clouds: [{ x: 0, y: 0, z: 300, scale: 1 }],
  birdsPerFlock: 7,
};

type Prim = { options: Record<string, any>; show: boolean; modelMatrix?: { t?: number[] } };
const isCloud = (p: Prim) => Array.isArray(p.options.geometryInstances);

describe("buildSky", () => {
  it("birds and clouds are not pickable and cast no shadows; night hides them", () => {
    const { C, primitives } = fakeCesium();
    const sky = buildSky(
      C as never,
      {
        scene: {
          primitives: { add: (p: unknown) => p, remove: () => true },
          requestRender: () => {},
        },
      } as never,
      {
        at: { lon: 101.51, lat: 3.18 },
        loops: [{ cx: 0, cy: 0, rx: 100, ry: 60, z: 60, period: 40, phase: 0 }],
        clouds: [{ x: 0, y: 0, z: 300, scale: 1 }],
        palette: paletteFor("day"),
        birdsPerFlock: 7,
      },
    );
    expect(primitives.length).toBeGreaterThan(0);
    for (const p of primitives) {
      expect(p.options.allowPicking).toBe(false);
      expect(p.options.shadows ?? 0).toBe(0); // ShadowMode.DISABLED
    }
    sky.setPalette(paletteFor("night"));
    expect(primitives.every((p) => (p as unknown as { show: boolean }).show === false)).toBe(true);
  });

  it("one primitive per flock and per cloud; birds flap in the vertex shader", () => {
    const { C, primitives } = fakeCesium();
    buildSky(C as never, viewer().v as never, {
      ...OPTS,
      loops: [OPTS.loops[0]!, { ...OPTS.loops[0]!, phase: 1 }],
      clouds: [OPTS.clouds[0]!, { x: 50, y: 50, z: 320, scale: 1.2 }],
      palette: paletteFor("day"),
    });
    const prims = primitives as unknown as Prim[];
    const birds = prims.filter((p) => !isCloud(p));
    expect(birds).toHaveLength(2);
    expect(prims.filter(isCloud)).toHaveLength(2);
    for (const b of birds) {
      const app = b.options.appearance.options;
      expect(app.vertexShaderSource.startsWith("#define TL_BIRD\n")).toBe(true);
      expect(app).toMatchObject({ flat: true, translucent: false });
      expect(b.options).toMatchObject({ asynchronous: false, compressVertices: false });
      // Custom geometry: 4 vertices and 4 triangles per bird, st.s in {-1, 0, 1}, st.t = bird index.
      const g = b.options.geometryInstances.options.geometry.options;
      const st = g.attributes.st.options.values as Float32Array;
      expect(st.length / 2).toBe(7 * 5);
      expect(g.indices.length / 3).toBe(7 * 4);
      const s = new Set<number>();
      const t = new Set<number>();
      for (let i = 0; i < st.length; i += 2) {
        s.add(st[i]!);
        t.add(st[i + 1]!);
      }
      expect([...s].sort()).toEqual([-1, 0, 1]);
      expect([...t].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      // No vertex at the exact local origin (Cesium cannot project it to 2D).
      const pos = g.attributes.position.options.values as Float64Array;
      for (let i = 0; i < pos.length; i += 3)
        expect(Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!)).toBeGreaterThan(0.01);
    }
    for (const c of prims.filter(isCloud)) {
      expect(c.options.appearance.options).toMatchObject({ flat: true, translucent: true });
      expect(c.options.geometryInstances.length).toBeGreaterThanOrEqual(3);
      expect(c.options.geometryInstances.length).toBeLessThanOrEqual(5);
    }
  });

  it("tick moves flocks along their loop and drifts clouds", () => {
    const { C, primitives } = fakeCesium();
    const sky = buildSky(C as never, viewer().v as never, { ...OPTS, palette: paletteFor("day") });
    const prims = primitives as unknown as Prim[];
    const bird = prims.find((p) => !isCloud(p))!;
    const cloud = prims.find(isCloud)!;
    const b0 = bird.modelMatrix!.t!;
    const c0 = cloud.modelMatrix!.t!;
    expect(b0).toEqual([100, 0, 60]); // loopPoint at t = 0
    expect(c0).toEqual([0, 0, 300]);
    sky.tick(10);
    expect(bird.modelMatrix!.t).not.toEqual(b0);
    expect(cloud.modelMatrix!.t![0]).toBeCloseTo(10 * 3 * 0.92);
    expect(cloud.modelMatrix!.t![2]).toBe(300);
  });

  it("setVisible follows Motion (birds) and the tier (clouds); night wins", () => {
    const { C, primitives } = fakeCesium();
    const vw = viewer();
    const sky = buildSky(C as never, vw.v as never, { ...OPTS, palette: paletteFor("day") });
    const prims = primitives as unknown as Prim[];
    const bird = prims.find((p) => !isCloud(p))!;
    const cloud = prims.find(isCloud)!;
    expect([bird.show, cloud.show]).toEqual([true, true]);
    sky.setVisible(false, true);
    expect([bird.show, cloud.show]).toEqual([false, true]);
    expect(vw.renders()).toBeGreaterThan(0);
    sky.setPalette(paletteFor("night"));
    expect([bird.show, cloud.show]).toEqual([false, false]);
    sky.setVisible(true, true);
    expect([bird.show, cloud.show]).toEqual([false, false]);
    sky.setPalette(paletteFor("dusk"));
    expect([bird.show, cloud.show]).toEqual([true, true]);
  });

  it("clouds take a dusk tint, stay translucent and do not shade themselves", () => {
    const { C, materials } = fakeCesium();
    const sky = buildSky(C as never, viewer().v as never, { ...OPTS, palette: paletteFor("day") });
    const cloudMat = materials.find((m) => "cloudShadow" in m.uniforms && m.type === "fabric")!;
    expect(cloudMat.uniforms.cloudShadow).toBe(0);
    const dayColour = cloudMat.uniforms.color as { css: string; alpha: number };
    expect(dayColour.alpha).toBe(0.92);
    sky.setPalette(paletteFor("dusk"));
    const duskColour = cloudMat.uniforms.color as { css: string; alpha: number };
    expect(duskColour.css).not.toBe(dayColour.css);
    expect(duskColour.alpha).toBe(0.92);
    expect(cloudMat.uniforms.cloudShadow).toBe(0);
  });

  it("destroy removes everything once", () => {
    const { C, primitives } = fakeCesium();
    const sky = buildSky(C as never, viewer().v as never, { ...OPTS, palette: paletteFor("day") });
    sky.destroy();
    sky.destroy();
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
  });

  it("ANIMATED_VS declares exactly Cesium's TexturedMaterialAppearanceVS attributes and varyings", () => {
    // The real shader source shipped in the pinned Cesium bundle.
    const src = (Cesium as unknown as Record<string, string>)._shadersTexturedMaterialAppearanceVS!;
    expect(src).toMatch(/czm_computePosition/);
    const decls = (s: string) => s.match(/^\s*(in|out)\s+\w+\s+\w+;/gm)!.map((d) => d.trim());
    expect(decls(ANIMATED_VS)).toEqual(decls(src));
    expect(ANIMATED_VS).toMatch(/czm_frameNumber/);
  });
});
