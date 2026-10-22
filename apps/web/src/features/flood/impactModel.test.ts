import { describe, expect, it } from "vitest";
import {
  formatPathLength,
  IMPACT_STYLE,
  impactSummary,
  listRows,
  placesWord,
  possibleOnly,
} from "./impactModel";

const affected = {
  scenario_id: "stage_p3m",
  disclaimer: "Indicative scenario, not a forecast. Flash floods from heavy rain are not shown.",
  flooded_path_m: 141598.68,
  flooded_places: [
    {
      id: "playground",
      name: "Urban Park playground",
      type: "playground",
      lonlat: [101.511, 3.181],
    },
  ],
  cut_off_places: [
    { id: "bench-3", name: "Urban Park bench 3", type: "seating", lonlat: [101.5098, 3.1805] },
    { id: "bad", name: "No position", type: "seating", lonlat: [] },
  ],
  isolated_components: [],
  isolated_total: 0,
} as never;

describe("flood impact (T-024 markers)", () => {
  it("counts the places the API returned and keeps only those with a position as markers", () => {
    const s = impactSummary(affected);
    expect(s).toMatchObject({ flooded: 1, cutOff: 2, pathLength: "141.6 km" });
    expect(s?.markers.map((m) => [m.id, m.kind])).toEqual([
      ["playground", "flooded"],
      ["bench-3", "cut_off"],
    ]);
  });

  it("says nothing without data", () => {
    expect(impactSummary(null)).toBeNull();
  });

  it("formats path length in metres or kilometres, never a depth", () => {
    expect(formatPathLength(111.2)).toBe("111 m");
    expect(formatPathLength(1500)).toBe("1.5 km");
    expect(formatPathLength(0)).toBe("0 m");
  });

  it("uses the API's honesty labels and the agreed glyphs", () => {
    expect(IMPACT_STYLE.flooded).toMatchObject({
      glyph: "!",
      label: "Likely flooded (indicative)",
    });
    expect(IMPACT_STYLE.cut_off.label).toBe("Cut off: no mapped way in or out (indicative)");
    expect(IMPACT_STYLE.cut_off.glyph).toBe("⚠");
    expect(placesWord(1)).toBe("1 place");
  });
});

describe("low-lying terrain only (T-029)", () => {
  it("says the possible counts, never '0 places likely flooded'", () => {
    const s = impactSummary({
      flooded_places: [],
      cut_off_places: [],
      flooded_path_m: 0,
      possible_place_count: 6,
      possible_path_count: 515,
    } as never);
    expect(s && possibleOnly(s)).toBe(true);
    expect(s?.possiblePlaces).toBe(6);
    expect(s?.possiblePaths).toBe(515);
  });
});

describe("flood place lists on the card (22 Oct demo fix)", () => {
  const m = (id: string, name: string, type: string) => ({
    id,
    name,
    type,
    coord: [101.5, 3.1] as [number, number],
    kind: "flooded" as const,
  });
  it("lists places first, named before unnamed, and counts street furniture in one row", () => {
    const { places, small } = listRows([
      m("s1", "Seating (unnamed, OSM)", "seating"),
      m("w1", "Waste Basket (unnamed, OSM)", "waste_basket"),
      m("p1", "Park (unnamed, OSM)", "park"),
      m("p2", "Elmina Urban Park", "park"),
      m("t1", "Shelter (unnamed, OSM)", "shelter"),
    ]);
    expect(places.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(small).toBe(3);
  });
  it("only furniture: listed as is, nothing hidden", () => {
    const rows = [m("s1", "Seating (unnamed, OSM)", "seating")];
    expect(listRows(rows)).toEqual({ places: rows, small: 0 });
  });
});
