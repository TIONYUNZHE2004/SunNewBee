import { describe, expect, it, vi } from "vitest";
import { fadeMs, startCrossfade } from "./crossfade";
import { paletteFor } from "./palette";

function clock() {
  let t = 0;
  const q: (() => void)[] = [];
  return {
    now: () => t,
    raf: (cb: () => void) => q.push(cb),
    caf: vi.fn(),
    step(ms: number) {
      t += ms;
      const run = q.splice(0);
      for (const cb of run) cb();
    },
  };
}

describe("startCrossfade", () => {
  it("applies intermediate palettes and ends exactly on the target", () => {
    const c = clock();
    const seen: number[] = [];
    const apply = vi.fn((_p, t: number) => seen.push(t));
    startCrossfade(paletteFor("day"), paletteFor("night"), apply, { ms: 2000, ...c });
    for (let i = 0; i < 25; i++) c.step(100);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(apply.mock.calls.at(-1)?.[0]).toEqual(paletteFor("night"));
    expect(seen.some((t) => t > 0.3 && t < 0.7)).toBe(true);
  });
  it("reduced motion applies the target once", () => {
    const apply = vi.fn();
    startCrossfade(paletteFor("day"), paletteFor("dusk"), apply, { reduced: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(paletteFor("dusk"), 1);
  });
  it("cancel stops further frames", () => {
    const c = clock();
    const apply = vi.fn();
    const cancel = startCrossfade(paletteFor("day"), paletteFor("night"), apply, {
      ms: 2000,
      ...c,
    });
    c.step(100);
    cancel();
    const n = apply.mock.calls.length;
    c.step(100);
    expect(apply.mock.calls.length).toBe(n);
  });
  it("a restarted fade (rapid toggles) ends on the last target", () => {
    const c = clock();
    const apply = vi.fn();
    const cancel = startCrossfade(paletteFor("day"), paletteFor("night"), apply, {
      ms: 2000,
      ...c,
    });
    c.step(500);
    cancel();
    startCrossfade(paletteFor("day"), paletteFor("dusk"), apply, { ms: 2000, ...c });
    for (let i = 0; i < 25; i++) c.step(100);
    expect(apply.mock.calls.at(-1)).toEqual([paletteFor("dusk"), 1]);
  });
});

describe("fadeMs", () => {
  it("takes 3 s between Day and Dusk, either way, and 2 s otherwise", () => {
    expect(fadeMs("day", "dusk")).toBe(3000);
    expect(fadeMs("dusk", "day")).toBe(3000);
    expect(fadeMs("day", "night")).toBe(2000);
    expect(fadeMs("dusk", "night")).toBe(2000);
    expect(fadeMs("night", "day")).toBe(2000);
  });
});
