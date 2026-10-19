import { describe, expect, it } from "vitest";
import { BUBBLE_FADE_S, BUBBLE_MAX_STEP_S, createBubbleFader } from "../detailBubble";
import { createDressingDriver } from "./dressingDriver";
import { createDressingLayer } from "./dressingLayer";
import type { DressItem } from "./dressingPlan";

const R = 150;
const decor = (tag: string, x: number, n: number): DressItem[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `planter:${tag}:${i}`,
    model: "planter",
    x: x + i,
    z: 0,
    yaw: 0,
    s: 1,
  }));
const fact = (id: string, x: number): DressItem => ({
  key: `fact:${id}`,
  model: "bench",
  x,
  z: 0,
  yaw: 0,
  s: 1,
  sourceId: id,
});

/** Frames of `stepMs` from `t0`; returns the stats per frame. */
function run(
  d: ReturnType<typeof createDressingDriver>,
  focus: [number, number],
  t0: number,
  frames: number,
  stepMs: number,
) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(d.pass(focus, R, t0 + i * stepMs));
  return out;
}

describe("AC-B9 dressing re-plan is a cross-fade, never a pop", () => {
  it("an old plan that leaves the plan keeps drawing (fading out) while the new one fades in", () => {
    const layer = createDressingLayer();
    const d = createDressingDriver(layer);
    d.setPlan([], decor("a", 0, 40));
    run(d, [0, 0], 0, 12, 50); // fully faded in
    expect(layer.stats().decor).toBe(40);
    // the focus moved: a disjoint plan lands; old instances (now far) must not vanish at once
    d.setPlan([], decor("b", 400, 30));
    const frames = run(d, [400, 0], 600, 20, 50);
    expect(frames[0]!.decor).toBeGreaterThan(0); // the old set is still on screen on the swap frame
    expect(frames.every((f) => f.decor > 0)).toBe(true); // never zero across the whole hand-over
    expect(d.retiring()).toBe(0); // and the old set is released once faded
    expect(frames.at(-1)!.decor).toBe(30);
  });

  it("holds through slow frames: a 1 s frame gap cannot empty the bubble (capped step)", () => {
    const layer = createDressingLayer();
    const d = createDressingDriver(layer);
    d.setPlan([], decor("a", 0, 40));
    run(d, [0, 0], 0, 12, 50);
    d.setPlan([], decor("b", 400, 30));
    const a = d.pass([400, 0], R, 600);
    const b = d.pass([400, 0], R, 1600); // 1 s later: step capped at BUBBLE_MAX_STEP_S
    expect(a.decor).toBeGreaterThan(0);
    expect(b.decor).toBeGreaterThan(0);
    expect(BUBBLE_MAX_STEP_S).toBeLessThan(BUBBLE_FADE_S);
  });

  it("the fade lasts at least BUBBLE_FADE_S: old set still drawn just under 0.5 s after the swap", () => {
    const layer = createDressingLayer();
    const d = createDressingDriver(layer, createBubbleFader());
    d.setPlan([], decor("a", 0, 10));
    run(d, [0, 0], 0, 12, 50);
    d.setPlan([], []);
    const f = run(d, [400, 0], 600, 9, 50); // 8 x 50 ms = 0.4 s after the first pass
    expect(f.at(-1)!.decor).toBeGreaterThan(0);
    const g = run(d, [400, 0], 1050, 8, 50);
    expect(g.at(-1)!.decor).toBe(0);
  });

  it("a plan that comes back cancels the retirement of its instances", () => {
    const layer = createDressingLayer();
    const d = createDressingDriver(layer);
    const a = decor("a", 0, 5);
    d.setPlan([], a);
    run(d, [0, 0], 0, 12, 50);
    d.setPlan([], []);
    expect(d.retiring()).toBe(5);
    d.setPlan([], a);
    expect(d.retiring()).toBe(0);
    expect(run(d, [0, 0], 600, 3, 50).at(-1)!.decor).toBe(5);
  });

  it("fact props are data: a decorative re-plan neither retires nor fades them", () => {
    const layer = createDressingLayer();
    const d = createDressingDriver(layer);
    const facts = [fact("f1", 10), fact("f2", 20)];
    d.setPlan(facts, decor("a", 0, 20));
    run(d, [0, 0], 0, 12, 50);
    expect(layer.stats().facts).toBe(2);
    d.setPlan(facts, decor("b", 60, 20));
    expect(d.retiring()).toBe(20); // only decoration retires
    const frames = run(d, [0, 0], 600, 20, 50);
    expect(frames.every((f) => f.facts === 2)).toBe(true);
    expect(layer.group.children.some((m) => m.userData.fact && m.userData.sourceIds.length)).toBe(
      true,
    );
  });
});
