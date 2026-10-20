import { beforeEach, describe, expect, it } from "vitest";
import { collectProbe, registerDomProbe, registerProbe } from "./anchors";
import { useDevsim } from "./devsimStore";
import provisional from "./fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "./types";

const plan = provisional as unknown as DevelopmentPlan;
const d = () => useDevsim.getState();

describe("devsimStore", () => {
  beforeEach(() => d().stop());

  it("start without a plan is loading; with a plan, ready at t = 0", () => {
    d().start(null, "brief");
    expect(d()).toMatchObject({ plan: null, status: "loading", briefText: "brief", t: 0 });
    d().start(plan, "brief");
    expect(d()).toMatchObject({ plan, status: "ready", t: 0, playing: false });
  });

  it("seek clamps to [0, total_s]", () => {
    d().start(plan, "brief");
    d().seek(500);
    expect(d().t).toBe(66);
    d().seek(-3);
    expect(d().t).toBe(0);
    d().seek(Number.NaN);
    expect(d().t).toBe(0);
    d().seek(20.5);
    expect(d().t).toBe(20.5);
  });

  it("stop resets to idle", () => {
    d().start(plan, "brief");
    d().seek(30);
    d().play();
    d().stop();
    expect(d()).toMatchObject({
      plan: null,
      t: 0,
      playing: false,
      status: "idle",
      briefText: null,
    });
  });
});

describe("collectProbe", () => {
  it("merges the scene and DOM parts, rects per key", () => {
    const offScene = registerProbe("scene", () => ({
      rects: { tower: { x: 1, y: 2, w: 3, h: 4 } },
      people: [[5, 6]],
    }));
    const offDom = registerDomProbe(() => ({ rects: { bubble: { x: 0, y: 0, w: 9, h: 9 } } }));
    const p = collectProbe(12);
    expect(p.t).toBe(12);
    expect(p.rects).toEqual({
      tower: { x: 1, y: 2, w: 3, h: 4 },
      bubble: { x: 0, y: 0, w: 9, h: 9 },
    });
    expect(p.people).toEqual([[5, 6]]);
    offScene();
    offDom();
    expect(collectProbe(0).rects).toEqual({});
  });
});
