import { beforeEach, describe, expect, it } from "vitest";
import { emptyAssistant, reduceIntent, type SceneIntent } from "../chat/chatReducer";
import { useDevsim } from "../devsim/devsimStore";
import provisional from "../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../devsim/types";
import { useCompare } from "../journey/compareStore";
import { handCompare } from "../journey/fixtures/compareHand";
import demo from "../journey/fixtures/demoPlan.json";
import { useJourney } from "../journey/journeyStore";
import type { JourneyPlan } from "../journey/timeline";
import { movesMap, useScene } from "./sceneStore";

const intent = (o: object) => o as unknown as SceneIntent;
const highlight = (id: string) =>
  intent({
    kind: "route.highlight",
    route_id: id,
    geojson: { type: "LineString", coordinates: [[101.5, 3.18]] },
  });

beforeEach(() => {
  useScene.getState().reset();
  useCompare.getState().clear();
});

describe("applyIntent route.compare", () => {
  it("stores the payload without starting the compare playback", () => {
    useScene.getState().applyIntent(intent(handCompare()));
    expect(useScene.getState().compare?.recommended?.id).toBe("rt-rec");
    expect(useCompare.getState().payload).toBeNull();
  });

  it("moves the map: it stops a running Development Simulation", () => {
    expect(movesMap(intent(handCompare()))).toBe(true);
    expect(movesMap(intent({ kind: "route.compare" }))).toBe(false); // no routes in it
    useDevsim.getState().start(provisional as unknown as DevelopmentPlan, "b");
    useScene.getState().applyIntent(intent(handCompare()), "other-answer");
    expect(useDevsim.getState().status).toBe("idle");
  });

  it("a newer route of other ids drops a loaded compare playback; its own route does not", () => {
    const p = handCompare();
    useCompare.getState().load(p);
    useScene.getState().applyIntent(highlight("rt-rec"));
    expect(useCompare.getState().payload).toBe(p);
    useScene.getState().applyIntent(highlight("rt-other"));
    expect(useCompare.getState().payload).toBeNull();
  });

  it("clearRoute, a new persona and reset drop the compare and its playback", () => {
    useScene.getState().applyIntent(intent(handCompare()));
    useCompare.getState().load(handCompare());
    useScene.getState().clearRoute();
    expect(useScene.getState().compare).toBeNull();
    expect(useCompare.getState().payload).toBeNull();
    useScene.getState().applyIntent(intent(handCompare()));
    useCompare.getState().load(handCompare());
    useScene
      .getState()
      .setProfile(useScene.getState().profile === "stroller" ? "default" : "stroller");
    expect(useScene.getState().compare).toBeNull();
    expect(useCompare.getState().payload).toBeNull();
  });

  it("journey.play still loads today's trip when no compare playback is shown (AC-N1)", () => {
    const plan = demo as unknown as JourneyPlan;
    useScene.getState().applyIntent(intent(handCompare()));
    useScene.getState().applyIntent(intent({ kind: "journey.play", journey: plan }));
    expect(useJourney.getState().plan).toBe(plan);
    expect(useJourney.getState().playing).toBe(false);
  });
});

describe("chat reduceIntent route.compare", () => {
  it("keeps the answer's own compare for its Watch button", () => {
    const m = reduceIntent(emptyAssistant("a"), intent(handCompare()));
    expect(m.compare?.fastest?.id).toBe("rt-fast");
    expect(
      reduceIntent(emptyAssistant("a"), intent({ kind: "route.compare" })).compare,
    ).toBeUndefined();
  });
});
