import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardSourceRow } from "./CardSourceRow";
import { journeyCardContent, withVerificationRequest } from "./cardContent";
import {
  type CardPlacement,
  type CardViewport,
  cardViewportWith,
  type PlacementLock,
  placeCardLocked,
  type Rect,
} from "./cardPlacement";
import { KIND_COLOUR } from "./kindStyle";
import type { JourneyEvent } from "./timeline";

/** Fallback size before the card is measured (and in jsdom, which has no layout). */
const DEFAULT_SIZE = { w: 290, h: 180 };

type Anchor = { x: number; y: number } | null;

/** Moved to `cardPlacement` (shared with the hold rule); re-exported for callers. */
export { MARKER_KEEP_CLEAR_PX } from "./cardPlacement";

const withHero = cardViewportWith;

/** Writes a placement onto the card element (no React commit). */
function applyPlacement(el: HTMLElement, p: CardPlacement, anchor: Anchor) {
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
  el.dataset.side = p.side;
  // a smaller card only when no spot clear of the hero exists at full size
  el.style.transform = p.scale && p.scale !== 1 ? `scale(${p.scale})` : "";
  if (anchor && p.anchored) {
    el.dataset.anchorX = anchor.x.toFixed(1);
    el.dataset.anchorY = anchor.y.toFixed(1);
  } else {
    delete el.dataset.anchorX;
    delete el.dataset.anchorY;
  }
}

/**
 * One event card (spec §6.4), anchored to the event's projected 3D point and clamped fully inside
 * `viewport` (AC-D11). All wording comes from `journeyCardContent`.
 *
 * With `track`, the card follows the camera: it subscribes to rendered frames only while it is
 * mounted (one hold) and re-places itself by writing its own style, so a moving camera costs no
 * React commit (AC-D15).
 *
 * With `lockFor`, the card's spot follows the hold's rule (`holdCardLock`, chosen once from the
 * hold's own geometry): it glides with the marker and her instead of switching sides of her in
 * one frame (iteration 2), and stays a pure function of t, the viewport and her box.
 */
export function EventCard({
  event,
  eventIndex,
  anchor,
  viewport,
  vrFiled = false,
  track,
  keepClear,
  lockFor,
}: {
  event: JourneyEvent;
  eventIndex?: number;
  /** Projected anchor in viewport CSS px; null when it is behind the camera. */
  anchor: Anchor;
  viewport: CardViewport;
  vrFiled?: boolean;
  track?: { project: () => Anchor; subscribe: (cb: () => void) => () => void };
  /** The hero's body on screen (viewport CSS px), which the card never covers when it can avoid it. */
  keepClear?: () => Rect | null;
  /** The hold's card rule for a card size and viewport (pure; cached by the caller), or null. */
  lockFor?: (card: { w: number; h: number }, viewport: CardViewport) => PlacementLock | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  // Re-measure when the content changes (a new event); the size drives the clamp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure per event, not per frame
  useLayoutEffect(() => {
    // the layout size (offset*), not the box on screen: a card shrunk by the hero keep-clear
    // (CSS scale) must not become the new full size
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
  }, [event, vrFiled, viewport.w]);

  const latest = useRef({ size, viewport, track, keepClear, lockFor });
  latest.current = { size, viewport, track, keepClear, lockFor };
  const subscribe = track?.subscribe;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe(() => {
      const el = ref.current;
      const l = latest.current;
      if (!el || !l.track) return;
      const a = l.track.project();
      const lock = l.lockFor?.(l.size, l.viewport) ?? null;
      applyPlacement(
        el,
        placeCardLocked(a, l.size, withHero(l.viewport, l.keepClear?.(), a), lock),
        a,
      );
    });
  }, [subscribe]);

  const c = withVerificationRequest(journeyCardContent(event), event, vrFiled);
  const p = placeCardLocked(
    anchor,
    size,
    withHero(viewport, keepClear?.(), anchor),
    lockFor?.(size, viewport) ?? null,
  );
  return (
    <article
      ref={ref}
      data-testid="journey-card"
      data-event-index={eventIndex}
      data-side={p.side}
      data-anchor-x={anchor && p.anchored ? anchor.x.toFixed(1) : undefined}
      data-anchor-y={anchor && p.anchored ? anchor.y.toFixed(1) : undefined}
      aria-live="polite"
      className="glass pointer-events-none absolute z-30 w-[min(290px,calc(100vw-2rem))] rounded-2xl px-4 pb-3 pt-3 text-fg shadow-lg"
      style={{
        left: `${p.left}px`,
        top: `${p.top}px`,
        transformOrigin: "top left",
        transform: p.scale && p.scale !== 1 ? `scale(${p.scale})` : undefined,
      }}
    >
      <span
        className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white"
        style={{ background: KIND_COLOUR[event.kind] }}
      >
        {c.statusLabel}
      </span>
      <h3 className="mb-1 mt-2 text-lg font-bold leading-snug">{c.title}</h3>
      <p className="m-0 text-sm leading-snug text-fg-soft">{c.body}</p>
      <CardSourceRow
        content={c}
        elementId={event.element_id}
        className="mt-2.5 border-t-2 border-dashed border-edge pt-2"
      />
    </article>
  );
}
