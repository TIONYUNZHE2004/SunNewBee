import { describe, expect, it } from "vitest";
import { BUBBLE_BELOW, placeBubbleBox, smoothBubbleBox, speakerKeepClear } from "./bubblePlacement";
import type { Rect } from "./types";

const area = { w: 1000, h: 800, top: 230 };
const size = { w: 240, h: 100 };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxOf = (p: { left: number; top: number }): Rect => ({ x: p.left, y: p.top, ...size });

describe("bubble placement (AC-C2: never over the speaker or the name tag)", () => {
  it("goes above the speaker and their name tag when there is room", () => {
    const sp = { x: 480, y: 450, w: 30, h: 90 };
    const keep = speakerKeepClear(sp, [495, 450], "Mei Ling");
    const p = placeBubbleBox(keep, size, area);
    expect(p.side).toBe("above");
    // centred on the speaker, its bottom above the name tag
    expect(p.left + size.w / 2).toBeCloseTo(495, 0);
    expect(p.top + size.h).toBeLessThanOrEqual(Math.min(...keep.map((r) => r.y)));
  });

  it("frame 37 / 48: head under the top stack goes beside, never on top of the speaker", () => {
    // gate 2: Mei Ling's rect y 360-458, bubble was pushed down onto her by the old clamp
    const sp = { x: 352, y: 360, w: 36, h: 98 };
    const keep = speakerKeepClear(sp, [370, 360], "Mei Ling");
    const p = placeBubbleBox(keep, size, area);
    expect(p.side).not.toBe("above");
    for (const r of keep) expect(overlaps(boxOf(p), r)).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(area.top);
    expect(p.top + size.h).toBeLessThanOrEqual(area.h - BUBBLE_BELOW);
  });

  it("a speaker at the right edge gets the bubble on the left", () => {
    const sp = { x: 960, y: 300, w: 30, h: 80 };
    const p = placeBubbleBox(speakerKeepClear(sp, null, "Arjun"), size, area);
    expect(p.side).toBe("left");
    expect(p.left + size.w).toBeLessThanOrEqual(sp.x);
  });

  it("stays inside the area and clear of the speaker over a sweep of positions", () => {
    for (let x = 0; x <= 1000; x += 50)
      for (let y = 240; y <= 680; y += 40) {
        const sp = { x, y, w: 20, h: 50 };
        const keep = speakerKeepClear(sp, null, "Pak Cik Halim");
        const p = placeBubbleBox(keep, size, area);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.left + size.w).toBeLessThanOrEqual(area.w);
        expect(p.top).toBeGreaterThanOrEqual(area.top);
        expect(p.top + size.h).toBeLessThanOrEqual(area.h - BUBBLE_BELOW);
        // whenever the speaker itself is inside the area, the bubble never covers them
        if (x >= 30 && x <= 950 && y + 50 <= area.h - BUBBLE_BELOW)
          for (const r of keep) expect(overlaps(boxOf(p), r), `${x},${y}`).toBe(false);
      }
  });

  it("the name tag box sits above the head and grows with the name", () => {
    const sp = { x: 100, y: 300, w: 20, h: 60 };
    const [, a] = speakerKeepClear(sp, [110, 300], "Arjun");
    const [, b] = speakerKeepClear(sp, [110, 300], "Pak Cik Halim");
    expect((a as Rect).y + (a as Rect).h).toBeLessThanOrEqual(sp.y);
    expect((b as Rect).w).toBeGreaterThan((a as Rect).w);
  });

  it("owner fix: keeps the side it is on while that side still fits (no flipping)", () => {
    // room above and to the right: the first choice is above, but a bubble already on the right stays
    const sp = { x: 480, y: 450, w: 30, h: 90 };
    const keep = speakerKeepClear(sp, [495, 450], "Pak Cik Halim");
    expect(placeBubbleBox(keep, size, area).side).toBe("above");
    const kept = placeBubbleBox(keep, size, area, "right");
    expect(kept.side).toBe("right");
    for (const r of keep) expect(overlaps(boxOf(kept), r)).toBe(false);
    // a side that no longer fits is left
    const edge = { x: 900, y: 450, w: 30, h: 90 };
    const k2 = speakerKeepClear(edge, [915, 450], "Pak Cik Halim");
    const p2 = placeBubbleBox(k2, size, area, "right");
    for (const r of k2) expect(overlaps(boxOf(p2), r)).toBe(false);
  });

  it("owner fix: the bubble glides after a moving anchor and never over the speaker", () => {
    let sp = { x: 480, y: 450, w: 30, h: 90 };
    let keep = speakerKeepClear(sp, [495, 450], "Pak Cik Halim");
    let box = placeBubbleBox(keep, size, area);
    // the anchor jitters by +-12 px each 1/60 s frame: the bubble moves far less than the anchor
    let maxStep = 0;
    for (let i = 1; i < 120; i++) {
      const j = i % 2 === 0 ? 12 : -12;
      sp = { x: 480 + j, y: 450 + j / 2, w: 30, h: 90 };
      keep = speakerKeepClear(sp, [495 + j, 450 + j / 2], "Pak Cik Halim");
      const next = smoothBubbleBox(
        box,
        placeBubbleBox(keep, size, area, box.side),
        1 / 60,
        keep,
        size,
      );
      maxStep = Math.max(maxStep, Math.hypot(next.left - box.left, next.top - box.top));
      for (const r of keep) expect(overlaps(boxOf(next), r)).toBe(false);
      box = next;
    }
    expect(maxStep).toBeLessThan(6);
    // paused or a seek (dt <= 0 or a jump): snaps to the target
    const target = placeBubbleBox(keep, size, area);
    expect(smoothBubbleBox({ left: 0, top: 0, side: "above" }, target, 0, keep, size)).toBe(target);
    expect(smoothBubbleBox({ left: 0, top: 0, side: "above" }, target, 3, keep, size)).toBe(target);
    expect(smoothBubbleBox(null, target, 1 / 60, keep, size)).toBe(target);
  });
});
