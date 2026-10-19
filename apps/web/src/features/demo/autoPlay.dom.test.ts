// @vitest-environment jsdom
import type { SceneIntent } from "@tl/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../journey/fixtures/demoPlan.json";
import type { JourneyPlan } from "../journey/timeline";

/**
 * Spec §6.6 / D-T10: with the demo preset (`?demo=1`) the trip plays as soon as its journey.play
 * intent arrives; a normal load only loads it (paused) and the resident presses "Watch the trip".
 */
const plan = demo as unknown as JourneyPlan;
const intent = (journey: JourneyPlan | null = plan) =>
  ({ kind: "journey.play", route_id: plan.route_id, start_time: "09:00", journey }) as SceneIntent;

const boot = async (search: string) => {
  window.history.replaceState(null, "", `/${search}`);
  vi.resetModules();
  const scene = (await import("../scene/sceneStore")).useScene;
  const journey = (await import("../journey/journeyStore")).useJourney;
  return { scene, journey };
};

describe("demo preset auto-play", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("plays the trip from the start when journey.play arrives with ?demo=1", async () => {
    const { scene, journey } = await boot("?demo=1");
    scene.getState().applyIntent(intent());
    const j = journey.getState();
    expect(j.plan).toBe(plan);
    expect(j.playing).toBe(true);
    expect(j.t).toBe(0);
  });

  it("only loads the trip, paused, on a normal load (the Watch the trip button plays it)", async () => {
    for (const search of ["", "?demo=0", "?acceptance=1", "?demo=hero"]) {
      const { scene, journey } = await boot(search);
      scene.getState().applyIntent(intent());
      expect(journey.getState().plan).toBe(plan);
      expect(journey.getState().playing).toBe(false);
    }
  });

  it("does nothing without a plan on the intent", async () => {
    const { scene, journey } = await boot("?demo=1");
    scene.getState().applyIntent(intent(null));
    expect(journey.getState().plan).toBeNull();
    expect(journey.getState().playing).toBe(false);
  });

  it("restarts from the start when a second answer brings a new trip", async () => {
    const { scene, journey } = await boot("?demo=1");
    scene.getState().applyIntent(intent());
    journey.getState().seek(20);
    const again = { ...plan } as JourneyPlan;
    scene.getState().applyIntent(intent(again));
    expect(journey.getState().plan).toBe(again);
    expect(journey.getState().t).toBe(0);
    expect(journey.getState().playing).toBe(true);
  });
});
