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

/** Half the active marker sprite's box (CSS px, ~65 px tall at 900 px) the card keeps clear of. */
export const MARKER_KEEP_CLEAR_PX = 34;

/**
 * The viewport with the hero's screen box and the event marker (around its anchor) as rectangles
 * the card keeps clear of: the card never covers the marker it explains (gate AC-D11: moved off
 * her body, the card had landed on the marker).
 */
export function cardViewportWith(
  viewport: CardViewport,
  hero: Rect | null | undefined,
  anchor: { x: number; y: number } | null = null,
): CardViewport {
  const extra: Rect[] = [];
  if (hero) extra.push(hero);
  if (anchor) {
    const r = MARKER_KEEP_CLEAR_PX;
    extra.push({ x: anchor.x - r, y: anchor.y - r, w: 2 * r, h: 2 * r });
  }
  return extra.length
    ? { ...viewport, keepClear: [...(viewport.keepClear ?? []), ...extra] }
    : viewport;
}

/** One coordinate of a locked spot: an offset from the anchor, or a side of a blocker rectangle. */
type Ref = { k: "anchor"; d: number } | { k: "lo" | "hi"; i: number; gap: number };

/**
 * A hold's card spot as a rule (iteration 2: the card switched sides of her within a hold in one
 * frame, 150-190 px, which read as the picture shaking): which way of the anchor or of which
 * blocker (her body, the marker, the mini-map) the card sits, at what scale, under the top band or
 * not. Chosen once per hold from the hold's own geometry (`placementLock`); every frame evaluates
 * it on the live geometry (`placeCardLocked`), so the card glides with her and the marker instead
 * of re-deciding its side.
 */
export interface PlacementLock {
  x: Ref;
  y: Ref;
  scale: number;
  band: boolean;
  side: CardPlacement["side"];
  /** Blockers (keepClear + avoid) the rule was made with: a different set voids the rule. */
  n: number;
}

const blockersOf = (viewport: CardViewport) => [
  ...(viewport.keepClear ?? []),
  ...(viewport.avoid ?? []),
];

/**
 * The rule that reproduces `placeCard`'s spot for this geometry (see `PlacementLock`), or null
 * without an anchor. Blocker sides are preferred over an anchor offset, so a card set beside her
 * stays beside her.
 */
export function placementLock(
  anchor: { x: number; y: number } | null,
  card: { w: number; h: number },
  viewport: CardViewport,
  margin = 12,
): PlacementLock | null {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
  const p = placeCard(anchor, card, viewport, margin);
  const scale = p.scale ?? 1;
  const w = card.w * scale;
  const h = card.h * scale;
  const b = boundsFor({ w, h }, viewport, margin);
  const blockers = blockersOf(viewport);
  const pick = (v: number, axis: "x" | "y"): Ref => {
    const gaps = [KEEP_CLEAR_GAP_PX, axis === "x" ? b.mx : b.my];
    for (let i = 0; i < blockers.length; i++) {
      const r = blockers[i] as Rect;
      for (const gap of gaps) {
        const lo = axis === "x" ? r.x - w - gap : r.y - h - gap;
        const hi = axis === "x" ? r.x + r.w + gap : r.y + r.h + gap;
        if (Math.abs(v - lo) < 0.5) return { k: "lo", i, gap };
        if (Math.abs(v - hi) < 0.5) return { k: "hi", i, gap };
      }
    }
    return { k: "anchor", d: v - (axis === "x" ? anchor.x : anchor.y) };
  };
  return {
    x: pick(p.left, "x"),
    y: pick(p.top, "y"),
    scale,
    band: p.top >= b.minTop - 1e-6,
    side: p.side,
    n: blockers.length,
  };
}

/** Where a locked rule puts the card on this geometry (clamped inside the viewport), or null. */
function ruleSpot(
  anchor: { x: number; y: number },
  card: { w: number; h: number },
  viewport: CardViewport,
  lock: PlacementLock,
  margin: number,
  scale = lock.scale,
): { left: number; top: number; w: number; h: number; scale: number } | null {
  const blockers = blockersOf(viewport);
  if (lock.n !== blockers.length) return null;
  const w = card.w * scale;
  const h = card.h * scale;
  const b = boundsFor({ w, h }, viewport, margin);
  const at = (ref: Ref, axis: "x" | "y"): number | null => {
    if (ref.k === "anchor") return (axis === "x" ? anchor.x : anchor.y) + ref.d;
    const r = blockers[ref.i];
    if (!r) return null;
    if (axis === "x") return ref.k === "lo" ? r.x - w - ref.gap : r.x + r.w + ref.gap;
    return ref.k === "lo" ? r.y - h - ref.gap : r.y + r.h + ref.gap;
  };
  const x = at(lock.x, "x");
  const y = at(lock.y, "y");
  if (x === null || y === null) return null;
  const left = Math.max(b.mx, Math.min(b.maxLeft, x));
  const top = Math.max(lock.band ? b.minTop : b.my, Math.min(b.maxTop, y));
  return { left, top, w, h, scale };
}

const hitsAny = (
  s: { left: number; top: number; w: number; h: number },
  blockers: readonly Rect[],
) =>
  blockers.some(
    (r) => s.left < r.x + r.w && s.left + s.w > r.x && s.top < r.y + r.h && s.top + s.h > r.y,
  );

const finite = (a: { x: number; y: number } | null): a is { x: number; y: number } =>
  !!a && Number.isFinite(a.x) && Number.isFinite(a.y);

/**
 * The spot of a hold's locked rule (`placementLock`) on this geometry, clamped inside the viewport,
 * or null when it would cover a blocker (or the rule does not fit this blocker set).
 */
export function lockedSpot(
  anchor: { x: number; y: number } | null,
  card: { w: number; h: number },
  viewport: CardViewport,
  lock: PlacementLock,
  margin = 12,
): CardPlacement | null {
  if (!finite(anchor)) return null;
  const s = ruleSpot(anchor, card, viewport, lock, margin);
  if (!s) return null;
  const hit = hitsAny(s, blockersOf(viewport));
  return hit
    ? null
    : { left: s.left, top: s.top, side: lock.side, anchored: true, ...scaled(lock.scale) };
}

/**
 * `placeCard` with a hold's locked rule (`placementLock`): the rule's spot on the live geometry
 * when it covers no blocker (`lockedSpot`). When it does (her box or the marker pressed against
 * the viewport edge, mostly while the hold fit eases the camera in), the card first shrinks at the
 * same spot just as much as it needs, down to the smallest KEEP_CLEAR_SCALES (a squeeze that
 * changes with the geometry, never a jump); only then the nearest free spot to it. Without a
 * rule, `placeCard`. Continuous in the anchor and the blockers while the rule holds.
 */
export function placeCardLocked(
  anchor: { x: number; y: number } | null,
  card: { w: number; h: number },
  viewport: CardViewport,
  lock: PlacementLock | null,
  margin = 12,
): CardPlacement {
  if (lock && finite(anchor)) {
    const blockers = blockersOf(viewport);
    const clearAt = (k: number) => {
      const r = ruleSpot(anchor, card, viewport, lock, margin, k);
      return r && !hitsAny(r, blockers) ? r : null;
    };
    const full = ruleSpot(anchor, card, viewport, lock, margin);
    if (full) {
      let spot = hitsAny(full, blockers) ? null : full;
      const least = Math.min(lock.scale, KEEP_CLEAR_SCALES.at(-1) ?? lock.scale);
      if (!spot && clearAt(least)) {
        // the largest clear scale: clear at lo, not at hi
        let lo = least;
        let hi = lock.scale;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          if (clearAt(mid)) lo = mid;
          else hi = mid;
        }
        spot = clearAt(lo);
      }
      if (spot)
        return {
          left: spot.left,
          top: spot.top,
          side: lock.side,
          anchored: true,
          ...scaled(spot.scale),
        };
      // the full-size card's top-left at the rule's spot (keepClearOf scales from its top-left)
      const k = keepClearOf(full.left, full.top, card, viewport, margin);
      return { left: k.left, top: k.top, side: lock.side, anchored: true, ...scaled(k.scale) };
    }
  }
  return placeCard(anchor, card, viewport, margin);
}
