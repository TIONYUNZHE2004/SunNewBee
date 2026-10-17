/** The scroll geometry of a horizontal row (a subset of HTMLElement, so tests can pass plain data). */
export interface RowBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Modifier keys held during the wheel (a subset of WheelEvent). */
export interface Modifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** WheelEvent.deltaMode: 0 pixels, 1 lines (Firefox), 2 pages. */
const LINE_PX = 16;

const maxScroll = (el: RowBox) => Math.max(0, el.scrollWidth - el.clientWidth);

/**
 * New `scrollLeft` for a mostly-vertical wheel over a horizontal row with a hidden scrollbar, or
 * `null` to let the event through (the panel or page scrolls instead): a horizontal gesture, a row
 * that does not overflow, a row already at its end in the wheel's direction, or a modified wheel.
 */
export function wheelScrollLeft(
  el: RowBox,
  dx: number,
  dy: number,
  deltaMode = 0,
  mods: Modifiers = {},
): number | null {
  // Ctrl/Meta + wheel is browser zoom (Chromium also sends trackpad pinch as ctrl + wheel), and
  // Shift + wheel is the native horizontal scroll: never hijack either.
  if (mods.ctrlKey || mods.metaKey || mods.shiftKey) return null;
  if (Math.abs(dy) <= Math.abs(dx)) return null;
  const max = maxScroll(el);
  if (max <= 0) return null;
  if (dy < 0 && el.scrollLeft <= 0) return null;
  if (dy > 0 && el.scrollLeft >= max - 1) return null;
  const step = deltaMode === 1 ? dy * LINE_PX : deltaMode === 2 ? dy * el.clientWidth : dy;
  return Math.min(max, Math.max(0, el.scrollLeft + step));
}

/** Which ends of the row have chips scrolled out of view. */
export function edgeFades(el: RowBox): { start: boolean; end: boolean } {
  const max = maxScroll(el);
  return { start: max > 0 && el.scrollLeft > 1, end: max > 0 && el.scrollLeft < max - 1 };
}

/** A mask that fades only the ends with hidden chips; `undefined` when nothing overflows. */
export function fadeMask({ start, end }: { start: boolean; end: boolean }): string | undefined {
  if (!start && !end) return undefined;
  const a = start ? "transparent, #000 1.5rem" : "#000, #000";
  const b = end ? "#000 calc(100% - 1.5rem), transparent" : "#000, #000";
  return `linear-gradient(to right, ${a}, ${b})`;
}
