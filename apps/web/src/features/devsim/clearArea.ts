import type { Rect } from "./types";

/**
 * The map area the Development Simulation's overlays leave clear (V2 fix B-a): the camera beats
 * frame their subject there, not under the left overlay stack, the Impact Brief, the schedule and
 * playback bars, the residents button or the assistant panel. All CSS px relative to the map stage.
 */

/** The overlays the clear area avoids (their elements' boxes; each selector may match several). */
export const OBSTACLE_SELECTORS = [
  // the map's top stack (brand pill, simulation badge, HUD and timed cards: one box per slot child)
  '[data-testid="top-stack"] [data-slot] > *',
  // the map's bottom stack (place card, the decorative note)
  '[data-testid="bottom-stack"] [data-slot] > *',
  '[data-devsim="brief"]',
  '[data-devsim="bars"]',
  '[data-devsim="residents"] > *',
] as const;

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

/** `r` clipped to `b`, or null when they do not overlap with a positive area. */
export function clipRect(r: Rect, b: Rect): Rect | null {
  const x0 = Math.max(r.x, b.x);
  const y0 = Math.max(r.y, b.y);
  const x1 = Math.min(right(r), right(b));
  const y1 = Math.min(bottom(r), bottom(b));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Pure: the largest axis-aligned rectangle inside `bounds` that overlaps none of `obstacles`
 * (ties: the first found, top first). Every horizontal band between two obstacle edges is tried,
 * with the widest free run across it. `bounds` itself when nothing is in the way; null when the
 * obstacles cover it all.
 */
export function largestClearRect(bounds: Rect, obstacles: readonly Rect[]): Rect | null {
  const obs = obstacles.flatMap((o) => {
    const c = clipRect(o, bounds);
    return c ? [c] : [];
  });
  if (obs.length === 0) return bounds.w > 0 && bounds.h > 0 ? { ...bounds } : null;
  const ys = [...new Set([bounds.y, bottom(bounds), ...obs.flatMap((o) => [o.y, bottom(o)])])].sort(
    (a, b) => a - b,
  );
  let best: Rect | null = null;
  let bestArea = 0;
  for (let i = 0; i < ys.length; i++) {
    for (let j = i + 1; j < ys.length; j++) {
      const y0 = ys[i] as number;
      const y1 = ys[j] as number;
      const h = y1 - y0;
      if (h * bounds.w <= bestArea) continue;
      const blocked = obs
        .filter((o) => o.y < y1 && bottom(o) > y0)
        .map((o) => [o.x, right(o)] as const)
        .sort((a, b) => a[0] - b[0]);
      let x = bounds.x;
      const runs: [number, number][] = [];
      for (const [a, b] of blocked) {
        if (a > x) runs.push([x, a]);
        x = Math.max(x, b);
      }
      if (right(bounds) > x) runs.push([x, right(bounds)]);
      for (const [a, b] of runs) {
        const area = (b - a) * h;
        if (area > bestArea) {
          bestArea = area;
          best = { x: a, y: y0, w: b - a, h };
        }
      }
    }
  }
  return best;
}

/** The boxes of `selectors`' elements relative to `stage` (empty and hidden ones left out). */
export function obstacleRects(
  stage: Element,
  selectors: readonly string[] = OBSTACLE_SELECTORS,
): Rect[] {
  const o = stage.getBoundingClientRect();
  const out: Rect[] = [];
  for (const sel of selectors)
    for (const el of stage.ownerDocument.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
    }
  return out;
}

const cssPx = (el: Element, name: string) => {
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
};

/**
 * The clear map area at `stage` now: the stage less the side panel's overlap (`--panel-w`), the
 * phone sheet and the attribution strip (`--sheet-h`, `--attr-h`), and less every overlay box.
 */
export function measureClearArea(stage: HTMLElement): Rect | null {
  const r = stage.getBoundingClientRect();
  const bounds: Rect = {
    x: 0,
    y: 0,
    w: Math.max(0, r.width - cssPx(stage, "--panel-w")),
    h: Math.max(0, r.height - cssPx(stage, "--sheet-h") - cssPx(stage, "--attr-h")),
  };
  if (bounds.w <= 0 || bounds.h <= 0) return null;
  return largestClearRect(bounds, obstacleRects(stage));
}

/** True when two clear rects differ by more than half a CSS px on any edge. */
export function rectChanged(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.x - b.x) > 0.5 ||
    Math.abs(a.y - b.y) > 0.5 ||
    Math.abs(a.w - b.w) > 0.5 ||
    Math.abs(a.h - b.h) > 0.5
  );
}
