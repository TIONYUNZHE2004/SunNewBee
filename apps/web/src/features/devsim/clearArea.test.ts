import { describe, expect, it } from "vitest";
import { clipRect, largestClearRect, rectChanged } from "./clearArea";

const map = { x: 0, y: 0, w: 922, h: 800 };
// the V2 captures (1440 x 860, assistant open): the left stack with the hoarding card at 7 s, the
// schedule bar and player, and from 33 s the Impact Brief on the right
const leftStack7 = { x: 16, y: 16, w: 444, h: 484 };
const leftStack36 = { x: 16, y: 16, w: 452, h: 220 };
const bars = { x: 124, y: 588, w: 672, h: 172 };
const residents = { x: 16, y: 492, w: 250, h: 36 };
const brief = { x: 508, y: 0, w: 414, h: 800 };

describe("largestClearRect (V2 fix B-a)", () => {
  it("nothing in the way: the whole map", () => {
    expect(largestClearRect(map, [])).toEqual(map);
  });

  it("7 s: right of the tall left stack and above the bars (not under the HUD stack)", () => {
    const c = largestClearRect(map, [leftStack7, bars]);
    expect(c).toEqual({ x: 460, y: 0, w: 462, h: 588 });
  });

  it("36 s: left of the brief, between the left stack and the residents button / bars", () => {
    const c = largestClearRect(map, [leftStack36, bars, residents, brief]);
    expect(c).toEqual({ x: 0, y: 236, w: 508, h: 256 });
    // it overlaps none of them
    for (const o of [leftStack36, bars, residents, brief])
      expect(clipRect(o, c as typeof map), JSON.stringify(o)).toBeNull();
  });

  it("obstacles outside the map are ignored; a fully covered map has no clear area", () => {
    expect(largestClearRect(map, [{ x: 2000, y: 0, w: 10, h: 10 }])).toEqual(map);
    expect(largestClearRect(map, [{ x: -10, y: -10, w: 2000, h: 2000 }])).toBeNull();
  });

  it("rectChanged ignores sub-pixel jitter", () => {
    expect(rectChanged(map, { ...map, w: map.w + 0.4 })).toBe(false);
    expect(rectChanged(map, { ...map, w: map.w + 1 })).toBe(true);
    expect(rectChanged(null, null)).toBe(false);
    expect(rectChanged(null, map)).toBe(true);
  });
});
