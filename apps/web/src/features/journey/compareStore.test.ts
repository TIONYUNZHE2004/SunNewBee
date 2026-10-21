import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoHook, resetDemoRegistry } from "../demo/demoHook";
import { useDevsim } from "../devsim/devsimStore";
import provisional from "../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../devsim/types";
import { COMPARE_TOTAL_S, registerCompareDemo, useCompare } from "./compareStore";
import { asCompareIntent, isPlayableCompare } from "./compareTypes";
import elmina from "./fixtures/compare.elmina.json";
import { handCompare } from "./fixtures/compareHand";
import demoPlan from "./fixtures/demoPlan.json";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

const c = () => useCompare.getState();

beforeEach(() => c().clear());
afterEach(() => {
  c().clear();
  useJourney.getState().clear();
  useDevsim.getState().stop();
});

describe("useCompare store transitions (AC-N10)", () => {
  it("loads paused at 0, plays, pauses, seeks within [0, 45] and restarts", () => {
    const p = handCompare();
    c().load(p);
    expect(c()).toMatchObject({ payload: p, t: 0, playing: false, screen: null });
    c().play();
    expect(c().playing).toBe(true);
    c().advance(2);
    expect(c().t).toBe(2);
    c().pause();
    c().advance(2);
    expect(c().t).toBe(2);
    c().seek(99);
    expect(c().t).toBe(COMPARE_TOTAL_S);
    c().seek(-3);
    expect(c().t).toBe(0);
    c().seek(Number.NaN);
    expect(c().t).toBe(0);
    c().seek(20);
    c().restart();
    expect(c()).toMatchObject({ t: 0, playing: true });
  });

  it("stops at the end and plays again from 0", () => {
    c().load(handCompare());
    c().seek(44.9);
    c().play();
    c().advance(1);
    expect(c()).toMatchObject({ t: COMPARE_TOTAL_S, playing: false });
    c().play();
    expect(c()).toMatchObject({ t: 0, playing: true });
  });

  it("does nothing without a payload", () => {
    c().play();
    c().seek(10);
    c().restart();
    expect(c()).toMatchObject({ t: 0, playing: false, payload: null });
  });

  it("clear drops payload, time and screen", () => {
    c().load(handCompare());
    c().setScreen({
      walkers: { fastest: null, recommended: { x: 1, y: 2 } },
      pois: {},
      unchecked: null,
      routesBbox: null,
      cardTop: 400,
      viewports: null,
    });
    c().seek(12);
    c().clear();
    expect(c()).toMatchObject({ payload: null, t: 0, playing: false, screen: null });
  });

  it("one simulation at a time: load ends a shown trip and a Development Simulation", () => {
    useJourney.getState().load(demoPlan as unknown as JourneyPlan);
    useDevsim.getState().start(provisional as unknown as DevelopmentPlan, "b");
    c().load(handCompare());
    expect(useJourney.getState().plan).toBeNull();
    expect(useDevsim.getState().status).toBe("idle");
  });
});

describe("asCompareIntent / isPlayableCompare", () => {
  it("reads flat and nested payloads, and ignores other kinds", () => {
    const p = handCompare();
    expect(asCompareIntent({ kind: "route.highlight" })).toBeNull();
    expect(asCompareIntent(p)?.recommended?.id).toBe("rt-rec");
    const { kind: _k, route_id, ...rest } = p;
    const nested = asCompareIntent({ kind: "route.compare", route_id, compare: rest });
    expect(nested?.recommended?.id).toBe("rt-rec");
    expect(nested?.route_id).toBe("rt-rec");
    expect(nested?.from_place.name).toBe("Car Park B");
    expect(nested?.to_place.id).toBe("pl-playground");
    expect(nested?.unchecked).toHaveLength(1);
  });
  it("reads the recorded Elmina route.compare intent (B6 fixture)", () => {
    const c = asCompareIntent(elmina);
    expect(c?.from_place).toEqual({ id: "lakeside-mall", name: "Elmina Lakeside Mall" });
    expect(c?.to_place.name).toBe("Surau Kiambang");
    expect(c?.route_id).toBe(c?.recommended?.id);
    expect(c?.recommended?.coordinates.length).toBeGreaterThan(1);
    expect(c?.fastest?.coordinates.length).toBeGreaterThan(1);
    expect(isPlayableCompare(c)).toBe(true);
  });
  it("rejects a route without coordinates", () => {
    const p = handCompare();
    const bad = { ...p, recommended: { ...p.recommended, coordinates: undefined }, fastest: null };
    expect(asCompareIntent(bad)).toBeNull();
  });
  it("plays only two different routes with a recommended one", () => {
    expect(isPlayableCompare(handCompare())).toBe(true);
    expect(isPlayableCompare(handCompare({ same_path: true }))).toBe(false);
    expect(isPlayableCompare(handCompare({ status: "no_data", recommended: null }))).toBe(false);
    expect(isPlayableCompare(handCompare({ status: "blocked" }))).toBe(false);
    expect(isPlayableCompare(null)).toBe(false);
  });
});

describe("nav demo registration", () => {
  it("drives the compare store through __tl.demo", () => {
    resetDemoRegistry();
    const off = registerCompareDemo();
    const hook = createDemoHook();
    c().load(handCompare());
    hook.seek(17.5);
    expect(c().t).toBe(17.5);
    hook.play();
    expect(c().playing).toBe(true);
    hook.pause();
    expect(hook.state()).toMatchObject({ key: "nav", loaded: true, t: 17.5, playing: false });
    expect(hook.state().beats).toEqual(expect.arrayContaining(["tag-unchecked", "tag-stop"]));
    hook.seek(19.5);
    expect(hook.state()).toMatchObject({ counters: { tickets: 1 }, camera: "split" });
    expect(hook.state().beats).toContain("ticket-toast");
    off();
    expect(hook.state()).toMatchObject({ key: "nav", registered: false });
  });
});
