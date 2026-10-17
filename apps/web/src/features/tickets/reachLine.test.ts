import { describe, expect, it } from "vitest";
import { reachLine } from "./impactModel";

describe("reachLine", () => {
  it("says who a path matters to in the rehearsal, counts only", () => {
    const l = reachLine({
      kind: "path",
      residents: 255,
      on_foot: 240,
      by_car: 15,
      trips: 461,
      day: { label: "A normal weekday" },
      by_purpose: [
        { purpose: "home", words: "trips home", trips: 228 },
        { purpose: "school", words: "school runs and school trips", trips: 179 },
        { purpose: "park", words: "park visits", trips: 29 },
      ],
      by_group: { child: 58, teen: 113, adult: 68, older: 16 },
    });
    expect(l?.title).toBe("Whose rehearsed trips use this · A normal weekday");
    expect(l?.text).toBe(
      "255 synthetic residents' trips use this path or road (240 on foot, 15 by car): 461 trips, of which 179 school runs and school trips, 29 park visits, 228 trips home.",
    );
    expect(l?.who).toBe("Among them 58 children and 113 teenagers.");
  });

  it("shows nothing when nobody's trips use it", () => {
    expect(reachLine({ kind: "path", residents: 0, trips: 0 })).toBeNull();
    expect(reachLine({ kind: "other", residents: 3 })).toBeNull();
    expect(reachLine(undefined)).toBeNull();
  });
});
