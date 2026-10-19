import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOKMARKS,
  bookmarkFromSearch,
  DEFAULT_BOOKMARK,
  HERO_CENTRE,
  HERO_RADIUS_M,
} from "./bookmarks";
import { createFrame } from "./frame";
import { boundaryOf, clearance } from "./ground/boundary";

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
  it("pins the P4-F probe precincts and centres", () => {
    // A-T5 fix round 1: re-posed inside the Elmina outline (the Elmina Valley 3 centroid is outside).
    expect(BOOKMARKS["probe-a"].centre).toEqual([101.50413, 3.17067]);
    expect(BOOKMARKS["probe-b"].centre).toEqual([101.49473, 3.20748]); // Elmina Green
    // A-T5: re-posed inside the Elmina outline (Subang Galaksi / Seksyen U16 lie outside it).
    expect(BOOKMARKS["probe-c"].centre).toEqual([101.5171, 3.19034]);
    expect(BOOKMARKS["probe-d"].centre).toEqual([101.5234, 3.16683]);
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

describe("bookmarks vs the seed outline (A-T5 fix round 1)", () => {
  // Reads the seed boundary, so a rebuilt outline (A-T3b) re-checks every pose.
  const seed = (p: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
    );
  const frame = createFrame(seed("site.json").center);
  const B = boundaryOf(seed("base/boundary.geojson").features[0].geometry, frame)!;
  it("every bookmark centre lies inside the outline; probes and hero at least 300 m from its edge", () => {
    for (const [id, b] of Object.entries(BOOKMARKS)) {
      const [x, z] = frame.toLocal(b.centre[0], b.centre[1]);
      const c = clearance(B, x, z);
      expect(c, `${id} inside`).toBeGreaterThan(0);
      if (id.startsWith("probe-") || id.startsWith("hero-"))
        expect(c, `${id} >= 300 m from the edge`).toBeGreaterThanOrEqual(300);
    }
    const [hx, hz] = frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]);
    expect(clearance(B, hx, hz)).toBeGreaterThanOrEqual(300);
  });
});
