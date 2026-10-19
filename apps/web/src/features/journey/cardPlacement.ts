/** Gap between the anchor point and the near edge of the card (room for the pointer), CSS px. */
export const CARD_GAP_PX = 26;

/** A screen rectangle in the viewport CSS px (e.g. the mini-map) a card must not cover. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardViewport {
  w: number;
  h: number;
  /** A band at the top kept clear (the Simulation label, HUD and route tag) when the card fits under it. */
  top?: number;
  /** Rectangles the card moves off (left of or below them), when it can stay inside the viewport. */
  avoid?: readonly Rect[];
  /**
   * Rectangles the card must never cover when it can avoid them (the hero's body on screen, D-T5
   * ruling): the card moves to the nearest free spot beside, above or below them, still inside
   * the viewport and off every `avoid` rectangle.
   */
  keepClear?: readonly Rect[];
}

/** Gap kept between the card and a `keepClear` rectangle (CSS px). */
export const KEEP_CLEAR_GAP_PX = 8;

export interface CardPlacement {
  left: number;
  top: number;
  /** Where the card sits relative to its anchor. */
  side: "above" | "below";
  /** False when the anchor was missing (behind the camera, not projected): the card is parked. */
  anchored: boolean;
  /**
   * The card's scale (CSS transform from its top-left corner): below 1 only when no free spot
   * clear of a `keepClear` rectangle exists at full size (the hero's box fills the view).
   */
  scale?: number;
}

/** Card scales tried, in order, when no free spot clear of the hero exists at full size. */
export const KEEP_CLEAR_SCALES: readonly number[] = [0.8, 0.65];

/**
 * Places an event card of `card` size near its projected anchor: centred above it, or below when
 * there is no room above, then clamped so the whole card stays inside the viewport with `margin`
 * (AC-D11). `viewport.top` is a band at the top kept clear (the Simulation label, HUD and route
 * tag) whenever the card fits below it. Without an anchor the card is parked at the bottom centre.
 * A card larger than the viewport is pinned to the top-left corner.
 */
export function placeCard(
  anchor: { x: number; y: number } | null,
  card: { w: number; h: number },
  viewport: CardViewport,
  margin = 12,
): CardPlacement {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const mx = Math.max(0, Math.min(margin, (viewport.w - card.w) / 2));
  const my = Math.max(0, Math.min(margin, (viewport.h - card.h) / 2));
  const maxLeft = Math.max(0, viewport.w - card.w - mx);
  const maxTop = Math.max(0, viewport.h - card.h - my);
  // The top band only counts when the card still fits under it.
  const minTop = Math.min(maxTop, Math.max(my, (viewport.top ?? 0) + my));
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    const k = keepClearOf(
      clamp((viewport.w - card.w) / 2, mx, maxLeft),
      maxTop,
      card,
      viewport,
      margin,
    );
    return { left: k.left, top: k.top, side: "above", anchored: false, ...scaled(k.scale) };
  }
  const above = anchor.y - CARD_GAP_PX - card.h;
  const side = above >= minTop ? "above" : "below";
  let left = clamp(anchor.x - card.w / 2, mx, maxLeft);
  let top = clamp(side === "above" ? above : anchor.y + CARD_GAP_PX, minTop, maxTop);
  for (const r of viewport.avoid ?? []) {
    const hit = left < r.x + r.w && left + card.w > r.x && top < r.y + r.h && top + card.h > r.y;
    if (!hit) continue;
    // Move left of the rectangle, or below it: whichever moves the card less and still fits.
    const options: { left: number; top: number; d: number }[] = [];
    const l2 = r.x - card.w - mx;
    if (l2 >= mx) options.push({ left: l2, top, d: left - l2 });
    const t2 = r.y + r.h + my;
    if (t2 <= maxTop) options.push({ left, top: t2, d: t2 - top });
    const best = options.sort((a, b) => a.d - b.d)[0];
    if (best) {
      left = best.left;
      top = best.top;
    }
  }
  const k = keepClearOf(left, top, card, viewport, margin);
  return { left: k.left, top: k.top, side, anchored: true, ...scaled(k.scale) };
}

const scaled = (k: number) => (k === 1 ? {} : { scale: k });

/** The viewport bounds for a card of size `card` (as `placeCard`). */
function boundsFor(card: { w: number; h: number }, viewport: CardViewport, margin: number) {
  const mx = Math.max(0, Math.min(margin, (viewport.w - card.w) / 2));
  const my = Math.max(0, Math.min(margin, (viewport.h - card.h) / 2));
  const maxLeft = Math.max(0, viewport.w - card.w - mx);
  const maxTop = Math.max(0, viewport.h - card.h - my);
  const minTop = Math.min(maxTop, Math.max(my, (viewport.top ?? 0) + my));
  return { mx, my, minTop, maxLeft, maxTop };
}

const overlapArea = (l: number, t: number, w: number, h: number, r: Rect) =>
  Math.max(0, Math.min(l + w, r.x + r.w) - Math.max(l, r.x)) *
  Math.max(0, Math.min(t + h, r.y + r.h) - Math.max(t, r.y));

/**
 * Moves a card at (left, top) off every `keepClear` rectangle (and still off every `avoid` one):
 * the nearest free spot beside, above or below a blocker inside the viewport (under the top band
 * when possible). With no free spot at full size, the same search at KEEP_CLEAR_SCALES (a smaller
 * card); with none at all, the smallest card where it covers the least of the keepClear boxes.
 * Unchanged when it covers none.
 */
function keepClearOf(
  left: number,
  top: number,
  card: { w: number; h: number },
  viewport: CardViewport,
  margin: number,
): { left: number; top: number; scale: number } {
  const clear = viewport.keepClear ?? [];
  if (!clear.length) return { left, top, scale: 1 };
  const blockers = [...clear, ...(viewport.avoid ?? [])];
  const hits = (l: number, t: number, w: number, h: number) =>
    blockers.some((r) => l < r.x + r.w && l + w > r.x && t < r.y + r.h && t + h > r.y);
  if (!hits(left, top, card.w, card.h)) return { left, top, scale: 1 };
  const g = KEEP_CLEAR_GAP_PX;
  const last = KEEP_CLEAR_SCALES.at(-1) ?? 1;
  let fallback: { left: number; top: number; scale: number; a: number; d: number } | null = null;
  for (const scale of [1, ...KEEP_CLEAR_SCALES]) {
    const w = card.w * scale;
    const h = card.h * scale;
    const b = boundsFor({ w, h }, viewport, margin);
    const l0 = Math.max(b.mx, Math.min(b.maxLeft, left));
    const t0 = Math.max(b.minTop, Math.min(b.maxTop, top));
    const xs = [l0, b.mx, b.maxLeft, ...blockers.flatMap((r) => [r.x - w - g, r.x + r.w + g])];
    const ys = [t0, b.minTop, b.maxTop, ...blockers.flatMap((r) => [r.y - h - g, r.y + r.h + g])];
    for (const minTop of [b.minTop, b.my]) {
      let best: { l: number; t: number; d: number } | null = null;
      for (const x of xs)
        for (const y of ys) {
          if (x < b.mx - 1e-6 || x > b.maxLeft + 1e-6 || y < minTop - 1e-6 || y > b.maxTop + 1e-6)
            continue;
          const d = Math.hypot(x - left, y - top);
          if (!hits(x, y, w, h)) {
            if (!best || d < best.d) best = { l: x, t: y, d };
          } else if (scale === last) {
            const a = clear.reduce((sum, r) => sum + overlapArea(x, y, w, h, r), 0);
            if (
              !fallback ||
              a < fallback.a - 1e-6 ||
              (Math.abs(a - fallback.a) <= 1e-6 && d < fallback.d)
            )
              fallback = { left: x, top: y, scale, a, d };
          }
        }
      // the top band is given up only when no spot under it is free
      if (best) return { left: best.l, top: best.t, scale };
    }
  }
  return fallback ?? { left, top, scale: 1 };
}
