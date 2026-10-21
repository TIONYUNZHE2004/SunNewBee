import { describe, expect, it } from "vitest";
import {
  basisWords,
  closureFeatures,
  courseSegmentIds,
  resultLines,
  uniqueSuggestions,
} from "./closureSimModel";
import { SIM_RESULT } from "./fixtures";

describe("closure simulation model (T-026, generated types)", () => {
  it("keeps old data gaps apart from trips the closure cuts", () => {
    const l = resultLines(SIM_RESULT);
    expect(l.affected).toBe("7 of 63 sample trips change route");
    expect(l.newly).toBe("3 trips newly without a mapped route");
    expect(l.gaps).toBe(
      "42 of the 63 had no mapped route before the closure (data gaps, not the closure)",
    );
    expect(l.extra).toBe("Rerouted trips go about 82.5 m further (median)");
  });

  it("draws the course and the detours from the access layer's edges", () => {
    expect(courseSegmentIds(SIM_RESULT)).toEqual(["seg-ab"]);
    const edges = [
      {
        id: "seg-ab",
        coords: [
          [0, 0],
          [1, 0],
        ] as [number, number][],
      },
      {
        id: "seg-bc",
        coords: [
          [1, 0],
          [1, 1],
        ] as [number, number][],
      },
    ];
    const fc = closureFeatures(SIM_RESULT, edges);
    // seg-cd and seg-de have no geometry in this layer: drawn only where the map has them
    expect(fc.features.map((f) => f.properties)).toEqual([
      { closure: "course" },
      { closure: "detour", pressure: "high" },
    ]);
  });

  it("gives a suggestion's basis in plain words and keeps unknown terms as written", () => {
    expect(
      basisWords(
        "detour_roads[Persiaran Tamarind].weighted_trips=8; capacity[residential]=1; capacity[tertiary]=3",
      ),
    ).toBe(
      "8 weighted sample trips on Persiaran Tamarind; residential road capacity 1; tertiary road capacity 3",
    );
    expect(basisWords("places_cut_off count=1; mapped_junction=n-1")).toBe(
      "1 place cut off; junction n-1",
    );
    expect(basisWords("trips_affected=40; trips_total=63; active_segments=5")).toBe(
      "40 sample trips affected; 63 sample trips in all; 5 closed segments",
    );
    expect(basisWords("new_term=2")).toBe("new_term=2");
    expect(basisWords("detour_roads[A].weighted_trips=4.0")).not.toContain("detour_roads[");
  });

  it("lists each suggestion text once", () => {
    expect(uniqueSuggestions(SIM_RESULT).map((s) => s.kind)).toEqual(["signpost", "marshal"]);
  });
});
