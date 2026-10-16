import { describe, expect, it } from "vitest";
import { homeView, shouldReframe, stylisedHomeView } from "./home";

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
  it("brings the camera closer to about 2500 m and keeps the centre", () => {
    const h = stylisedHomeView({ lon: 101.5, lat: 3.18, range_m: 6000 });
    expect(h).toEqual({ lon: 101.5, lat: 3.18, range_m: 2500 });
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
