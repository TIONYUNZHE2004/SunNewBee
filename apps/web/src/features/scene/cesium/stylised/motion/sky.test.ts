import * as Cesium from "cesium";
import { describe, expect, it } from "vitest";
import { fakeCesium } from "../fakeCesium.test-util";
import { paletteFor } from "../palette";
import { ANIMATED_VS, buildSky, CLOUD_ALPHA } from "./sky";

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

type Prim = {
  options: Record<string, any>;
  show: boolean;
  ready: boolean;
  attrs: Map<string, Record<string, unknown>>;
};
const isBirds = (p: Prim) => p.options.appearance.options.vertexShaderSource !== undefined;
const isCloud = (p: Prim) => !isBirds(p);

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

  it("one bird primitive for every flock and one cloud primitive; birds flap in the shader", () => {
    const { C, primitives, geometries } = fakeCesium();
    buildSky(C as never, viewer().v as never, {
      ...OPTS,
      loops: [OPTS.loops[0]!, { ...OPTS.loops[0]!, phase: 1 }],
      clouds: [OPTS.clouds[0]!, { x: 50, y: 50, z: 320, scale: 1.2 }],
      palette: paletteFor("day"),
    });
    const prims = primitives as unknown as Prim[];
    expect(prims).toHaveLength(2);
    const birds = prims.find(isBirds)!;
    const app = birds.options.appearance.options;
    expect(app.vertexShaderSource.startsWith("#define TL_BIRD\n")).toBe(true);
    expect(app).toMatchObject({ flat: true, translucent: false });
    expect(birds.options).toMatchObject({
      asynchronous: false,
      compressVertices: false,
      cull: false, // the shader moves flocks away from the geometry bounds
    });
    const flocks = birds.options.geometryInstances as { options: Record<string, any> }[];
    expect(flocks.map((f) => f.options.id)).toEqual(["flock:0", "flock:1"]);
    for (const f of flocks) {
      expect(f.options.attributes.flock.options).toMatchObject({ componentsPerAttribute: 4 });
      // Custom geometry: 5 vertices and 4 triangles per bird, st.s in {-1, 0, 1}, st.t = index.
      const g = f.options.geometry.options;
      const st = g.attributes.st.options.values as Float32Array;
      expect(st.length / 2).toBe(7 * 5);
      expect(g.indices.length / 3).toBe(7 * 4);
      const sv = new Set<number>();
      const tv = new Set<number>();
      for (let i = 0; i < st.length; i += 2) {
        sv.add(st[i]!);
        tv.add(st[i + 1]!);
      }
      expect([...sv].sort()).toEqual([-1, 0, 1]);
      expect([...tv].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      const pos = g.attributes.position.options.values as Float64Array;
      for (let i = 0; i < pos.length; i += 3)
        expect(Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!)).toBeGreaterThan(0.01);
    }
    expect(ANIMATED_VS).toContain("czm_batchTable_flock(batchId)");
    const cloud = prims.find(isCloud)!;
    expect(cloud.options.appearance.options).toMatchObject({ flat: true, translucent: true });
    const puffs = cloud.options.geometryInstances as { options: Record<string, any> }[];
    expect(puffs.length).toBeGreaterThanOrEqual(6);
    expect(puffs.length).toBeLessThanOrEqual(10);
    // Puffs carry applyOffset so the per-instance offset moves them.
    expect(geometries.find((g) => g.kind === "ellipsoid")?.options.offsetAttribute).toBe(2);
    for (const p of puffs)
      expect(p.options.attributes.offset.options).toMatchObject({
        componentsPerAttribute: 3,
        value: [0, 0, 0],
      });
  });

  it("tick moves flocks along their loop and drifts clouds once the primitives are ready", () => {
    const { C, primitives } = fakeCesium();
    const sky = buildSky(C as never, viewer().v as never, { ...OPTS, palette: paletteFor("day") });
    const prims = primitives as unknown as Prim[];
    const birds = prims.find(isBirds)!;
    const cloud = prims.find(isCloud)!;
    const flock0 = (birds.options.geometryInstances as { options: Record<string, any> }[])[0]!
      .options.attributes.flock.options.value as number[];
    expect(flock0.slice(0, 3)).toEqual([100, 0, 60]); // loopPoint at t = 0
    sky.tick(10); // not ready: nothing written, no throw
    expect(birds.attrs.size + cloud.attrs.size).toBe(0);
    birds.ready = true;
    cloud.ready = true;
    sky.tick(10);
    const f = birds.attrs.get("flock:0")!.flock as number[];
    expect(f.slice(0, 3)).not.toEqual([100, 0, 60]);
    const off = [...(cloud.attrs.get("cloud:0:0")!.offset as Float32Array)];
    expect(off[0]).toBeCloseTo(10 * 3 * 0.92, 4);
    expect(off[2]).toBe(0);
    for (const [id, a] of cloud.attrs) expect([...(a.offset as Float32Array)], id).toEqual(off);
  });

  it("clouds built before they are ready are placed on their first ready frame", () => {
    const { C, primitives } = fakeCesium();
    const listeners: (() => void)[] = [];
    const vw = viewer();
    const v = {
      scene: {
        ...vw.v.scene,
        postRender: {
          addEventListener: (cb: () => void) => {
            listeners.push(cb);
            return () => listeners.splice(listeners.indexOf(cb), 1);
          },
        },
      },
    };
    const sky = buildSky(C as never, v as never, { ...OPTS, palette: paletteFor("day") });
    sky.tick(20); // Motion off after this: no more ticks
    const cloud = (primitives as unknown as Prim[]).find(isCloud)!;
    listeners[0]!();
    expect(cloud.attrs.size).toBe(0);
    cloud.ready = true;
    listeners[0]!();
    expect((cloud.attrs.get("cloud:0:0")!.offset as Float32Array)[0]).toBeCloseTo(20 * 3 * 0.92, 4);
    expect(listeners).toHaveLength(0);
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

  it("setVisible(birds, false) hides the clouds only (route or flood scenario shown)", () => {
    const { C, primitives } = fakeCesium();
    const sky = buildSky(C as never, viewer().v as never, { ...OPTS, palette: paletteFor("day") });
    const prims = primitives as unknown as Prim[];
    const bird = prims.find((p) => !isCloud(p))!;
    const cloud = prims.find(isCloud)!;
    sky.setVisible(true, false);
    expect([bird.show, cloud.show]).toEqual([true, false]);
    sky.setVisible(true, true);
    expect([bird.show, cloud.show]).toEqual([true, true]);
  });

  it("clouds take a dusk tint, stay translucent and do not shade themselves", () => {
    const { C, materials } = fakeCesium();
    const sky = buildSky(C as never, viewer().v as never, { ...OPTS, palette: paletteFor("day") });
    const cloudMat = materials.find((m) => "cloudShadow" in m.uniforms && m.type === "fabric")!;
    expect(cloudMat.uniforms.cloudShadow).toBe(0);
    const dayColour = cloudMat.uniforms.color as { css: string; alpha: number };
    expect(dayColour.alpha).toBe(CLOUD_ALPHA);
    expect(CLOUD_ALPHA).toBe(0.5); // see-through enough never to hide an overlay line
    sky.setPalette(paletteFor("dusk"));
    const duskColour = cloudMat.uniforms.color as { css: string; alpha: number };
    expect(duskColour.css).not.toBe(dayColour.css);
    expect(duskColour.alpha).toBe(CLOUD_ALPHA);
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
