import { describe, expect, it } from "vitest";
import {
  buildSimRequest,
  closureFeatures,
  courseSegmentIds,
  resultLines,
  simulateClosures,
} from "./closureSimModel";
import { SIM_RESULT } from "./fixtures";

const row = { roads: "Persiaran Garcinia", day: "2026-10-27", start: "09:00", end: "17:00" };

describe("closure simulation model (T-026 contract)", () => {
  it("builds the contract body in Malaysia time, one closure per row, stretches as typed", () => {
    const out = buildSimRequest("Pipe repair", "works", [
      row,
      { ...row, roads: "Persiaran Elmina between Bulatan Elmina and Persiaran Atmosfera" },
    ]);
    expect(out).toEqual({
      body: {
        name: "Pipe repair",
        reason: "works",
        closures: [
          {
            road_names: ["Persiaran Garcinia"],
            starts_at: "2026-10-27T09:00:00+08:00",
            ends_at: "2026-10-27T17:00:00+08:00",
          },
          expect.objectContaining({
            road_names: ["Persiaran Elmina between Bulatan Elmina and Persiaran Atmosfera"],
          }),
        ],
      },
    });
  });

  it("says what to fix: no road, no day, an end before the start", () => {
    expect(buildSimRequest("x", "event", [{ ...row, roads: " " }])).toEqual({
      error: "Name a road or a stretch",
    });
    expect(buildSimRequest("x", "event", [{ ...row, day: "" }])).toEqual({ error: "Pick a day" });
    expect(buildSimRequest("x", "event", [{ ...row, end: "08:00" }])).toEqual({
      error: "The end must be after the start",
    });
  });

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
    expect(fc.features.map((f) => f.properties)).toEqual([
      { closure: "course" },
      { closure: "detour", pressure: "high" },
    ]);
  });

  it("says plainly when the backend has not landed (404), and returns the result when it has", async () => {
    const res = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const req = { name: "x", reason: "works" as const, closures: [] };
    expect(await simulateClosures(req, res(404, {}))).toMatchObject({
      ok: false,
      unavailable: true,
    });
    expect(await simulateClosures(req, res(422, { detail: "unknown road" }))).toEqual({
      ok: false,
      unavailable: false,
      message: "unknown road",
    });
    expect(await simulateClosures(req, res(200, SIM_RESULT))).toEqual({
      ok: true,
      result: SIM_RESULT,
    });
  });
});
