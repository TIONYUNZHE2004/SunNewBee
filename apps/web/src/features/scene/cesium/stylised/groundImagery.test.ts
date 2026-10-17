import { describe, expect, it, vi } from "vitest";
import { type FakeProvider, fakeCesium, fakeLayers, recorder2d } from "./fakeCesium.test-util";
import {
  buildGroundLayers,
  buildPoolLayer,
  DECAL_ORDER,
  type Decal,
  decalProvider,
  type ImageryCesium,
  type ImageryScene,
  INSTANT_SWAP_MS,
  indexDecals,
  MAX_M_PER_PX,
  makeDecal,
  maxLevelFor,
  POOL_ALPHA,
  type Pt,
  paintTile,
  TILE_PX,
} from "./groundImagery";
import { paletteFor } from "./palette";

const LON = 101.5;
const LAT = 3.18;
const line = (lon: number, lat: number, dLon = 0.0005): Pt[] => [
  [lon, lat],
  [lon + dLon, lat],
];
/** The geographic tile (x, y) at `level` that holds (lon, lat), and its rectangle in degrees. */
function tileAt(level: number, lon = LON, lat = LAT) {
  const d = 180 / 2 ** level;
  const x = Math.floor((lon + 180) / d);
  const y = Math.floor((90 - lat) / d);
  return {
    x,
    y,
    level,
    rect: {
      west: -180 + x * d,
      east: -180 + (x + 1) * d,
      north: 90 - y * d,
      south: 90 - (y + 1) * d,
    },
  };
}

describe("makeDecal / indexDecals", () => {
  it("pads the bbox by half the stroke width", () => {
    const d = makeDecal("road", "line", [line(LON, LAT)], 10);
    expect(d.bbox[1]).toBeCloseTo(LAT - 5 / 111_320, 9);
    expect(d.bbox[3]).toBeCloseTo(LAT + 5 / 111_320, 9);
    expect(d.bbox[0]).toBeLessThan(LON);
    expect(d.bbox[2]).toBeGreaterThan(LON + 0.0005);
  });

  it("a query returns only nearby decals, each once, in draw order", () => {
    const far = makeDecal("road", "line", [line(LON + 0.05, LAT)], 6);
    const mark = makeDecal("roadMark", "line", [line(LON, LAT)], 0.25);
    // Spans many index cells: still returned once.
    const park = makeDecal(
      "park",
      "fill",
      [
        [
          [LON - 0.01, LAT - 0.01],
          [LON + 0.01, LAT - 0.01],
          [LON + 0.01, LAT + 0.01],
          [LON - 0.01, LAT - 0.01],
        ],
      ],
      0,
    );
    const road = makeDecal("road", "line", [line(LON, LAT)], 6);
    const idx = indexDecals([far, mark, park, road]);
    expect(idx.decals.map((d) => d.part)).toEqual(["park", "road", "road", "roadMark"]);
    const hits = idx.query(LON - 0.001, LAT - 0.001, LON + 0.001, LAT + 0.001);
    expect(hits).toEqual([park, road, mark]);
    expect(idx.query(LON - 0.001, LAT - 0.001, LON + 0.001, LAT + 0.001)).toEqual(hits);
    expect(idx.query(0, 0, 1, 1)).toEqual([]);
    expect(idx.query(-180, -90, 180, 90)).toHaveLength(4);
  });

  it("a decal straddling two tiles is returned for both", () => {
    const t = tileAt(17);
    const mid = t.rect.east; // the shared edge
    const road = makeDecal(
      "road",
      "line",
      [
        [
          [mid - 0.0002, LAT],
          [mid + 0.0002, LAT],
        ],
      ],
      6,
    );
    const idx = indexDecals([road]);
    const w = t.rect.east - t.rect.west;
    expect(idx.query(t.rect.west, t.rect.south, t.rect.east, t.rect.north)).toEqual([road]);
    expect(idx.query(t.rect.east, t.rect.south, t.rect.east + w, t.rect.north)).toEqual([road]);
  });

  it("an empty index has no bounds and answers nothing", () => {
    const idx = indexDecals([]);
    expect(idx.bounds).toBeNull();
    expect(idx.query(-180, -90, 180, 90)).toEqual([]);
  });

  it("pools draw last, above every ground part", () => {
    expect(DECAL_ORDER.at(-1)).toBe("pool");
    expect(DECAL_ORDER.slice(0, 2)).toEqual(["park", "parkEdge"]);
  });
});

describe("paintTile", () => {
  const colourOf = (part: string) => (part === "park" ? null : `#${part}`);

  it("strokes lines in metres, skips strokes thinner than a quarter pixel, fills even-odd", () => {
    const decals: Decal[] = [
      makeDecal("road", "line", [line(LON, LAT)], 10),
      makeDecal("kerb", "line", [line(LON, LAT)], 0.35),
      makeDecal(
        "parkEdge",
        "fill",
        [
          [
            [LON, LAT],
            [LON + 0.0005, LAT],
            [LON + 0.0005, LAT + 0.0005],
          ],
        ],
        0,
      ),
    ];
    const near = tileAt(17); // ~0.6 m per pixel
    const ctx = recorder2d();
    const mPerPx = ((near.rect.north - near.rect.south) * 111_320) / TILE_PX;
    expect(paintTile(ctx, decals, near.rect, TILE_PX, colourOf)).toBe(3);
    expect(ctx.ops).toContain(`stroke:#road@${(10 / mPerPx).toFixed(2)}`);
    expect(ctx.ops).toContain(`stroke:#kerb@${(0.35 / mPerPx).toFixed(2)}`);
    expect(ctx.ops).toContain("fill:#parkEdge:evenodd");
    expect([ctx.lineCap, ctx.lineJoin]).toEqual(["round", "round"]);

    const far = tileAt(12); // ~19 m per pixel: the kerb is far below a pixel
    const ctx2 = recorder2d();
    expect(paintTile(ctx2, decals, far.rect, TILE_PX, colourOf)).toBe(2); // road + fill
    expect(ctx2.ops.some((o) => o.startsWith("stroke:#kerb"))).toBe(false);
  });

  it("parts without a colour are not drawn; dots are discs", () => {
    const park = makeDecal(
      "park",
      "fill",
      [
        [
          [LON, LAT],
          [LON + 0.001, LAT],
          [LON, LAT + 0.001],
        ],
      ],
      0,
    );
    const pool = makeDecal("pool", "dot", [[[LON, LAT]]], 10);
    const t = tileAt(17);
    const ctx = recorder2d();
    expect(paintTile(ctx, [park, pool], t.rect, TILE_PX, colourOf)).toBe(1);
    expect(ctx.ops.find((o) => o.startsWith("arc"))).toBeDefined();
    expect(ctx.ops).toContain("fill:#pool");
  });

  it("maps lon/lat to tile pixels (west edge x=0, north edge y=0)", () => {
    const t = tileAt(17);
    const d: Decal = makeDecal(
      "road",
      "line",
      [
        [
          [t.rect.west, t.rect.north],
          [t.rect.east, t.rect.south],
        ],
      ],
      3,
    );
    const ctx = recorder2d();
    paintTile(ctx, [d], t.rect, TILE_PX, colourOf);
    expect(ctx.ops).toContain("M0.0,0.0");
    expect(ctx.ops).toContain(`L${TILE_PX}.0,${TILE_PX}.0`);
  });
});

describe("decalProvider", () => {
  it("deepest level is at most 0.2 m per pixel near the equator", () => {
    const level = maxLevelFor(LAT);
    const mPerPx = (l: number) =>
      ((180 / 2 ** l) * 111_320 * Math.cos(LAT * (Math.PI / 180))) / 256;
    expect(mPerPx(level)).toBeLessThanOrEqual(MAX_M_PER_PX);
    expect(mPerPx(level - 1)).toBeGreaterThan(MAX_M_PER_PX);
  });

  it("paints only the decals of the requested tile onto a fresh canvas", async () => {
    const { C } = fakeCesium();
    const near = makeDecal("road", "line", [line(LON, LAT)], 6);
    const away = makeDecal("road", "line", [line(LON + 0.2, LAT)], 6);
    const idx = indexDecals([near, away]);
    const query = vi.spyOn(idx, "query");
    const ctxs: ReturnType<typeof recorder2d>[] = [];
    const p = decalProvider(
      C as unknown as ImageryCesium,
      idx,
      () => "#123",
      () => {
        const ctx = recorder2d();
        ctxs.push(ctx);
        return { getContext: () => ctx };
      },
    ) as unknown as FakeProvider;
    expect(p.hasAlphaChannel).toBe(true);
    expect(p.maximumLevel).toBe(maxLevelFor((idx.bounds![1] + idx.bounds![3]) / 2));
    // Whole globe (never a bounded base layer that stretches its edge texels).
    expect(p.rectangle).toBe(
      (p as unknown as { tilingScheme: { rectangle: unknown } }).tilingScheme.rectangle,
    );
    const t = tileAt(16);
    const canvas = await p.requestImage(t.x, t.y, t.level);
    expect(canvas).toBeDefined();
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0]!.ops.filter((o) => o.startsWith("stroke"))).toHaveLength(1);
    const [w, s, e, n] = query.mock.calls[0]!;
    expect(w).toBeCloseTo(t.rect.west, 9);
    expect(n).toBeCloseTo(t.rect.north, 9);
    expect([s, e].every(Number.isFinite)).toBe(true);
  });

  it("a tile with no decals gets a 1 px empty canvas", async () => {
    const { C } = fakeCesium();
    const sizes: number[] = [];
    const p = decalProvider(
      C as unknown as ImageryCesium,
      indexDecals([makeDecal("road", "line", [line(LON, LAT)], 6)]),
      () => "#123",
      (n) => {
        sizes.push(n);
        return { getContext: () => recorder2d() };
      },
    ) as unknown as FakeProvider;
    await p.requestImage(0, 0, 3); // far from Elmina
    expect(sizes).toEqual([1]);
  });

  it("no canvas (no DOM) -> no image, no throw", () => {
    const { C } = fakeCesium();
    const p = decalProvider(
      C as unknown as ImageryCesium,
      indexDecals([makeDecal("road", "line", [line(LON, LAT)], 6)]),
      () => "#123",
      () => null,
    ) as unknown as FakeProvider;
    expect(p.requestImage(0, 0, 0)).toBeUndefined();
  });
});

type Layer = { alpha: number; show: boolean; provider: FakeProvider };

function groundSetup(timers = false) {
  const f = fakeCesium();
  const layers = fakeLayers<Layer>();
  const requestRender = vi.fn();
  const scene = { imageryLayers: layers, requestRender } as unknown as ImageryScene;
  const pending: { cb: () => void; ms: number }[] = [];
  const cleared: number[] = [];
  const g = buildGroundLayers(
    f.C as unknown as ImageryCesium,
    scene,
    indexDecals([makeDecal("road", "line", [line(LON, LAT)], 6)]),
    paletteFor("night"),
    {
      makeCanvas: canvasOf,
      ...(timers
        ? {
            setTimer: (cb: () => void, ms: number) => {
              pending.push({ cb, ms });
              return pending.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: (id: ReturnType<typeof setTimeout>) => {
              cleared.push(id as unknown as number);
            },
          }
        : {}),
    },
  );
  return { ...f, layers, requestRender, g, pending, cleared };
}

/** A canvas with one recording context. */
const canvasOf = () => {
  const ctx = recorder2d();
  return { getContext: () => ctx };
};

/** The ops a layer's provider records for the tile around the test roads. */
async function tileOps(layer: Layer, level = 16) {
  const t = tileAt(level);
  const img = (await layer.provider.requestImage(t.x, t.y, t.level)) as {
    getContext(): ReturnType<typeof recorder2d>;
  };
  return img.getContext().ops;
}

describe("buildGroundLayers", () => {
  it("adds one layer at the bottom; the same palette is a no-op", () => {
    const { layers, g, imageryLayers } = groundSetup();
    expect(imageryLayers).toHaveLength(1);
    expect(layers.add).toHaveBeenCalledWith(imageryLayers[0], 0);
    g.fade(paletteFor("night"), 0);
    g.fade(paletteFor("night"), 1);
    expect(imageryLayers).toHaveLength(1);
    expect(layers.list).toEqual(imageryLayers);
  });

  it("a new palette goes underneath, opaque; the shown layer fades out, then is removed", () => {
    const { layers, g, imageryLayers, requestRender } = groundSetup();
    const night = imageryLayers[0]!;
    g.fade(paletteFor("day"), 0);
    const day = imageryLayers[1]!;
    expect(layers.list).toEqual([day, night]); // new under old
    expect([day.alpha, night.alpha]).toEqual([1, 1]);
    g.fade(paletteFor("day"), 0.25);
    expect(night.alpha).toBeCloseTo(0.75, 9);
    expect(day.alpha).toBe(1);
    g.fade(paletteFor("day"), 1);
    expect(layers.list).toEqual([day]);
    expect(layers.remove).toHaveBeenCalledWith(night, true);
    expect(g.layers()).toEqual([day]);
    expect(requestRender).toHaveBeenCalled();
  });

  it("each palette layer paints with its own colours", async () => {
    const { g, imageryLayers } = groundSetup();
    g.fade(paletteFor("day"), 0);
    const [night, day] = imageryLayers as Layer[];
    const nightOps = await tileOps(night!);
    const dayOps = await tileOps(day!);
    expect(nightOps.find((o) => o.startsWith("stroke"))).toContain(paletteFor("night").road);
    expect(dayOps.find((o) => o.startsWith("stroke"))).toContain(paletteFor("day").road);
  });

  it("a change mid-fade fades every shown layer out from where it is", () => {
    const { layers, g, imageryLayers } = groundSetup();
    const night = imageryLayers[0]!;
    g.fade(paletteFor("day"), 0);
    g.fade(paletteFor("day"), 0.5);
    const day = imageryLayers[1]!;
    g.fade(paletteFor("dusk"), 0);
    const dusk = imageryLayers[2]!;
    expect(layers.list).toEqual([dusk, day, night]);
    g.fade(paletteFor("dusk"), 0.5);
    expect(night.alpha).toBeCloseTo(0.25, 9);
    expect(day.alpha).toBeCloseTo(0.5, 9);
    g.fade(paletteFor("dusk"), 1);
    expect(layers.list).toEqual([dusk]);
  });

  it("an instant change (reduced motion) keeps the old layer on top until the new tiles load", () => {
    const { layers, g, imageryLayers, pending } = groundSetup(true);
    const night = imageryLayers[0]!;
    g.fade(paletteFor("day"), 1);
    const day = imageryLayers[1]!;
    expect(layers.list).toEqual([day, night]);
    expect(night.alpha).toBe(1);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.ms).toBe(INSTANT_SWAP_MS);
    pending[0]!.cb();
    expect(layers.list).toEqual([day]);
  });

  it("a new palette while an instant swap is pending finishes that swap first", () => {
    const { layers, g, imageryLayers, pending, cleared } = groundSetup(true);
    g.fade(paletteFor("day"), 1); // instant: night lingers on top, timer pending
    const day = imageryLayers[1]!;
    g.fade(paletteFor("dusk"), 0);
    const dusk = imageryLayers[2]!;
    expect(cleared).toEqual([1]); // the pending timer was cancelled ...
    expect(layers.list).toEqual([dusk, day]); // ... and night dropped at once
    expect(day.alpha).toBe(1);
    g.fade(paletteFor("dusk"), 1);
    expect(layers.list).toEqual([dusk]);
    expect(pending).toHaveLength(1);
  });

  it("destroy cancels a pending instant-swap timer", () => {
    const { layers, g, pending, cleared } = groundSetup(true);
    g.fade(paletteFor("day"), 1);
    expect(pending).toHaveLength(1);
    g.destroy();
    expect(cleared).toEqual([1]);
    expect(layers.list).toEqual([]);
  });

  it("destroy removes every layer and is idempotent; no decals -> no layer", () => {
    const { layers, g } = groundSetup();
    g.fade(paletteFor("day"), 0.5);
    g.destroy();
    g.destroy();
    expect(layers.list).toEqual([]);
    expect(() => g.fade(paletteFor("night"), 1)).not.toThrow();
    const f = fakeCesium();
    const empty = buildGroundLayers(
      f.C as unknown as ImageryCesium,
      { imageryLayers: fakeLayers(), requestRender: vi.fn() } as unknown as ImageryScene,
      indexDecals([]),
      paletteFor("day"),
    );
    expect(f.imageryLayers).toHaveLength(0);
    expect(empty.layers()).toEqual([]);
  });
});

describe("buildPoolLayer", () => {
  function poolSetup(theme: "day" | "dusk" | "night") {
    const f = fakeCesium();
    const layers = fakeLayers<Layer>();
    const requestRender = vi.fn();
    const scene = { imageryLayers: layers, requestRender } as unknown as ImageryScene;
    const pools = buildPoolLayer(
      f.C as unknown as ImageryCesium,
      scene,
      [{ lon: LON, lat: LAT }],
      paletteFor(theme),
      canvasOf,
      {
        setTimer: (cb: () => void, ms: number) => {
          pending.push({ cb, ms, live: true });
          return pending.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: (id) => {
          pending[(id as unknown as number) - 1]!.live = false;
        },
      },
    );
    const pending: { cb: () => void; ms: number; live: boolean }[] = [];
    const fire = () => {
      for (const t of pending.splice(0)) if (t.live) t.cb();
    };
    return { ...f, layers, pools, pending, fire };
  }

  it("alpha follows glow and the layer hides by day", () => {
    const { pools, imageryLayers } = poolSetup("night");
    const l = imageryLayers[0]!;
    expect(l.alpha).toBeCloseTo(POOL_ALPHA * paletteFor("night").glow, 9);
    expect(l.show).toBe(true);
    pools.setPalette(paletteFor("day"), paletteFor("day"));
    expect(l.show).toBe(false);
    expect(l.alpha).toBe(0);
  });

  it("a new pool colour loads invisibly under the shown layer, then swaps (no flash)", () => {
    const { pools, imageryLayers, layers, pending, fire } = poolSetup("night");
    const ground = { alpha: 1, show: true } as Layer;
    layers.list.unshift(ground);
    const night = imageryLayers[0]!;
    const dusk = paletteFor("dusk");
    pools.setPalette(paletteFor("night"), dusk); // fade start: target colour, shown alpha
    const next = imageryLayers[1]!;
    expect(layers.list).toEqual([ground, next, night]); // old still drawn on top
    expect(next.alpha).toBe(0);
    expect(night.alpha).toBeCloseTo(POOL_ALPHA * paletteFor("night").glow, 9);
    expect(pending[0]!.ms).toBe(INSTANT_SWAP_MS);
    pools.setPalette(dusk, dusk); // fade goes on: the shown layer follows
    expect(night.alpha).toBeCloseTo(POOL_ALPHA * dusk.glow, 9);
    fire();
    expect(layers.list).toEqual([ground, next]);
    expect(layers.remove).toHaveBeenCalledWith(night, true);
    expect(next.alpha).toBeCloseTo(POOL_ALPHA * dusk.glow, 9);
    pools.setPalette(dusk, dusk);
    expect(imageryLayers).toHaveLength(2); // same colour: no new layer
  });

  it("returning to the shown colour while a swap is loading just drops the loading layer", () => {
    const { pools, imageryLayers, layers, pending, fire } = poolSetup("night");
    const night = imageryLayers[0]!;
    pools.setPalette(paletteFor("night"), paletteFor("dusk"));
    const dusk = imageryLayers[1]!;
    pools.setPalette(paletteFor("night"), paletteFor("night"));
    expect(imageryLayers).toHaveLength(2); // no second layer of the shown colour
    expect(layers.list).toEqual([night]);
    expect(layers.remove).toHaveBeenCalledWith(dusk, true);
    expect(pending[0]!.live).toBe(false); // the swap is cancelled
    fire();
    expect(layers.list).toEqual([night]);
    expect(night.alpha).toBeCloseTo(POOL_ALPHA * paletteFor("night").glow, 9);
    // A later change away still loads a fresh layer and swaps it in.
    pools.setPalette(paletteFor("night"), paletteFor("dusk"));
    const again = imageryLayers[2]!;
    expect(layers.list).toEqual([again, night]);
    fire();
    expect(layers.list).toEqual([again]);
  });

  it("built by day it keeps a warm colour (never Day's black placeholder) and fades in", async () => {
    const { pools, imageryLayers, fire } = poolSetup("day");
    expect(imageryLayers[0]!.show).toBe(false);
    pools.setPalette(paletteFor("day"), paletteFor("dusk"));
    fire();
    const ops = await tileOps(imageryLayers.at(-1)!, 17);
    expect(ops).toContain(`fill:${paletteFor("dusk").lightPool}`);
  });

  it("destroy removes the layer (and a loading one, cancelling its swap), idempotent", () => {
    const { pools, layers, pending } = poolSetup("night");
    pools.setPalette(paletteFor("night"), paletteFor("dusk"));
    pools.destroy();
    expect(pending[0]!.live).toBe(false);
    pools.destroy();
    expect(layers.list).toEqual([]);
    expect(() => pools.setPalette(paletteFor("day"), paletteFor("day"))).not.toThrow();
  });
});
