import { type RefObject, useEffect, useRef } from "react";
import type { CardViewport } from "../journey/cardPlacement";
import { InSlot } from "../map-ui/mapSlots";
import { registerDomProbe, useDevsimAnchors } from "./anchors";
import { Bubble, type BubbleView } from "./Bubble";
import { ERROR_COPY, LOADING_COPY } from "./copy";
import { DevsimHud } from "./DevsimHud";
import { useDevsim } from "./devsimStore";
import { EndCard } from "./EndCard";
import { Envelope, FeedbackBadge } from "./FeedbackBadge";
import { HypotheticalLabel } from "./HypotheticalLabel";
import { NOT_AVAILABLE } from "./intent";
import { PlaybackBar } from "./PlaybackBar";
import { SimBadge } from "./SimBadge";
import { CON, stateAt } from "./timeline";
import type { DevelopmentPlan, Probe, Rect } from "./types";

/** Half the widest bubble (15rem) plus a margin: bubbles stay inside the map area (AC-C2). */
const HALF_W = 128;
/** Room a bubble with its tag needs above its tail point, and the playback bar below. */
const ABOVE = 150;
const BELOW = 96;

/**
 * Pure: where a bubble's tail goes. The speaker's head point, kept inside the map area: clear of
 * the top stack (badge, HUD), the side panel (`vp.w` already excludes it) and the playback bar.
 */
export function placeBubble(
  at: [number, number],
  vp: Pick<CardViewport, "w" | "h" | "top">,
): { x: number; y: number } {
  const x = Math.max(HALF_W, Math.min(vp.w - HALF_W, at[0]));
  const lo = (vp.top ?? 0) + ABOVE;
  const hi = Math.max(lo, vp.h - BELOW);
  return { x, y: Math.max(lo, Math.min(hi, at[1])) };
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
  const labelPoint = useDevsimAnchors((s) => s.labelPoint ?? s.towerTop);
  const badgeRef = useRef<HTMLDivElement>(null);
  const ownStage = useRef<HTMLDivElement>(null);
  const stage = stageRef ?? ownStage;

  useEffect(() => registerDomProbe(() => domProbe(stage.current)), [stage]);

  if (status === "idle") return null;
  if (!plan) {
    const msg =
      status === "unavailable" ? NOT_AVAILABLE : status === "error" ? ERROR_COPY : LOADING_COPY;
    return (
      <InSlot name="sim">
        <p
          role={status === "loading" ? "status" : "alert"}
          data-testid="devsim-status"
          className="glass m-0 rounded-xl px-3 py-2 text-sm text-fg"
        >
          {msg}
        </p>
      </InSlot>
    );
  }
  const st = stateAt(t, plan);
  const views = bubbleViews(plan, t);
  const showLabel = t >= CON[0];
  const anchoredLabel = showLabel && labelPoint ? placeLabel(labelPoint, viewport) : null;
  return (
    <>
      {!stageRef && (
        <div ref={ownStage} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      )}
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
      <div className="pointer-events-none absolute right-[calc(var(--panel-w,0px)+1rem)] top-4 z-20 *:pointer-events-auto">
        <FeedbackBadge ref={badgeRef} count={st.feedbackCount} />
      </div>
      {speakerHead
        ? views.map((b) => <Bubble key={b.n} b={b} at={placeBubble(speakerHead, viewport)} />)
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
          from={speakerHead ? placeBubble(speakerHead, viewport) : null}
          stageRef={stage}
          badgeRef={badgeRef}
        />
      )}
      {st.endCard && (
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
