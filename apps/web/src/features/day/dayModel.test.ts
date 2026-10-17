import { describe, expect, it } from "vitest";
import { along, binAt, dotsAt, feedUntil, hhmm, prepare, stageAt } from "./dayModel";

const tracks = {
  nodes: [
    [101.5, 3.18],
    [101.501, 3.18],
    [101.502, 3.18],
  ],
  trips: [
    {
      r: "r1",
      m: "walk" as const,
      s: "late",
      k: 1,
      seg: [
        [400, 410, [0, 1, 2], 0],
        [410, 460, [2], 1],
      ] as [number, number, number[], number][],
    },
    {
      r: "r2",
      m: "drive" as const,
      s: "on_time",
      k: 1,
      seg: [[400, 402, [2, 0], 0]] as [number, number, number[], number][],
    },
  ],
  shown: 2,
  of: 5000,
};

describe("day playback", () => {
  it("moves residents along their real path and holds waiting ones still", () => {
    const p = prepare(tracks);
    const mid = dotsAt(p, 405);
    const r1 = mid.find((d) => d.r === "r1");
    expect(r1?.state).toBe("walk");
    expect(r1?.lon).toBeCloseTo(101.501, 4); // halfway by length
    const waiting = dotsAt(p, 430).find((d) => d.r === "r1");
    expect(waiting).toMatchObject({ state: "wait", lon: 101.502 });
    expect(dotsAt(p, 470)).toEqual([]); // arrived: not drawn
    expect(dotsAt(p, 401).find((d) => d.r === "r2")?.state).toBe("drive");
  });

  it("interpolates by length and clamps", () => {
    const pts = tracks.nodes;
    const p = prepare(tracks).byResident.get("r1")?.[0];
    expect(along(pts, p?.cum ?? [], 0)).toEqual(pts[0]);
    expect(along(pts, p?.cum ?? [], 2)).toEqual(pts[2]);
  });

  it("knows the river stage, the feed and the timeline row at a minute", () => {
    const stages: [number, string | null][] = [
      [0, null],
      [405, "stage_p1m"],
      [445, "stage_p2m"],
    ];
    expect(stageAt(stages, 400)).toBeNull();
    expect(stageAt(stages, 450)).toBe("stage_p2m");
    const feed = [
      { id: "a", t: 405, replies: [{ t: 420 }] },
      { id: "b", t: 500, replies: [] },
    ];
    expect(feedUntil(feed, 410).map((p) => p.id)).toEqual(["a"]);
    expect(feedUntil(feed, 410)[0]?.replies).toEqual([]);
    expect(feedUntil(feed, 600).map((p) => p.id)).toEqual(["b", "a"]); // newest first
    expect(binAt([{ t: 300 }, { t: 315 }], 320)?.t).toBe(315);
    expect(hhmm(7 * 60 + 5)).toBe("07:05");
  });
});
