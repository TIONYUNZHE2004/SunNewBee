import { describe, expect, it, vi } from "vitest";
import { setupRealistic } from "./realistic";
import { applyStylisedLook } from "./stylised/StylisedCity";

const flush = () => new Promise((r) => setTimeout(r, 0));

function event() {
  const ls = new Set<() => void>();
  return {
    ls,
    addEventListener: (f: () => void) => {
      ls.add(f);
      return () => ls.delete(f);
    },
  };
}

interface FakeTileset {
  destroyed: boolean;
  destroy: () => void;
  loadProgress: ReturnType<typeof event>;
  allTilesLoaded: ReturnType<typeof event>;
  tileFailed: ReturnType<typeof event>;
}

const color = (css: string) => ({ css, clone: () => color(css) });

/** Just enough Viewer + Cesium to run the realistic setup and the stylised look with no WebGL. */
function fakes() {
  const prims: unknown[] = [];
  const layers: { show: boolean; destroyed: boolean; isDestroyed: () => boolean }[] = [];
  const tilesets: FakeTileset[] = [];
  const terrains: unknown[] = [];
  function tileset(): FakeTileset {
    const t: FakeTileset = {
      destroyed: false,
      destroy: vi.fn(() => {
        t.destroyed = true;
      }),
      loadProgress: event(),
      allTilesLoaded: event(),
      tileFailed: event(),
    };
    tilesets.push(t);
    return t;
  }
  const imageryLayers = {
    get length() {
      return layers.length;
    },
    get: (i: number) => layers[i],
    add: vi.fn((l: (typeof layers)[number], i: number) => layers.splice(i, 0, l)),
    remove: vi.fn((l: (typeof layers)[number], destroy: boolean) => {
      layers.splice(layers.indexOf(l), 1);
      if (destroy) l.destroyed = true;
    }),
  };
  const scene = {
    primitives: {
      add: vi.fn((p: unknown) => prims.push(p)),
      remove: vi.fn((p: { destroy: () => void }) => {
        prims.splice(prims.indexOf(p), 1);
        p.destroy();
      }),
    },
    globe: {
      show: true,
      baseColor: color("#000"),
      showGroundAtmosphere: true,
      enableLighting: true,
    },
    imageryLayers,
    backgroundColor: color("#111"),
    fog: { density: 0.0002 },
    skyAtmosphere: { show: true },
    skyBox: { show: true },
    sun: { show: true },
    moon: { show: true },
    light: "sun-light",
    setTerrain: vi.fn((t: unknown) => terrains.push(t)),
    requestRender: vi.fn(),
  };
  const viewer = { scene, imageryLayers, isDestroyed: () => false };
  let resolveTiles: (t: unknown) => void = () => {};
  const C = {
    Ion: { defaultAccessToken: "" },
    ImageryLayer: {
      fromWorldImagery: vi.fn(() => {
        const l = { show: true, destroyed: false, isDestroyed: () => l.destroyed };
        return l;
      }),
    },
    Terrain: Object.assign(
      class {
        constructor(public p: unknown) {}
      },
      { fromWorldTerrain: vi.fn(() => "world-terrain") },
    ),
    EllipsoidTerrainProvider: class {},
    createGooglePhotorealistic3DTileset: vi.fn(
      () =>
        new Promise((r) => {
          resolveTiles = r;
        }),
    ),
    createOsmBuildingsAsync: vi.fn(async () => tileset()),
  };
  return {
    C,
    viewer,
    scene,
    prims,
    layers,
    tilesets,
    terrains,
    resolve: () => resolveTiles(tileset()),
  };
}

const run = (f: ReturnType<typeof fakes>, env: { googleKey: string; cesiumToken: string }) =>
  setupRealistic(f.C as never, f.viewer as never, env, { onTilesFailed: vi.fn() });

describe("setupRealistic", () => {
  it("does nothing (no Ion, no tiles) without a key", () => {
    const f = fakes();
    run(f, { googleKey: "", cesiumToken: "" })();
    expect(f.C.ImageryLayer.fromWorldImagery).not.toHaveBeenCalled();
    expect(f.C.createGooglePhotorealistic3DTileset).not.toHaveBeenCalled();
    expect(f.C.createOsmBuildingsAsync).not.toHaveBeenCalled();
  });

  it("adds imagery and Google tiles, and its cleanup removes every one of them", async () => {
    const f = fakes();
    const stop = run(f, { googleKey: "g", cesiumToken: "" });
    expect(f.layers).toHaveLength(1);
    f.resolve();
    await flush();
    expect(f.prims).toHaveLength(1);
    expect(f.scene.globe.show).toBe(false);
    const t = f.tilesets[0];
    expect(t?.loadProgress.ls.size).toBe(1);
    stop();
    expect(f.prims).toHaveLength(0);
    expect(t?.destroyed).toBe(true);
    expect(t?.loadProgress.ls.size).toBe(0);
    expect(t?.tileFailed.ls.size).toBe(0);
    expect(f.layers).toHaveLength(0);
    expect(f.scene.globe.show).toBe(true);
  });

  it("a tileset that resolves after cleanup is destroyed, never added", async () => {
    const f = fakes();
    const stop = run(f, { googleKey: "g", cesiumToken: "" });
    stop();
    f.resolve();
    await flush();
    expect(f.prims).toHaveLength(0);
    expect(f.tilesets[0]?.destroyed).toBe(true);
    expect(f.scene.globe.show).toBe(true);
  });

  it("Ion: world terrain on, then back to the flat ellipsoid on cleanup", async () => {
    const f = fakes();
    const stop = run(f, { googleKey: "", cesiumToken: "c" });
    await flush();
    expect(f.terrains).toEqual(["world-terrain"]);
    expect(f.prims).toHaveLength(1);
    stop();
    expect(f.terrains).toHaveLength(2);
    expect(f.terrains[1]).toBeInstanceOf(f.C.Terrain);
    expect(f.prims).toHaveLength(0);
  });

  it("Realistic -> Stylised -> Realistic leaves no stale primitive, layer or hidden sky", async () => {
    const f = fakes();
    const env = { googleKey: "g", cesiumToken: "" };
    let stop = run(f, env);
    f.resolve();
    await flush();
    stop();
    const restore = applyStylisedLook(f.viewer as never);
    expect(f.prims).toHaveLength(0);
    expect(f.layers).toHaveLength(0);
    expect(f.scene.sun.show).toBe(false);
    expect(f.scene.light).toBe("sun-light");
    restore();
    expect(f.scene.sun.show).toBe(true);
    expect(f.scene.skyAtmosphere.show).toBe(true);
    expect(f.scene.globe.showGroundAtmosphere).toBe(true);
    stop = run(f, env);
    f.resolve();
    await flush();
    expect(f.prims).toHaveLength(1);
    expect(f.layers).toHaveLength(1);
    stop();
    expect(f.prims).toHaveLength(0);
    expect(f.layers).toHaveLength(0);
  });
});
