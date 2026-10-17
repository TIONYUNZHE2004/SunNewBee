import type * as Cesium from "cesium";
import type { Palette } from "./palette";

/**
 * The decorative stylised ground (roads, pavements, kerbs, road marks, shore, parks, light pools)
 * rasterized into globe imagery: a tiled canvas ImageryProvider draws the decals that touch each
 * tile. Measured at the 2026-10-17 perf gate: the same decals as stencil ClassificationPrimitives
 * cost 15 -> 105 fps on an RTX 2050; imagery is drawn with the globe in its one pass.
 *
 * Imagery is part of the globe, so every overlay (route, path-status, gap and flood lines and
 * polygons, which classify the globe) still draws on top, and imagery is never pickable.
 * Display only: no access, flood or safety fact is read or implied.
 */

export type DecalPart =
  | "park"
  | "parkEdge"
  | "shore"
  | "pavement"
  | "road"
  | "kerb"
  | "roadMark"
  | "pool";

/** Bottom-to-top draw order within a tile. */
export const DECAL_ORDER: DecalPart[] = [
  "park",
  "parkEdge",
  "shore",
  "pavement",
  "road",
  "kerb",
  "roadMark",
  "pool",
];

export type Pt = [number, number];

export interface Decal {
  part: DecalPart;
  /** fill: rings (outer then holes) filled even-odd; line: rings[0] stroked `widthM` wide with
   * round caps and joins; dot: a disc of diameter `widthM` at rings[0][0]. */
  shape: "fill" | "line" | "dot";
  rings: Pt[][];
  widthM: number;
  /** west, south, east, north (degrees), including half the stroke width. */
  bbox: [number, number, number, number];
}

const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;
export const TILE_PX = 256;
/** Close-up crispness target: the deepest imagery level has at most this many metres per pixel. */
export const MAX_M_PER_PX = 0.2;
/** Strokes thinner than this many pixels are skipped (far tiles: kerbs and marks vanish). */
const MIN_STROKE_PX = 0.25;
/** Index cell size (degrees, ~220 m). */
const CELL_DEG = 0.002;

export function makeDecal(part: DecalPart, shape: Decal["shape"], rings: Pt[][], widthM: number) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  const padLat = widthM / 2 / M_PER_DEG;
  const padLon = padLat / Math.max(0.01, Math.cos(((s + n) / 2) * RAD));
  const decal: Decal = {
    part,
    shape,
    rings,
    widthM,
    bbox: [w - padLon, s - padLat, e + padLon, n + padLat],
  };
  return decal;
}

/** A uniform grid over the decals: a tile only touches decals whose bbox meets its cells. */
export interface DecalIndex {
  /** Decals in draw order (DECAL_ORDER, then input order). */
  decals: Decal[];
  /** Union of every decal bbox, or null when empty. */
  bounds: [number, number, number, number] | null;
  /** Decals whose bbox intersects the rectangle (degrees), in draw order, each once. */
  query(west: number, south: number, east: number, north: number): Decal[];
}

export function indexDecals(input: Decal[], cellDeg = CELL_DEG): DecalIndex {
  const rank = (p: DecalPart) => DECAL_ORDER.indexOf(p);
  const decals = input
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.part) - rank(b.d.part) || a.i - b.i)
    .map((x) => x.d);
  if (decals.length === 0) return { decals, bounds: null, query: () => [] };
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { bbox } of decals) {
    w = Math.min(w, bbox[0]);
    s = Math.min(s, bbox[1]);
    e = Math.max(e, bbox[2]);
    n = Math.max(n, bbox[3]);
  }
  const nx = Math.max(1, Math.ceil((e - w) / cellDeg));
  const ny = Math.max(1, Math.ceil((n - s) / cellDeg));
  const cx = (lon: number) => Math.min(nx - 1, Math.max(0, Math.floor((lon - w) / cellDeg)));
  const cy = (lat: number) => Math.min(ny - 1, Math.max(0, Math.floor((lat - s) / cellDeg)));
  const cells = new Map<number, number[]>();
  decals.forEach((d, i) => {
    const [x0, x1, y0, y1] = [cx(d.bbox[0]), cx(d.bbox[2]), cy(d.bbox[1]), cy(d.bbox[3])];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = x * ny + y;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
  });
  const seen = new Uint32Array(decals.length);
  let stamp = 0;
  return {
    decals,
    bounds: [w, s, e, n],
    query(west, south, east, north) {
      if (east < w || west > e || north < s || south > n) return [];
      stamp++;
      const hits: number[] = [];
      for (let x = cx(west); x <= cx(east); x++)
        for (let y = cy(south); y <= cy(north); y++) {
          for (const i of cells.get(x * ny + y) ?? []) {
            if (seen[i] === stamp) continue;
            seen[i] = stamp;
            const b = decals[i]!.bbox;
            if (b[2] < west || b[0] > east || b[3] < south || b[1] > north) continue;
            hits.push(i);
          }
        }
      hits.sort((a, b) => a - b);
      return hits.map((i) => decals[i]!);
    },
  };
}

/** The slice of CanvasRenderingContext2D the tile painter uses (a recorder in unit tests). */
export interface Paint2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(rule?: "evenodd" | "nonzero"): void;
  stroke(): void;
}

export interface TileRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Paint decals onto a `size` px square tile covering `rect` (degrees, geographic). Widths are in
 * metres; strokes thinner than MIN_STROKE_PX are skipped. `colourOf` returns null for parts not
 * drawn by this layer.
 */
export function paintTile(
  ctx: Paint2D,
  decals: Decal[],
  rect: TileRect,
  size: number,
  colourOf: (part: DecalPart) => string | null,
): number {
  const sx = size / (rect.east - rect.west);
  const sy = size / (rect.north - rect.south);
  const mPerPx = ((rect.north - rect.south) * M_PER_DEG) / size;
  const X = (lon: number) => (lon - rect.west) * sx;
  const Y = (lat: number) => (rect.north - lat) * sy;
  const trace = (ring: Pt[]) => {
    ring.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(X(x), Y(y));
      else ctx.lineTo(X(x), Y(y));
    });
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let drawn = 0;
  for (const d of decals) {
    const colour = colourOf(d.part);
    if (!colour) continue;
    if (d.shape === "fill") {
      const wPx = (d.bbox[2] - d.bbox[0]) * sx;
      const hPx = (d.bbox[3] - d.bbox[1]) * sy;
      if (wPx < 0.5 && hPx < 0.5) continue;
      ctx.beginPath();
      for (const ring of d.rings) {
        trace(ring);
        ctx.closePath();
      }
      ctx.fillStyle = colour;
      ctx.fill("evenodd");
      drawn++;
      continue;
    }
    const px = d.widthM / mPerPx;
    if (px < (d.shape === "dot" ? 0.5 : MIN_STROKE_PX)) continue;
    const ring = d.rings[0];
    if (!ring || ring.length === 0) continue;
    ctx.beginPath();
    if (d.shape === "dot") {
      ctx.arc(X(ring[0]![0]), Y(ring[0]![1]), px / 2, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    } else {
      trace(ring);
      ctx.lineWidth = px;
      ctx.strokeStyle = colour;
      ctx.stroke();
    }
    drawn++;
  }
  return drawn;
}

/** The deepest geographic level whose 256 px tiles have at most `mPerPx` metres per pixel. */
export function maxLevelFor(lat: number, mPerPx = MAX_M_PER_PX, tilePx = TILE_PX): number {
  const tileM = 180 * M_PER_DEG * Math.cos(lat * RAD); // level 0: two 180-degree tiles
  return Math.max(0, Math.ceil(Math.log2(tileM / (tilePx * mPerPx))));
}

/** The slice of Cesium the imagery layers use (a fake in unit tests). */
export type ImageryCesium = Pick<
  typeof Cesium,
  "ImageryLayer" | "GeographicTilingScheme" | "Event" | "Math"
>;

export interface LayerCollection {
  add(layer: Cesium.ImageryLayer, index?: number): void;
  remove(layer: Cesium.ImageryLayer, destroy?: boolean): boolean;
  indexOf(layer: Cesium.ImageryLayer): number;
  contains(layer: Cesium.ImageryLayer): boolean;
}

export interface ImageryScene {
  imageryLayers: LayerCollection;
  requestRender(): void;
}

export type MakeCanvas = (size: number) => { getContext(id: "2d"): unknown } | null;

const defaultCanvas: MakeCanvas = (size) => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
};

/**
 * A Cesium ImageryProvider (structural, Cesium 1.146) that paints `index` with `colourOf` per tile.
 * Geographic tiling, so Cesium never reprojects. It covers the whole globe: a layer bounded to the
 * decals would, as the bottom (base) layer, stretch its edge texels over every other globe tile,
 * which drew black wedges at the 2026-10-17 check. Tiles without decals get a 1 px empty canvas.
 */
export function decalProvider(
  C: ImageryCesium,
  index: DecalIndex,
  colourOf: (part: DecalPart) => string | null,
  makeCanvas: MakeCanvas = defaultCanvas,
): Cesium.ImageryProvider {
  const b = index.bounds ?? [0, 0, 0, 0];
  const tilingScheme = new C.GeographicTilingScheme();
  const maximumLevel = maxLevelFor((b[1] + b[3]) / 2);
  const deg = C.Math.toDegrees;
  const provider = {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: TILE_PX,
    tileHeight: TILE_PX,
    minimumLevel: 0,
    maximumLevel,
    tileDiscardPolicy: undefined,
    errorEvent: new C.Event(),
    credit: undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    getTileCredits: () => undefined,
    pickFeatures: () => undefined,
    requestImage(x: number, y: number, level: number) {
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      const rect = {
        west: deg(r.west),
        south: deg(r.south),
        east: deg(r.east),
        north: deg(r.north),
      };
      const decals = index.query(rect.west, rect.south, rect.east, rect.north);
      const canvas = makeCanvas(decals.length > 0 ? TILE_PX : 1);
      if (!canvas) return undefined;
      const ctx = canvas.getContext("2d") as Paint2D | null;
      if (ctx && decals.length > 0) paintTile(ctx, decals, rect, TILE_PX, colourOf);
      return Promise.resolve(canvas);
    },
  };
  return provider as unknown as Cesium.ImageryProvider;
}

/** The ground parts painted into the ground layer, with their palette colour. */
const GROUND_PARTS = [
  "park",
  "parkEdge",
  "shore",
  "pavement",
  "road",
  "kerb",
  "roadMark",
] as const satisfies readonly (DecalPart & keyof Palette)[];
const groundKey = (p: Palette) => GROUND_PARTS.map((k) => p[k]).join("|");

/** How long an instantly replaced ground layer stays on top while the new one's tiles load. */
export const INSTANT_SWAP_MS = 1500;

export interface GroundLayers {
  /** Crossfade towards `to`: call every fade frame with t in [0, 1]. A new target adds its layer
   * beneath the shown ones (fully opaque) and fades the shown ones out; the same target is a no-op.
   * t >= 1 removes the faded layers. An instant change (first call already at t = 1, e.g. reduced
   * motion) keeps the old layer on top for INSTANT_SWAP_MS while the new tiles load. */
  fade(to: Palette, t: number): void;
  /** The live layers, bottom to top (for tests and the perf overlay). */
  layers(): Cesium.ImageryLayer[];
  /** Remove and destroy every layer. Idempotent. */
  destroy(): void;
}

/**
 * The ground decal layers. One layer per palette (re-rasterizing per frame would stall): a theme
 * change adds the new palette's layer under the shown one and fades the shown one out, which is an
 * exact colour crossfade with no dip towards the bare ground. Layers are inserted at the lowest
 * ground index, so anything added later (the light pools) stays above.
 */
export function buildGroundLayers(
  C: ImageryCesium,
  scene: ImageryScene,
  index: DecalIndex,
  palette: Palette,
  {
    makeCanvas = defaultCanvas,
    setTimer = (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimer = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  }: {
    makeCanvas?: MakeCanvas;
    setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  } = {},
): GroundLayers {
  const layers = scene.imageryLayers;
  const make = (p: Palette, at: number) => {
    const colours = new Map<DecalPart, string>(GROUND_PARTS.map((k) => [k, p[k]]));
    const layer = new C.ImageryLayer(
      decalProvider(C, index, (part) => colours.get(part) ?? null, makeCanvas),
    );
    layers.add(layer, at);
    return layer;
  };
  let base: { layer: Cesium.ImageryLayer; key: string } | null =
    index.decals.length > 0 ? { layer: make(palette, 0), key: groundKey(palette) } : null;
  let fading: { layer: Cesium.ImageryLayer; from: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const drop = (list: { layer: Cesium.ImageryLayer }[]) => {
    for (const { layer } of list) if (layers.contains(layer)) layers.remove(layer, true);
  };
  const flush = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    drop(fading);
    fading = [];
  };

  return {
    fade(to, t) {
      if (!base) return;
      const key = groundKey(to);
      let fresh = false;
      if (key !== base.key) {
        if (timer !== null) flush(); // an instant swap still lingering: finish it first
        // Every shown layer fades out from where it is now.
        for (const f of fading) f.from = f.layer.alpha;
        fading.push({ layer: base.layer, from: base.layer.alpha });
        const at = Math.max(0, Math.min(...fading.map((f) => layers.indexOf(f.layer))));
        base = { layer: make(to, at), key };
        fresh = true;
      }
      if (fading.length === 0) return;
      if (t >= 1) {
        if (fresh) {
          // Nothing faded: keep the old layer on top until the new tiles are in, then drop it.
          timer = setTimer(() => {
            timer = null;
            drop(fading);
            fading = [];
            scene.requestRender();
          }, INSTANT_SWAP_MS);
        } else if (timer === null) {
          flush();
        }
      } else {
        for (const f of fading) f.layer.alpha = f.from * (1 - t);
      }
      scene.requestRender();
    },
    layers() {
      return [...(base ? [base.layer] : []), ...fading.map((f) => f.layer)];
    },
    destroy() {
      flush();
      if (base) drop([base]);
      base = null;
    },
  };
}

/** Light pool alpha at full glow (Night). */
export const POOL_ALPHA = 0.35;
/** Pool diameter (metres). */
export const POOL_DIAMETER_M = 10;
/** Pool colour used while the shown palette has no pools (Day keeps a black placeholder). */
const POOL_FALLBACK = "#ffb86b";

export interface PoolLayer {
  /** `p` is the palette shown this frame (alpha = POOL_ALPHA x p.glow, hidden at glow 0); `to` the
   * fade target, whose pool colour is used whenever it has pools. */
  setPalette(p: Palette, to: Palette): void;
  layer(): Cesium.ImageryLayer | null;
  destroy(): void;
}

/**
 * Warm light pools under the street lamps as their own imagery layer above the ground layers: one
 * colour per layer, alpha POOL_ALPHA x glow, hidden at Day. A pool-colour change swaps the layer in
 * place (it happens at the start of a fade, while the pools are faint).
 */
export function buildPoolLayer(
  C: ImageryCesium,
  scene: ImageryScene,
  lamps: { lon: number; lat: number }[],
  palette: Palette,
  makeCanvas: MakeCanvas = defaultCanvas,
): PoolLayer {
  const layers = scene.imageryLayers;
  const index = indexDecals(
    lamps.map((l) => makeDecal("pool", "dot", [[[l.lon, l.lat]]], POOL_DIAMETER_M)),
  );
  const colourFor = (p: Palette, fallback: string) => (p.glow > 0 ? p.lightPool : fallback);
  let colour = colourFor(palette, POOL_FALLBACK);
  const make = (css: string, at?: number) => {
    const layer = new C.ImageryLayer(
      decalProvider(C, index, (part) => (part === "pool" ? css : null), makeCanvas),
    );
    layers.add(layer, at);
    return layer;
  };
  const style = (l: Cesium.ImageryLayer, p: Palette) => {
    l.alpha = POOL_ALPHA * p.glow;
    l.show = p.glow > 0;
  };
  let current: Cesium.ImageryLayer | null = index.decals.length > 0 ? make(colour) : null;
  if (current) style(current, palette);
  return {
    setPalette(p, to) {
      if (!current) return;
      const want = colourFor(to, colour);
      if (want !== colour) {
        colour = want;
        const old = current;
        current = make(want, layers.indexOf(old) + 1);
        layers.remove(old, true);
      }
      style(current, p);
      scene.requestRender();
    },
    layer: () => current,
    destroy() {
      if (current && layers.contains(current)) layers.remove(current, true);
      current = null;
    },
  };
}
