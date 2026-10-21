import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CardViewport } from "../journey/cardPlacement";
import { InSlot } from "../map-ui/mapSlots";
import { registerDomProbe, useDevsimAnchors } from "./anchors";
import { Bubble, type BubbleView } from "./Bubble";
import {
  BUBBLE_BELOW,
  BUBBLE_ESTIMATE,
  type BubbleBox,
  placeBubbleBox,
  smoothBubbleBox,
  speakerKeepClear,
} from "./bubblePlacement";
import { SITE_LABEL } from "./copy";
import { DevsimHud } from "./DevsimHud";
import { DevsimStatusNotice } from "./DevsimStatus";
import { useDevsim } from "./devsimStore";
import { EndCard } from "./EndCard";
import { Envelope, FeedbackBadge } from "./FeedbackBadge";
import { HypotheticalLabel } from "./HypotheticalLabel";
import { PlaybackBar } from "./PlaybackBar";
import { SimBadge } from "./SimBadge";
import { CON, stateAt } from "./timeline";
import type { DevelopmentPlan, Probe, Rect } from "./types";

/** Room kept above the playback bar. */
const BELOW = BUBBLE_BELOW;

/**
 * A bubble anchored at its speaker: measured after each layout, then placed by `placeBubbleBox`
 * above the speaker and their name tag (beside or below when there is no room), never over them.
 */
function AnchoredBubble({
  b,
  keepClear,
  viewport,
  onPlaced,
}: {
  b: BubbleView;
  keepClear: Rect[];
  viewport: CardViewport;
  /** The bubble's centre once placed (the envelope leaves from there). */
  onPlaced?: (n: number, centre: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>(BUBBLE_ESTIMATE);
  const t = useDevsim((s) => s.t);
  const playing = useDevsim((s) => s.playing);
  // the box shown last frame and its screen time: the bubble glides after its anchor while the
  // simulation plays (owner fix: no per-frame jumps) and snaps when paused or after a seek
  const last = useRef<{ t: number; box: BubbleBox } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0 && (Math.abs(w - size.w) > 0.5 || Math.abs(h - size.h) > 0.5))
      setSize({ w, h });
  });
  const prev = last.current;
  const target = placeBubbleBox(keepClear, size, viewport, playing ? prev?.box.side : null);
  const box =
    prev && prev.t === t && playing
      ? prev.box // a re-render within the same frame (new anchors): the next frame glides
      : smoothBubbleBox(
          playing ? (prev?.box ?? null) : null,
          target,
          t - (prev?.t ?? t),
          keepClear,
          size,
        );
  useLayoutEffect(() => {
    last.current = { t, box };
    onPlaced?.(b.n, { x: box.left + size.w / 2, y: box.top + size.h / 2 });
  });
  return <Bubble ref={ref} b={b} at={box} />;
}

/** Pure: the overlay's bubbles at t, with their speakers from the plan's cast. */
export function bubbleViews(plan: DevelopmentPlan, t: number): BubbleView[] {
  return stateAt(t, plan).bubbles.map((b) => {
    const c = plan.cast.find((x) => x.id === b.who);
    const tone = plan.bubbles.find((x) => x.n === b.n)?.tone ?? "pos";
    return {
      n: b.n,
      text: b.text,
      tag: b.tag,
      tone,
      speaker: { name: c?.name ?? b.who, role: c?.role, colour: c?.colour ?? "#888888" },
    };
  });
}

const rectOf = (el: Element | null, origin: DOMRect | undefined): Rect | undefined => {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return undefined;
  return {
    x: r.left - (origin?.left ?? 0),
    y: r.top - (origin?.top ?? 0),
    w: r.width,
    h: r.height,
  };
};

/** The DOM part of `__devsim.probe()`: bubble, hypothetical label and badge rects, stage-relative. */
export function domProbe(
  stage: HTMLElement | null | undefined,
  doc: Document = document,
): Partial<Probe> {
  const origin = stage?.getBoundingClientRect();
  const q = (k: string) => doc.querySelector(`[data-devsim="${k}"]`);
  const rects: Probe["rects"] = {};
  const bubble = rectOf(q("bubble"), origin);
  const label = rectOf(q("hypotheticalLabel"), origin);
  const badge = rectOf(q("simBadge"), origin);
  if (bubble) rects.bubble = bubble;
  if (label) rects.hypotheticalLabel = label;
  if (badge) rects.simBadge = badge;
  return { rects };
}

/**
 * The Development Simulation's DOM overlay (spec §5.3), shown while the devsim store is active:
 * the Simulation badge, HUD and (unanchored) hypothetical label in the map's "sim" slot; the
 * feedback badge at the top right; bubbles at the speaker (3D anchors) or in a fixed stack; the
 * envelope; the end card; and the playback bar. Copy comes from the plan.
 */
export function DevsimOverlay({
  stageRef,
  viewport,
  decorativeNote = true,
  onClose,
}: {
  /** The map stage the anchors and probe rects are relative to. */
  stageRef?: RefObject<HTMLElement | null>;
  /** The map area overlays may use (`useMapInsets`). */
  viewport: CardViewport;
  /** Show "Decorative details are illustrative." here (false when the renderer already shows it). */
  decorativeNote?: boolean;
  onClose?: () => void;
}) {
  const plan = useDevsim((s) => s.plan);
  const t = useDevsim((s) => s.t);
  const status = useDevsim((s) => s.status);
  const speakerHead = useDevsimAnchors((s) => s.speakerHead);
  const speakerRect = useDevsimAnchors((s) => s.speaker);
  const others = useDevsimAnchors((s) => s.others);
  const siteLabel = useDevsimAnchors((s) => s.siteLabel);
  const labelPoint = useDevsimAnchors((s) => s.labelPoint ?? s.towerTop);
  const badgeRef = useRef<HTMLDivElement>(null);
  // where each bubble was last drawn: its envelope leaves from there after the bubble closes
  const bubbleAt = useRef(new Map<number, { x: number; y: number }>());
  const onPlaced = useRef((n: number, c: { x: number; y: number }) => {
    bubbleAt.current.set(n, c);
  }).current;
  const ownStage = useRef<HTMLDivElement>(null);
  const stage = stageRef ?? ownStage;

  useEffect(() => registerDomProbe(() => domProbe(stage.current)), [stage]);

  if (status === "idle") return null;
  if (!plan)
    return (
      <InSlot name="sim">
        <DevsimStatusNotice
          status={status}
          onClose={onClose}
          className="glass rounded-xl px-3 py-2"
        />
      </InSlot>
    );
  const st = stateAt(t, plan);
  const views = bubbleViews(plan, t);
  const latest = views.at(-1);
  const showLabel = t >= CON[0];
  const anchoredLabel = showLabel && labelPoint ? placeLabel(labelPoint, viewport) : null;
  return (
    <>
      {!stageRef && (
        <div ref={ownStage} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      )}
      {/* the bubbles for screen readers: each new one once (the HUD is aria-live off) */}
      <p className="sr-only" aria-live="polite" data-testid="devsim-bubble-live">
        {latest ? `Simulated reaction, ${latest.speaker.name}: ${latest.text}` : ""}
      </p>
      <InSlot name="sim">
        <div data-testid="devsim-overlay" className="flex flex-col items-start gap-2">
          <SimBadge text={plan.labels.simulation} />
          <DevsimHud state={st} />
          {showLabel && !anchoredLabel && <HypotheticalLabel text={plan.labels.hypothetical} />}
          {decorativeNote && (
            <p
              role="note"
              className="m-0 rounded-full border border-edge bg-surface px-3 py-1 text-xs text-fg"
            >
              {plan.labels.decorative}
            </p>
          )}
        </div>
      </InSlot>
      {anchoredLabel && <HypotheticalLabel text={plan.labels.hypothetical} at={anchoredLabel} />}
      {!showLabel && siteLabel && (
        <p
          role="note"
          data-testid="devsim-site-label"
          style={{
            left: `${Math.max(150, Math.min(viewport.w - 150, siteLabel[0]))}px`,
            top: `${Math.max((viewport.top ?? 0) + 60, Math.min(viewport.h - BELOW, siteLabel[1] - 12))}px`,
          }}
          className="pointer-events-none absolute z-20 m-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border-2 border-[#2f7fd1] bg-surface px-3 py-1.5 text-sm font-semibold text-fg shadow-[var(--c-shadow)]"
        >
          <span className="block text-[10px] uppercase tracking-wide text-fg-soft">
            {SITE_LABEL.source}
          </span>
          <span className="block">{SITE_LABEL.text}</span>
        </p>
      )}
      <div className="pointer-events-none absolute right-[calc(var(--panel-w,0px)+1rem)] top-4 z-20 *:pointer-events-auto">
        <FeedbackBadge ref={badgeRef} count={st.feedbackCount} />
      </div>
      {speakerRect
        ? views.map((b) => (
            <AnchoredBubble
              key={b.n}
              b={b}
              keepClear={[
                ...speakerKeepClear(speakerRect, speakerHead, b.speaker.name),
                ...others.flatMap((c) =>
                  speakerKeepClear(
                    c.rect,
                    c.head,
                    plan.cast.find((x) => x.id === c.id)?.name ?? c.id,
                  ),
                ),
              ]}
              viewport={viewport}
              onPlaced={onPlaced}
            />
          ))
        : views.length > 0 && (
            <div
              data-testid="devsim-bubble-stack"
              className="pointer-events-none absolute left-4 z-20 flex flex-col gap-2"
              style={{ top: `${(viewport.top ?? 0) + 12}px` }}
            >
              {views.map((b) => (
                <Bubble key={b.n} b={b} />
              ))}
            </div>
          )}
      {st.envelope && (
        <Envelope
          progress={st.envelope.progress}
          from={
            (st.envelope.from !== undefined ? bubbleAt.current.get(st.envelope.from) : undefined) ??
            (speakerHead ? { x: speakerHead[0], y: speakerHead[1] } : null)
          }
          stageRef={stage}
          badgeRef={badgeRef}
        />
      )}
      {st.endCard && plan.end_card && (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-[calc(var(--panel-w,0px))] z-30 flex items-center justify-end pr-6 *:pointer-events-auto">
          <EndCard card={plan.end_card} />
        </div>
      )}
      <div className="pointer-events-none absolute bottom-[calc(var(--sheet-h,0px)+var(--attr-h,0px)+1rem)] left-4 right-[calc(var(--panel-w,0px)+1rem)] z-20 flex justify-center *:pointer-events-auto">
        <div className="w-full max-w-[42rem]">
          <PlaybackBar onClose={onClose} />
        </div>
      </div>
    </>
  );
}

/** Pure: the hypothetical label's bottom-centre point, kept inside the map area below the top stack. */
export function placeLabel(
  at: [number, number],
  vp: Pick<CardViewport, "w" | "h" | "top">,
): { x: number; y: number } {
  const half = 150;
  return {
    x: Math.max(half, Math.min(vp.w - half, at[0])),
    y: Math.max((vp.top ?? 0) + 60, Math.min(vp.h - BELOW, at[1])),
  };
}
