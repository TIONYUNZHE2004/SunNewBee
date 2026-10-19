/**
 * Pure pixel maths for the acceptance harness (no browser, no Node APIs; unit-tested in vitest).
 * Images are straight RGBA bytes, row-major, as from `ImageData` or a decoded screenshot.
 * Coordinates are image pixels; captures run at deviceScaleFactor 1, so they equal CSS pixels.
 */

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Pixel rectangle; clipped to the image. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Restrict a measure to a box, to sample points (points win), and/or to a per-pixel mask
 * (`width * height` bytes, non-zero = included; e.g. the map area without UI chrome).
 */
export interface Selection {
  box?: Box;
  points?: readonly Point[];
  mask?: Uint8Array;
}

/** Pixels a mask includes. */
export function maskCount(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) if (v) n++;
  return n;
}

function checkMask(img: RGBAImage, mask: Uint8Array | undefined): void {
  if (mask && mask.length !== img.width * img.height)
    throw new Error(`mask has ${mask.length} entries, image ${img.width}x${img.height}`);
}

/** `#rrggbb` or `rrggbb` to [r, g, b] bytes. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [
    Number.parseInt(m[1] as string, 16),
    Number.parseInt(m[2] as string, 16),
    Number.parseInt(m[3] as string, 16),
  ];
}

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Relative luminance 0..1 of an sRGB byte triple (sRGB decoded, Rec. 709 weights). */
export function luminance(r: number, g: number, b: number): number {
  return (
    0.2126 * (LINEAR[r & 255] as number) +
    0.7152 * (LINEAR[g & 255] as number) +
    0.0722 * (LINEAR[b & 255] as number)
  );
}

function clipBox(img: RGBAImage, box: Box | undefined): Box {
  if (!box) return { x: 0, y: 0, w: img.width, h: img.height };
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(img.width, Math.floor(box.x + box.w));
  const y1 = Math.min(img.height, Math.floor(box.y + box.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Calls `f` with the byte offset of every selected pixel inside the image. */
function eachPixel(img: RGBAImage, sel: Selection, f: (o: number) => void): void {
  checkMask(img, sel.mask);
  const m = sel.mask;
  if (sel.points) {
    for (const p of sel.points) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      if (m && !m[y * img.width + x]) continue;
      f((y * img.width + x) * 4);
    }
    return;
  }
  const b = clipBox(img, sel.box);
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * img.width + x;
      if (m && !m[i]) continue;
      f(i * 4);
    }
}

export interface LumaHistogram {
  /** Counts per equal-width luminance bin over [0, 1]. */
  bins: number[];
  count: number;
  /** Mean relative luminance; NaN when nothing is selected. */
  mean: number;
}

/** Histogram of relative luminance over the selection (default: the whole image, 256 bins). */
export function lumaHistogram(
  img: RGBAImage,
  { bins = 256, ...sel }: Selection & { bins?: number } = {},
): LumaHistogram {
  const out = new Array<number>(bins).fill(0);
  let count = 0;
  let sum = 0;
  const d = img.data;
  eachPixel(img, sel, (o) => {
    const l = luminance(d[o] as number, d[o + 1] as number, d[o + 2] as number);
    const i = Math.min(bins - 1, Math.floor(l * bins));
    out[i] = (out[i] as number) + 1;
    count++;
    sum += l;
  });
  return { bins: out, count, mean: count > 0 ? sum / count : Number.NaN };
}

/**
 * Share (0..1) of the histogram's samples with luminance below `t`, at bin resolution (a bin counts
 * when its upper edge is ≤ t). 0 for an empty histogram.
 */
export function fractionBelow(h: LumaHistogram, t: number): number {
  if (h.count === 0) return 0;
  const n = h.bins.length;
  let below = 0;
  for (let i = 0; i < n; i++) if ((i + 1) / n <= t) below += h.bins[i] as number;
  return below / h.count;
}

/** Pixels within `tol` (0..255, every channel) of `hex` in the selection. */
export function countColour(img: RGBAImage, hex: string, tol: number, sel: Selection = {}): number {
  const [r, g, b] = parseHex(hex);
  const d = img.data;
  let n = 0;
  eachPixel(img, sel, (o) => {
    if (
      Math.abs((d[o] as number) - r) <= tol &&
      Math.abs((d[o + 1] as number) - g) <= tol &&
      Math.abs((d[o + 2] as number) - b) <= tol
    )
      n++;
  });
  return n;
}

/**
 * Variance of the 4-neighbour Laplacian of grey (0..255, Rec. 601 luma of the sRGB bytes) over the
 * interior of `box` (default the whole image), skipping pixels `mask` leaves out: a sharpness /
 * detail measure. NaN when no interior pixel is left (a box under 3×3, or all masked out).
 */
export function laplacianVariance(img: RGBAImage, box?: Box, mask?: Uint8Array): number {
  checkMask(img, mask);
  const b = clipBox(img, box);
  if (b.w < 3 || b.h < 3) return Number.NaN;
  const d = img.data;
  const w = img.width;
  const grey = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    return 0.299 * (d[o] as number) + 0.587 * (d[o + 1] as number) + 0.114 * (d[o + 2] as number);
  };
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = b.y + 1; y < b.y + b.h - 1; y++)
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      if (mask && !mask[y * w + x]) continue;
      const v = grey(x - 1, y) + grey(x + 1, y) + grey(x, y - 1) + grey(x, y + 1) - 4 * grey(x, y);
      n++;
      sum += v;
      sum2 += v * v;
    }
  if (n === 0) return Number.NaN;
  const mean = sum / n;
  return Math.max(0, sum2 / n - mean * mean);
}

/** HSV saturation 0..1 of an sRGB byte triple (0 for black and greys). */
export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Share (0..1) of the selected pixels whose saturation is at most `maxSat`: e.g. how much of a
 * road mask shows grey asphalt rather than green canopy drawn over it (decorative trees are not
 * pickable, so the pick mask alone cannot see them). `maxLuma` (relative luminance) also excludes
 * pale greys, e.g. bare ground showing where a road has not streamed in yet. 0 for an empty
 * selection.
 */
export function greyShare(
  img: RGBAImage,
  maxSat: number,
  sel: Selection = {},
  maxLuma = 1,
): number {
  const d = img.data;
  let n = 0;
  let grey = 0;
  eachPixel(img, sel, (o) => {
    n++;
    const r = d[o] as number;
    const g = d[o + 1] as number;
    const b = d[o + 2] as number;
    if (saturation(r, g, b) <= maxSat && luminance(r, g, b) <= maxLuma) grey++;
  });
  return n > 0 ? grey / n : 0;
}

/** CIE L*a*b* (D65) of an sRGB byte triple. */
export function labOf(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r & 255] as number;
  const lg = LINEAR[g & 255] as number;
  const lb = LINEAR[b & 255] as number;
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference (ΔE*ab) between two sRGB byte triples. */
export function deltaE(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = labOf(a[0], a[1], a[2]);
  const lb = labOf(b[0], b[1], b[2]);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}
