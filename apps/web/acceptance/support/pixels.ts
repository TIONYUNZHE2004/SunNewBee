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

/** Restrict a measure to a box, or to sample points (points win when both are given). */
export interface Selection {
  box?: Box;
  points?: readonly Point[];
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
  if (sel.points) {
    for (const p of sel.points) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      f((y * img.width + x) * 4);
    }
    return;
  }
  const b = clipBox(img, sel.box);
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) f((y * img.width + x) * 4);
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
 * interior of `box` (default the whole image): a sharpness / detail measure. NaN when the box has
 * no interior pixel (under 3×3).
 */
export function laplacianVariance(img: RGBAImage, box?: Box): number {
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
      const v = grey(x - 1, y) + grey(x + 1, y) + grey(x, y - 1) + grey(x, y + 1) - 4 * grey(x, y);
      n++;
      sum += v;
      sum2 += v * v;
    }
  const mean = sum / n;
  return Math.max(0, sum2 / n - mean * mean);
}
