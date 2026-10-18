import { useLayoutEffect, useRef, useState } from "react";
import { DEMO_CHIP, journeyCardContent, withVerificationRequest } from "./cardContent";
import { placeCard } from "./cardPlacement";
import { KIND_COLOUR } from "./kindStyle";
import type { JourneyEvent } from "./timeline";

/** Fallback size before the card is measured (and in jsdom, which has no layout). */
const DEFAULT_SIZE = { w: 290, h: 180 };

/**
 * One event card (spec §6.4), anchored to the event's projected 3D point and clamped fully inside
 * `viewport` (AC-D11). All wording comes from `journeyCardContent`.
 */
export function EventCard({
  event,
  eventIndex,
  anchor,
  viewport,
  vrFiled = false,
}: {
  event: JourneyEvent;
  eventIndex?: number;
  /** Projected anchor in viewport CSS px; null when it is behind the camera. */
  anchor: { x: number; y: number } | null;
  viewport: { w: number; h: number; top?: number };
  vrFiled?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  // Re-measure when the content changes (a new event); the size drives the clamp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure per event, not per frame
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0)
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
  }, [event, vrFiled, viewport.w]);
  const c = withVerificationRequest(journeyCardContent(event), event, vrFiled);
  const p = placeCard(anchor, size, viewport);
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
      style={{ left: `${p.left}px`, top: `${p.top}px` }}
    >
      <span
        className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white"
        style={{ background: KIND_COLOUR[event.kind] }}
      >
        {c.statusLabel}
      </span>
      <h3 className="mb-1 mt-2 text-lg font-bold leading-snug">{c.title}</h3>
      <p className="m-0 text-sm leading-snug text-fg-soft">{c.body}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t-2 border-dashed border-edge pt-2 text-xs text-fg-soft">
        <span data-testid="card-source">{c.source}</span>
        {c.demoChip && (
          <span className="rounded-md bg-[#fff0c9] px-1.5 py-px font-bold text-[#7a5a00]">
            {DEMO_CHIP}
          </span>
        )}
        {event.element_id && (
          <code data-testid="card-element" className="font-mono text-[11px]">
            {event.element_id}
          </code>
        )}
      </div>
    </article>
  );
}
