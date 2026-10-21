import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJourney } from "../journey/journeyStore";
import { useScene } from "../scene/sceneStore";
import { collectProbe, hasProbe, registerDomProbe, registerProbe } from "./anchors";
import { createDevsimHook, installDevsimHook } from "./devsimHook";
import { useDevsim } from "./devsimStore";
import provisional from "./fixtures/plan.provisional.json";
import { asDevsimIntent, beginDevsim, fetchDevsimPlan } from "./intent";
import { stateAt } from "./timeline";
import type { DevelopmentPlan } from "./types";

const plan = provisional as unknown as DevelopmentPlan;
const d = () => useDevsim.getState();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  useScene.getState().reset();
  d().stop();
});

describe("store transitions", () => {
  it("play, pause, advance, end at the total, play again from 0, restart", () => {
    d().start(plan, "b");
    d().play();
    d().advance(1.5);
    expect(d().t).toBe(1.5);
    d().pause();
    d().advance(1);
    expect(d().t).toBe(1.5);
    d().seek(65.9);
    d().play();
    d().advance(1);
    expect(d()).toMatchObject({ t: 66, playing: false });
    d().play();
    expect(d()).toMatchObject({ t: 0, playing: true });
    d().seek(30);
    d().pause();
    d().restart();
    expect(d()).toMatchObject({ t: 0, playing: true });
  });

  it("without a plan nothing plays", () => {
    d().start(null, "b");
    d().play();
    d().advance(1);
    d().restart();
    expect(d()).toMatchObject({ t: 0, playing: false, status: "loading" });
  });
});

describe("AC-F6 seeking backwards restores state", () => {
  it("the same t gives the same state and probe after a forward run", () => {
    d().start(plan, "b");
    const off = registerDomProbe(() => ({ rects: { simBadge: { x: 1, y: 1, w: 10, h: 10 } } }));
    const hook = createDevsimHook();
    hook.seek(19);
    const s1 = hook.state();
    const p1 = hook.probe();
    hook.seek(55);
    d().play();
    d().advance(5);
    hook.seek(19);
    expect(hook.state()).toEqual({ ...s1, playing: true });
    expect(hook.probe()).toEqual(p1);
    off();
  });
});

describe("window.__devsim", () => {
  it("is installed in dev builds and the demo preset only", () => {
    const target: { __devsim?: ReturnType<typeof createDevsimHook> } = {};
    expect(installDevsimHook({ dev: false, search: "" }, target)).toBe(false);
    expect(target.__devsim).toBeUndefined();
    expect(installDevsimHook({ dev: true }, target)).toBe(true);
    expect(target.__devsim).toBeDefined();
    expect(installDevsimHook({ dev: false, search: "?demo=1" }, {})).toBe(true);
  });

  it("seek / play / pause / total / acts / facts / probe", () => {
    const hook = createDevsimHook();
    expect(hook.total).toBe(0);
    expect(hook.state()).toBeNull();
    d().start(plan, "b");
    expect(hook.total).toBe(66);
    expect(hook.acts.map((a) => a.name)).toContain("Handover");
    expect(hook.facts?.park.min).toBe(plan.facts.park.min);
    hook.play();
    expect(d().playing).toBe(true);
    hook.pause();
    hook.seek(40);
    expect(d().t).toBe(40);
    const p = hook.probe();
    expect(p.t).toBe(40);
    expect(p.windowsLitFraction).toBe(stateAt(40, plan).windowsLitFraction);
    expect(collectProbe(40).windowsLitFraction).toBe(0);
  });
});

describe("intent wiring", () => {
  it("asDevsimIntent reads only development.play", () => {
    expect(asDevsimIntent({ kind: "journey.play" })).toBeNull();
    expect(asDevsimIntent(null)).toBeNull();
    expect(asDevsimIntent({ kind: "development.play", brief_text: "x", plan })).toEqual({
      kind: "development.play",
      brief_text: "x",
      plan,
    });
    expect(asDevsimIntent({ kind: "development.play", brief_text: "x", plan: null })?.plan).toBe(
      undefined,
    );
    expect(asDevsimIntent({ kind: "development.play", plan: { nope: 1 } })).toEqual({
      kind: "development.play",
      brief_text: "",
      plan: undefined,
    });
  });

  it("an inlined plan plays at once and drops a shown trip", () => {
    useJourney.setState({ plan: { route_id: "r" } as never });
    useScene.getState().applyIntent({ kind: "development.play", brief_text: "b", plan } as never);
    expect(useJourney.getState().plan).toBeNull();
    expect(d()).toMatchObject({ status: "ready", playing: true, t: 0, briefText: "b" });
    useScene.getState().stopDevsim();
    expect(d().status).toBe("idle");
  });

  it("without a plan it fetches POST /api/developments/simulate, then plays", async () => {
    const fetchFn = vi.fn(async () => json(plan));
    await beginDevsim({ kind: "development.play", brief_text: "brief" }, fetchFn as never);
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/developments/simulate",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ brief_text: "brief" }) }),
    );
    expect(d()).toMatchObject({ status: "ready", playing: true });
    expect(d().plan?.acts).toEqual(plan.acts);
  });

  it("404 -> unavailable, 500 or a bad body -> error", async () => {
    const notHere = async () =>
      json({ detail: "development simulation not available for this world" }, 404);
    await beginDevsim({ kind: "development.play", brief_text: "b" }, notHere as never);
    expect(d()).toMatchObject({ status: "unavailable", plan: null, playing: false });
    expect(await fetchDevsimPlan("b", (async () => json({}, 500)) as never)).toBe("error");
    expect(await fetchDevsimPlan("b", (async () => json({ a: 1 })) as never)).toBe("error");
    const offline = async () => {
      throw new Error("offline");
    };
    expect(await fetchDevsimPlan("b", offline as never)).toBe("error");
  });

  it("a stop while the fetch runs drops the late plan", async () => {
    let release: (r: Response) => void = () => {};
    const slow = () =>
      new Promise<Response>((r) => {
        release = r;
      });
    const pending = beginDevsim({ kind: "development.play", brief_text: "b" }, slow as never);
    d().stop();
    release(json(plan));
    await pending;
    expect(d()).toMatchObject({ status: "idle", plan: null });
  });

  it("a journey.play stops the simulation", () => {
    useScene.getState().applyIntent({ kind: "development.play", brief_text: "b", plan } as never);
    useScene.getState().applyIntent({
      kind: "journey.play",
      journey: { route_id: "r1", start_time: "09:00", events: [], spans: [], profile: "default" },
    } as never);
    expect(d().status).toBe("idle");
  });

  it("a trip loaded any other way (Watch the trip) stops the simulation too", () => {
    useScene.getState().applyIntent({ kind: "development.play", brief_text: "b", plan } as never);
    useJourney.getState().load({
      route_id: "r1",
      start_time: "09:00",
      events: [],
      spans: [],
      profile: "default",
    } as never);
    expect(d().status).toBe("idle");
  });

  it("a later answer's map intent hands the map back, even after the run has ended (I3)", () => {
    const later = [
      { kind: "camera.fly_to", center: [101.5, 3.1], range_m: 800 },
      { kind: "place.focus", place_id: "p1" },
      {
        kind: "route.highlight",
        route_id: "r9",
        geojson: {
          type: "LineString",
          coordinates: [
            [101.5, 3.1],
            [101.51, 3.11],
          ],
        },
      },
      { kind: "flood.set_level", scenario_id: "stage_p1m" },
    ];
    for (const i of later) {
      useScene.getState().applyIntent({ kind: "development.play", brief_text: "b", plan } as never);
      d().seek(plan.total_s); // the end card, paused
      d().pause();
      useScene.getState().applyIntent(i as never);
      expect(d().status, i.kind).toBe("idle");
    }
    // a map intent of the answer that started it (same answer id) leaves it running, in any order
    useScene
      .getState()
      .applyIntent({ kind: "development.play", brief_text: "b", plan } as never, "a1");
    useScene.getState().applyIntent(later[0] as never, "a1");
    expect(d().status).toBe("ready");
    useScene.getState().applyIntent(later[1] as never, "a2"); // the next answer's
    expect(d().status).toBe("idle");
    // a layer toggle (not a map move) leaves it running
    useScene.getState().applyIntent({ kind: "development.play", brief_text: "b", plan } as never);
    useScene.getState().applyIntent({ kind: "layer.toggle", lens: "access" } as never);
    expect(d().status).toBe("ready");
    // an intent without geometry moves nothing either
    useScene.getState().applyIntent({ kind: "route.highlight", route_id: "r9" } as never);
    useScene.getState().applyIntent({ kind: "camera.fly_to" } as never);
    expect(d().status).toBe("ready");
  });
});

describe("probe window state (Q4)", () => {
  it("without a 3D part the timeline value is reported; a 3D part's value is never masked", () => {
    d().start(plan, "b");
    const hook = createDevsimHook();
    hook.seek(40);
    const expected = stateAt(40, plan).windowsLitFraction;
    expect(expected).toBeGreaterThan(0);
    expect(hasProbe("scene")).toBe(false);
    expect(hook.probe()).toMatchObject({
      windowsLitFraction: expected,
      expectedWindowsLitFraction: expected,
    });
    // a broken 3D tower that never lights its windows
    const off = registerProbe("scene", () => ({ windowsLitFraction: 0 }));
    expect(hasProbe("scene")).toBe(true);
    expect(hook.probe()).toMatchObject({
      windowsLitFraction: 0,
      expectedWindowsLitFraction: expected,
    });
    off();
    expect(hasProbe("scene")).toBe(false);
  });
});

describe("journey.play while the plan is still loading", () => {
  it("stops the pending simulation, so a late plan never plays over the trip", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((r) => {
          release = r;
        }),
    );
    useScene
      .getState()
      .applyIntent({ kind: "development.play", brief_text: "b", plan: null } as never);
    expect(d().status).toBe("loading");
    useScene.getState().applyIntent({
      kind: "journey.play",
      journey: { route_id: "r1", start_time: "09:00", events: [], spans: [], profile: "default" },
    } as never);
    expect(d().status).toBe("idle");
    release(json(plan));
    await new Promise((r) => setTimeout(r, 0));
    expect(d()).toMatchObject({ status: "idle", plan: null, playing: false });
    vi.unstubAllGlobals();
  });
});
