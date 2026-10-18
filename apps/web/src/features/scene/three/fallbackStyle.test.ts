import { describe, expect, it } from "vitest";
import { paletteFor } from "./assets/fit";
import type { Manifest } from "./assets/manifest";
import { BLOCK_WALLS, fallbackColourFn, fallbackColours, propsByBuildingId } from "./fallbackStyle";

const spec = (palettes: Record<string, [string, string, string][]>) =>
  ({ palettes, variants: {}, variantByGroup: {}, jitter: {} }) as never;
const M = {
  version: 1,
  as_of: "x",
  precinctGroups: [["valley", "elmina valley"]],
  landmarks: {},
  assets: {
    link_intermediate: spec({
      default: [["#111111", "#222222", "#333333"]],
      valley: [
        ["#e6e7e8", "#50545a", "#a0563f"],
        ["#e0e1e2", "#4a4e54", "#a0563f"],
      ],
    }),
    shop_office: spec({ default: [["#aabbcc", "#445566", "#778899"]] }),
    generic: spec({ default: [["#cccccc", "#555555", "#999999"]] }),
  },
} as unknown as Manifest;
const groups = M.precinctGroups;

describe("fallbackColours", () => {
  it("takes the valley palette of the archetype for Elmina Valley 2", () => {
    const [wall, roof] = paletteFor(M.assets.link_intermediate!, "valley", "b1");
    const c = fallbackColours(
      {
        id: "b1",
        archetype: "link_intermediate",
        precinct: "Elmina Valley 2",
        kind: "residential",
      },
      M,
      groups,
    );
    expect(c.wall).toBe(wall);
    expect(c.roof).toBe(roof);
  });

  it("gives a generic commercial building the commercial palette", () => {
    const c = fallbackColours({ id: "c1", kind: "commercial" }, M, groups);
    expect(["#aabbcc", ...BLOCK_WALLS]).toContain(c.wall);
    expect(c.roof).toBe("#445566");
  });

  it("varies block walls per id (A-T9) but leaves house walls on the palette", () => {
    const walls = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const p = { id: `blk${i}`, kind: "commercial" };
      const c = fallbackColours(p, M, groups);
      expect(fallbackColours(p, M, groups)).toEqual(c);
      walls.add(c.wall);
    }
    expect(walls.size).toBeGreaterThan(2);
    for (let i = 0; i < 20; i++)
      expect(BLOCK_WALLS).not.toContain(
        fallbackColours({ id: `h${i}`, archetype: "link_intermediate" }, M, groups).wall,
      );
  });

  it("is deterministic for the same id and has a trim darker than the wall", () => {
    const p = { id: "z9", archetype: "link_intermediate", precinct: "Elmina Valley 1" };
    const a = fallbackColours(p, M, groups);
    expect(fallbackColours(p, M, groups)).toEqual(a);
    expect(a.trim).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.trim).not.toBe(a.wall);
  });

  it("returns the neutral colours without a manifest", () => {
    expect(fallbackColours({ id: "x" }, null, [])).toEqual({
      wall: "#ece8df",
      roof: "#62666c",
      trim: "#d8d3c8",
    });
  });
});

describe("fallbackColourFn", () => {
  it("reads archetype and precinct from the feature properties by building id", () => {
    const fc = {
      features: [
        { properties: { id: "b1", archetype: "link_intermediate", precinct: "Elmina Valley 2" } },
      ],
    };
    expect(propsByBuildingId(fc).get("b1")?.precinct).toBe("Elmina Valley 2");
    const f = fallbackColourFn(fc, M);
    const [wall] = paletteFor(M.assets.link_intermediate!, "valley", "b1");
    expect(f({ id: "b1", kind: "residential" }).wall).toBe(wall);
  });
});
