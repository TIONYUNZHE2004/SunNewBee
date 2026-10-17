import { describe, expect, it } from "vitest";
import { reachLine } from "./impactModel";

describe("reachLine", () => {
  it("says who a path matters to in the rehearsal, counts only", () => {
    const l = reachLine({
      kind: "path",
      residents: 255,
      trips: 461,
      day: { label: "A normal weekday" },
      by_purpose: [
        { purpose: "home", words: "trips home", trips: 228 },
        { purpose: "school", words: "school runs and school trips", trips: 179 },
        { purpose: "park", words: "park visits", trips: 29 },
      ],
      by_group: { child: 58, teen: 113, adult: 68, older: 16 },
    });
    expect(l?.title).toBe("Who this matters to · A normal weekday (rehearsal)");
    expect(l?.text).toBe(
      "255 synthetic residents' trips cross this path (461 trips: 179 school runs and school trips, 29 park visits).",
    );
    expect(l?.who).toBe("Among them 58 children and 113 teenagers.");
  });

  it("shows nothing when nobody's trips use it", () => {
    expect(reachLine({ kind: "path", residents: 0, trips: 0 })).toBeNull();
    expect(reachLine({ kind: "other", residents: 3 })).toBeNull();
    expect(reachLine(undefined)).toBeNull();
  });
});
