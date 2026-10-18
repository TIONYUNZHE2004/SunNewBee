import { describe, expect, it } from "vitest";
import {
  countColour,
  fractionBelow,
  laplacianVariance,
  lumaHistogram,
  luminance,
  parseHex,
  type RGBAImage,
} from "./pixels";

/** A w×h image filled by `f(x, y)` -> [r, g, b]. */
function img(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data } satisfies RGBAImage;
}

describe("parseHex", () => {
  it("reads #rrggbb and rrggbb", () => {
    expect(parseHex("#ff8000")).toEqual([255, 128, 0]);
    expect(parseHex("0a0b0c")).toEqual([10, 11, 12]);
  });
  it("rejects anything else", () => {
    expect(() => parseHex("#fff")).toThrow();
    expect(() => parseHex("zzzzzz")).toThrow();
  });
});

describe("luminance", () => {
  it("is 0 for black, 1 for white, and linear-light (sRGB decoded)", () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6);
    // sRGB 50% grey is about 21.4% linear light, not 50%.
    expect(luminance(128, 128, 128)).toBeCloseTo(0.2159, 3);
    // Rec. 709 weights: green dominates.
    expect(luminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
  });
});

describe("lumaHistogram", () => {
  it("bins every pixel and reports the mean", () => {
    const im = img(4, 2, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255]));
    const h = lumaHistogram(im, { bins: 10 });
    expect(h.count).toBe(8);
    expect(h.bins).toHaveLength(10);
    expect(h.bins[0]).toBe(4);
    expect(h.bins[9]).toBe(4);
    expect(h.mean).toBeCloseTo(0.5, 6);
  });
  it("restricts to a box and to sample points", () => {
    const im = img(4, 4, (x, y) => (x === 3 && y === 3 ? [255, 255, 255] : [0, 0, 0]));
    expect(lumaHistogram(im, { box: { x: 2, y: 2, w: 2, h: 2 } }).count).toBe(4);
    const pts = lumaHistogram(im, {
      points: [
        { x: 3, y: 3 },
        { x: 0, y: 0 },
        { x: 99, y: 0 }, // outside: ignored
      ],
    });
    expect(pts.count).toBe(2);
    expect(pts.mean).toBeCloseTo(0.5, 6);
  });
  it("an empty selection has count 0 and mean NaN", () => {
    const h = lumaHistogram(
      img(2, 2, () => [9, 9, 9]),
      { points: [] },
    );
    expect(h.count).toBe(0);
    expect(Number.isNaN(h.mean)).toBe(true);
  });
  it("fractionBelow counts the share of samples under a luminance", () => {
    const im = img(10, 1, (x) => (x < 3 ? [0, 0, 0] : [200, 200, 200]));
    const h = lumaHistogram(im);
    expect(fractionBelow(h, 0.03)).toBeCloseTo(0.3, 6);
    expect(fractionBelow(h, 1.01)).toBe(1);
    expect(fractionBelow(lumaHistogram(im, { points: [] }), 0.5)).toBe(0);
  });
});

describe("countColour", () => {
  it("counts pixels within a per-channel tolerance", () => {
    const im = img(
      5,
      1,
      (x) =>
        [[255, 128, 0] as const, [250, 130, 5], [200, 128, 0], [0, 0, 0], [255, 128, 0]][x] as [
          number,
          number,
          number,
        ],
    );
    expect(countColour(im, "#ff8000", 0)).toBe(2);
    expect(countColour(im, "#ff8000", 5)).toBe(3);
    expect(countColour(im, "#ff8000", 60)).toBe(4);
  });
  it("restricts to a box", () => {
    const im = img(4, 4, () => [10, 20, 30]);
    expect(countColour(im, "#0a141e", 0, { box: { x: 1, y: 1, w: 2, h: 3 } })).toBe(6);
  });
  it("clips a box that runs off the image", () => {
    const im = img(4, 4, () => [10, 20, 30]);
    expect(countColour(im, "#0a141e", 0, { box: { x: 3, y: 3, w: 10, h: 10 } })).toBe(1);
  });
});

describe("laplacianVariance", () => {
  it("is 0 on a flat image", () => {
    expect(laplacianVariance(img(8, 8, () => [90, 90, 90]))).toBe(0);
  });
  it("is high on a checkerboard and low on a smooth ramp", () => {
    const checker = img(16, 16, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
    const ramp = img(16, 16, (x) => [x * 16, x * 16, x * 16]);
    const vc = laplacianVariance(checker);
    const vr = laplacianVariance(ramp);
    expect(vc).toBeGreaterThan(1000);
    expect(vr).toBeLessThan(vc / 100);
  });
  it("only looks inside the box (interior pixels, so a 3×3 box has one sample)", () => {
    const im = img(10, 10, (x, y) => (x === 5 && y === 5 ? [255, 255, 255] : [0, 0, 0]));
    // Box far from the bright pixel: flat.
    expect(laplacianVariance(im, { x: 0, y: 0, w: 4, h: 4 })).toBe(0);
    // A single interior sample: variance 0 by definition.
    expect(laplacianVariance(im, { x: 4, y: 4, w: 3, h: 3 })).toBe(0);
    expect(laplacianVariance(im, { x: 3, y: 3, w: 5, h: 5 })).toBeGreaterThan(0);
  });
  it("a box under 3×3 has no interior: NaN", () => {
    expect(
      Number.isNaN(
        laplacianVariance(
          img(10, 10, () => [0, 0, 0]),
          { x: 0, y: 0, w: 2, h: 9 },
        ),
      ),
    ).toBe(true);
  });
});
