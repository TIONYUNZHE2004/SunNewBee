import { describe, expect, it } from "vitest";
import {
  fovForVertical,
  framingFor,
  homeView,
  STYLISED_RANGE_M,
  shouldReframe,
  stylisedHomeView,
} from "./home";

const base = { center: [101.5, 3.2], scene: {} } as Parameters<typeof homeView>[0];

describe("homeView", () => {
  it("uses scene.home", () => {
    const site = { center: [1, 2], scene: { home: { lon: 101.6, lat: 3.3, range_m: 2500 } } };
    expect(homeView(site as never)).toEqual({ lon: 101.6, lat: 3.3, range_m: 2500 });
  });
  it("defaults range when home lacks it", () => {
    const site = { center: [1, 2], scene: { home: { lon: 101.6, lat: 3.3 } } };
    expect(homeView(site as never)).toEqual({ lon: 101.6, lat: 3.3, range_m: 6000 });
  });
  it("falls back to center with 6000 m", () => {
    expect(homeView(base)).toEqual({ lon: 101.5, lat: 3.2, range_m: 6000 });
  });
  it("falls back to constants when site is missing or center unusable", () => {
    const c = { lon: 101.5099, lat: 3.1813, range_m: 6000 };
    expect(homeView(undefined)).toEqual(c);
    expect(homeView({ center: [], scene: {} } as never)).toEqual(c);
  });
});

describe("shouldReframe", () => {
  it("only when untouched and not yet re-framed", () => {
    expect(shouldReframe({ moved: false, reframed: false })).toBe(true);
    expect(shouldReframe({ moved: true, reframed: false })).toBe(false);
    expect(shouldReframe({ moved: false, reframed: true })).toBe(false);
  });
  it("a style change after an assistant fly-to (moved) or once framed never reframes", () => {
    // The scene marks `moved` when camera.fly_to / place.focus is applied; switching style re-runs
    // the framing decision with the same flags.
    expect(shouldReframe({ moved: true, reframed: false })).toBe(false);
    expect(shouldReframe({ moved: false, reframed: true })).toBe(false);
  });
});

describe("stylisedHomeView", () => {
  it("brings the camera closer to about 1200 m and keeps the centre", () => {
    const h = stylisedHomeView({ lon: 101.5, lat: 3.18, range_m: 6000 });
    expect(h).toEqual({ lon: 101.5, lat: 3.18, range_m: 1200 });
  });
  it("never zooms further out than the site's own closer range", () => {
    expect(stylisedHomeView({ lon: 1, lat: 2, range_m: 1200 }).range_m).toBe(1200);
  });
  it("does not mutate its input", () => {
    const h = { lon: 1, lat: 2, range_m: 6000 };
    stylisedHomeView(h);
    expect(h.range_m).toBe(6000);
  });
});

describe("framingFor", () => {
  const home = { lon: 101.5, lat: 3.18, range_m: 6000 };
  it("stylised opens close and oblique", () => {
    expect(framingFor("stylised", home)).toEqual({
      ...home,
      range_m: STYLISED_RANGE_M,
      pitchDeg: -35,
    });
    expect(STYLISED_RANGE_M).toBe(1200);
  });
  it("realistic keeps the site's range at -45 degrees", () => {
    expect(framingFor("realistic", home)).toEqual({ ...home, pitchDeg: -45 });
  });
  it("never zooms further out than the site's own home", () => {
    expect(framingFor("stylised", { ...home, range_m: 800 }).range_m).toBe(800);
  });
});

it("fovForVertical converts to Cesium's horizontal fov on landscape canvases", () => {
  expect((fovForVertical(30, 1600, 900) * 180) / Math.PI).toBeCloseTo(50.9, 1);
  expect((fovForVertical(30, 900, 1600) * 180) / Math.PI).toBeCloseTo(30, 6);
});
