import { describe, expect, it } from "vitest";
import {
  BOOKMARKS,
  bookmarkFromSearch,
  DEFAULT_BOOKMARK,
  HERO_CENTRE,
  HERO_RADIUS_M,
} from "./bookmarks";

describe("bookmarks", () => {
  it("parses the bookmark query param", () => {
    expect(bookmarkFromSearch("?bookmark=hero-near")).toBe("hero-near");
    expect(bookmarkFromSearch("?bookmark=nope")).toBeNull();
    expect(bookmarkFromSearch("")).toBeNull();
  });
  it("holds the gate values", () => {
    expect(BOOKMARKS["hero-mid"].rangeM).toBe(800);
    expect(BOOKMARKS["hero-near"]).toMatchObject({ rangeM: 150, pitchDeg: -40, headingDeg: 0 });
    expect(BOOKMARKS.township).toMatchObject({
      centre: [101.5099, 3.1813],
      rangeM: 7000,
      pitchDeg: -55,
    });
    expect(DEFAULT_BOOKMARK).toBe("hero-mid");
  });
  it("has four non-hero probe views at mid range", () => {
    for (const id of ["probe-a", "probe-b", "probe-c", "probe-d"] as const) {
      expect(bookmarkFromSearch(`?bookmark=${id}`)).toBe(id);
      const b = BOOKMARKS[id];
      expect(b.rangeM).toBe(800);
      const dx = (b.centre[0] - HERO_CENTRE[0]) * 111320;
      const dy = (b.centre[1] - HERO_CENTRE[1]) * 110574;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(HERO_RADIUS_M);
    }
  });
});
