import type { Schemas } from "@tl/api-client";
import { afterEach, describe, expect, it } from "vitest";
import { honestyViolations } from "../../test/honesty";
import plan from "../journey/fixtures/demoPlan.json";
import type { JourneyPlan } from "../journey/timeline";
import { WATER_LOOK_NOTE } from "./floodPresentation";
import { type FloodStory, nearestMappedCentre, riverStages } from "./floodStoryData";
import { useFloodStory } from "./floodStoryStore";
import { BUILDINGS_AT, floodStateAt, floodTimeline, RESIDENT_AT } from "./floodTimeline";

const scenario = (stage_m: number, kind = "river_stage") =>
  ({ id: `${kind}-${stage_m}`, stage_m, kind }) as Schemas["Scenario"];
const story: FloodStory = {
  stages: [],
  resident: null,
  residentGap: "No mapped connection (data gap).",
};
const centre = (
  id: string,
  distance_m: number | null,
  route_status = "partly_unverified",
  reachable = true,
) =>
  ({
    centre: { id, source: "osm_candidate" },
    distance_m,
    route_status,
    reachable,
  }) as Schemas["CentreReachability"];

afterEach(() => useFloodStory.getState().close());

describe("river story evidence selection", () => {
  it("selects each real river stage, excluding terrain and combined scenarios", () => {
    const stages = riverStages([
      scenario(3, "combined"),
      scenario(0, "lowlying"),
      scenario(3),
      scenario(1),
      scenario(2),
      scenario(0),
    ]);
    expect(stages.map((s) => s.id)).toEqual([
      "river_stage-0",
      "river_stage-1",
      "river_stage-2",
      "river_stage-3",
    ]);
    expect(() => riverStages([scenario(0), scenario(1), scenario(3)])).toThrow(/not available/);
  });
  it("uses the shortest mapped route, never a nearby centre with a data gap or closure", () => {
    const selected = nearestMappedCentre([
      centre("closed", 1, "closed", false),
      centre("gap", null, "no_data", false),
      centre("b", 600),
      centre("a", 360),
      centre("bad", Number.NaN),
    ]);
    expect(selected?.centre.id).toBe("a");
    expect(selected?.centre.source).toBe("osm_candidate");
    expect(nearestMappedCentre([centre("gap", null, "no_data", false)])).toBeNull();
  });
});

describe("river timeline and playback", () => {
  it("seeks every stage deterministically, then buildings, journey and limits", () => {
    const tl = floodTimeline(story);
    expect([0, 6, 12, 18].map((t) => floodStateAt(t, tl).stage)).toEqual([0, 1, 2, 3]);
    expect(floodStateAt(BUILDINGS_AT, tl).phase).toBe("buildings");
    expect(floodStateAt(RESIDENT_AT, tl).phase).toBe("resident");
    expect(floodStateAt(tl.total, tl).phase).toBe("end");
    expect(floodStateAt(Number.NaN, tl).seconds).toBe(0);
    expect(floodStateAt(-30, tl).stage).toBe(0);
    expect(floodStateAt(1e10, tl).seconds).toBe(tl.total);
    for (const t of [0, 7, 13, 20, 30]) expect(floodStateAt(t, tl)).toEqual(floodStateAt(t, tl));
  });
  it("rises smoothly within a stage without inventing an intermediate scenario", () => {
    const tl = floodTimeline(story);
    const a = floodStateAt(12, tl),
      b = floodStateAt(13, tl),
      c = floodStateAt(14, tl);
    expect([a.stage, b.stage, c.stage]).toEqual([2, 2, 2]);
    expect(a.rise).toBeLessThan(b.rise);
    expect(b.rise).toBeLessThan(c.rise);
    expect(a.fade).toBeLessThan(c.fade);
  });
  it("reuses the actual journey timeline length and stops at the end; pause and restart work", () => {
    const withTrip = { ...story, resident: { plan: plan as unknown as JourneyPlan } } as FloodStory;
    const tl = floodTimeline(withTrip);
    expect(tl.journey?.plan).toBe(plan);
    const store = useFloodStory.getState();
    store.load(withTrip);
    store.play();
    store.advance(10);
    store.pause();
    store.advance(5);
    expect(useFloodStory.getState().t).toBe(10);
    store.seek(tl.total - 1);
    store.play();
    store.advance(5);
    expect(useFloodStory.getState().playing).toBe(false);
    expect(useFloodStory.getState().t).toBe(tl.total);
    store.play();
    expect(useFloodStory.getState().t).toBe(0);
    store.close();
    expect(useFloodStory.getState().story).toBeNull();
  });
});

describe("river wording limits", () => {
  it("permits only the exact required limit, while keeping depth and safety claims rejected", () => {
    expect(honestyViolations(WATER_LOOK_NOTE)).toEqual([]);
    expect(honestyViolations(`${WATER_LOOK_NOTE} Water depth is 2 m.`)).not.toEqual([]);
    expect(honestyViolations(`${WATER_LOOK_NOTE} The path is 1 m deep.`)).not.toEqual([]);
    expect(honestyViolations(`${WATER_LOOK_NOTE} It is safe.`)).not.toEqual([]);
  });
});
