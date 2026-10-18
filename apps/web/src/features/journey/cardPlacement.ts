/** Gap between the anchor point and the near edge of the card (room for the pointer), CSS px. */
export const CARD_GAP_PX = 26;

export interface CardPlacement {
  left: number;
  top: number;
  /** Where the card sits relative to its anchor. */
  side: "above" | "below";
  /** False when the anchor was missing (behind the camera, not projected): the card is parked. */
  anchored: boolean;
}

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
  viewport: { w: number; h: number; top?: number },
  margin = 12,
): CardPlacement {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const mx = Math.max(0, Math.min(margin, (viewport.w - card.w) / 2));
  const my = Math.max(0, Math.min(margin, (viewport.h - card.h) / 2));
  const maxLeft = Math.max(0, viewport.w - card.w - mx);
  const maxTop = Math.max(0, viewport.h - card.h - my);
  // The top band only counts when the card still fits under it.
  const minTop = Math.min(maxTop, Math.max(my, (viewport.top ?? 0) + my));
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
    return {
      left: clamp((viewport.w - card.w) / 2, mx, maxLeft),
      top: maxTop,
      side: "above",
      anchored: false,
    };
  const above = anchor.y - CARD_GAP_PX - card.h;
  const side = above >= minTop ? "above" : "below";
  const top = side === "above" ? above : anchor.y + CARD_GAP_PX;
  return {
    left: clamp(anchor.x - card.w / 2, mx, maxLeft),
    top: clamp(top, minTop, maxTop),
    side,
    anchored: true,
  };
}
