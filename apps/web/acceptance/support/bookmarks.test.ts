import { describe, expect, it } from "vitest";
import { sunPinRequested } from "../../src/features/scene/three/sunClock";
import {
  ACCEPTANCE_BOOKMARKS,
  BOOKMARK_NAMES,
  bookmarkUrl,
  SOFTWARE_GPU,
  STREET_CHECK,
} from "./bookmarks";

describe("acceptance bookmarks (spec §3: the five evaluation bookmarks)", () => {
  it("has exactly the five poses, in spec order", () => {
    expect(BOOKMARK_NAMES).toEqual(["overview", "hero-mid", "street", "link-low", "night-mid"]);
    expect(Object.keys(ACCEPTANCE_BOOKMARKS).sort()).toEqual([...BOOKMARK_NAMES].sort());
  });
  it("the low-angle bookmark is at pitch -10 and the night one is mid-range at night", () => {
    expect(ACCEPTANCE_BOOKMARKS["link-low"].pitchDeg).toBe(-10);
    expect(ACCEPTANCE_BOOKMARKS["night-mid"].theme).toBe("night");
    expect(ACCEPTANCE_BOOKMARKS["night-mid"].rangeM).toBe(ACCEPTANCE_BOOKMARKS["hero-mid"].rangeM);
    for (const n of BOOKMARK_NAMES.filter((n) => n !== "night-mid"))
      expect(ACCEPTANCE_BOOKMARKS[n].theme).toBe("day");
  });
  it("ranges go overview > mid > street", () => {
    const b = ACCEPTANCE_BOOKMARKS;
    expect(b.overview.rangeM).toBeGreaterThan(b["hero-mid"].rangeM);
    expect(b["hero-mid"].rangeM).toBeGreaterThan(b.street.rangeM);
  });
  it("every pose lies inside the Elmina site bbox", () => {
    for (const n of BOOKMARK_NAMES) {
      const [lon, lat] = ACCEPTANCE_BOOKMARKS[n].centre;
      expect(lon).toBeGreaterThan(101.46);
      expect(lon).toBeLessThan(101.53);
      expect(lat).toBeGreaterThan(3.15);
      expect(lat).toBeLessThan(3.24);
    }
  });
  it("the load URL carries the explicit acceptance flag and pins the sun (B-T4 ruling)", () => {
    expect(bookmarkUrl()).toBe("/?acceptance=1&sun=pinned");
    expect(sunPinRequested(bookmarkUrl().slice(1))).toBe(true);
  });
  it("the street pose is at street level (eye height under 5 m) and has a road check", () => {
    const s = ACCEPTANCE_BOOKMARKS.street;
    const eye = s.rangeM * Math.sin((-s.pitchDeg * Math.PI) / 180);
    expect(eye).toBeLessThan(5);
    expect(STREET_CHECK.minRoadShare).toBeGreaterThan(0);
    expect(STREET_CHECK.minAsphalt).toBeGreaterThan(0.5);
  });
  it("software rasterisers are recognised", () => {
    for (const r of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ])
      expect(r).toMatch(SOFTWARE_GPU);
    expect(
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 (0x000025AD) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ).not.toMatch(SOFTWARE_GPU);
  });
});
