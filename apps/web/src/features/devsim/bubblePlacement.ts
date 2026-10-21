import type { Rect } from "./types";

/** Gap between a bubble and the speaker (or name tag) it points at, CSS px. */
export const BUBBLE_GAP = 10;
/** Margin kept from the map area's edges. */
const EDGE = 8;
/** Room kept above the playback bar at the bottom of the map area. */
export const BUBBLE_BELOW = 96;
/** A name tag's box above the speaker's head (`cast.ts`: 11 px system-ui, 1px 8px padding). */
const TAG_H = 22;
const TAG_PAD_W = 18;
const TAG_CHAR_W = 6.8;
/** A bubble's size before it is measured: 15rem wide, two lines and a ROUTE ENGINE tag. */
export const BUBBLE_ESTIMATE = { w: 240, h: 110 } as const;

export type BubbleSide = "above" | "right" | "left" | "below";

export interface BubbleBox {
  /** Top-left corner, stage CSS px. */
  left: number;
  top: number;
  side: BubbleSide;
}

export interface BubbleArea {
  w: number;
  h: number;
  /** The band at the top kept clear (badge, HUD, hypothetical label). */
  top?: number;
}

/**
 * Pure: the screen boxes a speech bubble must never cover: the speaker's body and their name tag
 * (hung centred above the head, `cast.ts`). Stage CSS px.
 */
export function speakerKeepClear(
  speaker: Rect,
  head: readonly [number, number] | null,
  name: string,
): Rect[] {
  const hx = head ? head[0] : speaker.x + speaker.w / 2;
  const tagW = TAG_PAD_W + name.length * TAG_CHAR_W;
  const body: Rect = { x: speaker.x - 4, y: speaker.y - 4, w: speaker.w + 8, h: speaker.h + 8 };
  const tag: Rect = { x: hx - tagW / 2, y: speaker.y - TAG_H - 6, w: tagW, h: TAG_H + 6 };
  return [body, tag];
}

const union = (rs: readonly Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Pure: where a speech bubble of `size` goes (spec §4.3, AC-C2): above the speaker and their name
 * tag, as the prototype draws it; when there is no room there (the top stack, the playback bar or
 * an edge), beside them, then below their feet. A bubble never covers the speaker or the name tag
 * when any of those fits; otherwise the spot that covers the least of them, kept inside the area.
 */
export function placeBubbleBox(
  keepClear: readonly Rect[],
  size: { w: number; h: number },
  area: BubbleArea,
): BubbleBox {
  const sp = union(keepClear);
  const cx = sp.x + sp.w / 2;
  const cy = sp.y + sp.h / 2;
  const minX = EDGE;
  const maxX = area.w - EDGE - size.w;
  const minY = (area.top ?? 0) + EDGE;
  const maxY = area.h - BUBBLE_BELOW - size.h;
  const clampX = (x: number) => Math.max(minX, Math.min(maxX, x));
  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));
  const wants: { side: BubbleSide; left: number; top: number }[] = [
    { side: "above", left: cx - size.w / 2, top: sp.y - BUBBLE_GAP - size.h },
    { side: "right", left: sp.x + sp.w + BUBBLE_GAP, top: cy - size.h / 2 },
    { side: "left", left: sp.x - BUBBLE_GAP - size.w, top: cy - size.h / 2 },
    { side: "below", left: cx - size.w / 2, top: sp.y + sp.h + BUBBLE_GAP },
  ];
  const tried = wants.map((w, i) => {
    // slide to stay in the area; sliding along the side (x above or below, y beside) is free,
    // being pushed towards the speaker is not
    const left = clampX(w.left);
    const top = clampY(w.top);
    const box: Rect = { x: left, y: top, w: size.w, h: size.h };
    const cover = keepClear.reduce((s, r) => s + overlapArea(box, r), 0);
    const vertical = w.side === "above" || w.side === "below";
    const shifted = vertical ? Math.abs(top - w.top) : Math.abs(left - w.left);
    return { box: { left, top, side: w.side }, cover, shifted, i };
  });
  // 1. a side that fits as it is; 2. one that fits once slid along the area; 3. the least cover
  const exact = tried.find((c) => c.cover === 0 && c.shifted < 0.5);
  if (exact) return exact.box;
  const slid = tried
    .filter((c) => c.cover === 0)
    .sort((a, b) => a.shifted - b.shifted || a.i - b.i)[0];
  if (slid) return slid.box;
  const best = [...tried].sort((a, b) => a.cover - b.cover || a.i - b.i)[0];
  return (best ?? tried[0])?.box as BubbleBox;
}
