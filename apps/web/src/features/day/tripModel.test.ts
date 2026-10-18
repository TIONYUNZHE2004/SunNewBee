import { describe, expect, it } from "vitest";
import {
  cellSentence,
  minutesOf,
  OUTCOME_STYLE,
  parseTrip,
  tripFromApi,
  tripPositionAt,
} from "./tripModel";

const API = {
  status: "rehearsed",
  scenario: { id: "storm", label: "Storm at the school run" },
  from: { id: "park-b", name: "Car Park B" },
  to: { id: "sk", name: "SK Denai Alam" },
  profile: "stroller",
  leave: "07:00",
  normal_minutes: 10,
  asked: { outcome: "rerouted", arrive: "07:30", minutes: 30, unchecked: 2 },
  cut_by: ["the street on Persiaran Alstonia"],
  last_ok_leave_before: "06:40",
  next_clear_leave: "12:30",
  normal_route: [
    [101.5, 3.18],
    [101.51, 3.18],
  ],
  cut_lines: [
    [
      [101.505, 3.18],
      [101.506, 3.18],
    ],
  ],
  track: [
    {
      t0: 420,
      t1: 430,
      wait: false,
      coords: [
        [101.5, 3.18],
        [101.502, 3.18],
      ],
    },
    { t0: 430, t1: 440, wait: true, coords: [[101.502, 3.18]] },
    {
      t0: 440,
      t1: 450,
      wait: false,
      coords: [
        [101.502, 3.18],
        [101.51, 3.18],
      ],
    },
  ],
  sweep: [
    { leave: "06:40", outcome: "clear", arrive: "06:50" },
    { leave: "07:00", outcome: "rerouted", arrive: "07:30" },
    { leave: "07:10", outcome: "no_way", arrive: null },
  ],
};

describe("rehearse my trip model", () => {
  it("turns the API response into the same geojson as the day.trip intent", () => {
    const g = tripFromApi(API);
    const p = parseTrip(g);
    expect(p?.normal).toHaveLength(2);
    expect(p?.cut).toHaveLength(1);
    expect(p?.segs.map((s) => s.wait)).toEqual([false, true, false]);
    expect(p?.meta).toMatchObject({
      from: "Car Park B",
      from_id: "park-b",
      outcome: "rerouted",
      next_clear_leave: "12:30",
    });
    expect(p?.meta.sweep).toHaveLength(3);
  });

  it("places the resident along the engine's segments at the clock", () => {
    const segs = parseTrip(tripFromApi(API))?.segs ?? [];
    expect(tripPositionAt(segs, 400)?.state).toBe("not_left");
    const mid = tripPositionAt(segs, 425);
    expect(mid?.state).toBe("moving");
    expect(mid?.lon).toBeCloseTo(101.501, 3);
    expect(tripPositionAt(segs, 435)).toMatchObject({ state: "waiting", lon: 101.502 });
    expect(tripPositionAt(segs, 500)).toMatchObject({ state: "ended", lon: 101.51 });
    expect(tripPositionAt([], 425)).toBeNull();
  });

  it("words each departure as what happened in the rehearsal, never advice", () => {
    expect(cellSentence({ leave: "07:10", outcome: "no_way" })).toBe(
      "Leaving at 07:10: found no way through (rehearsal).",
    );
    for (const s of Object.values(OUTCOME_STYLE))
      expect(s.words).not.toMatch(/\b(?:safe|should|will|best)\b/i);
    expect(minutesOf("07:05")).toBe(425);
    expect(minutesOf("7:05")).toBeNull();
  });

  it("ignores geojson it does not understand", () => {
    expect(parseTrip(null)).toBeNull();
    expect(parseTrip({ type: "FeatureCollection", features: [{}] })?.segs).toEqual([]);
  });
});
