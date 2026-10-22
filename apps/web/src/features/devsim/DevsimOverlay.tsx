import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CardViewport } from "../journey/cardPlacement";
import { InSlot } from "../map-ui/mapSlots";
import { registerDomProbe, useDevsimAnchors } from "./anchors";
import { Bubble, type BubbleView } from "./Bubble";
import { BuildBanner, HoardingCard, TimedTagCard } from "./BuildCards";
import {
  BUBBLE_BELOW,
  BUBBLE_ESTIMATE,
  type BubbleBox,
  placeBubbleBox,
  smoothBubbleBox,
  speakerKeepClear,
} from "./bubblePlacement";
import { bannersAt, hoardingCardOn, hudAt, tagsAt } from "./buildModel";
import { SITE_LABEL } from "./copy";
import { EstimateHud, MoveInCounter } from "./DevsimHud";
import { DevsimStatusNotice } from "./DevsimStatus";
import { useDevsim } from "./devsimStore";
import { HypotheticalLabel } from "./HypotheticalLabel";
import { ImpactBrief } from "./ImpactBrief";
import { PlaybackBar } from "./PlaybackBar";
import { ResidentsLayer } from "./residents/ResidentsLayer";
import { ScheduleBar } from "./ScheduleBar";
import { SimBadge } from "./SimBadge";
import { BUILD_T, ease, isBuildPlan, stateAt } from "./timeline";
import type { DevelopmentPlan, Probe, Rect } from "./types";

/** Room kept above the playback bar. */
const BELOW = BUBBLE_BELOW;

/**
 * A bubble anchored at its speaker: measured after each layout, then placed by `placeBubbleBox`
 * above the speaker and their name tag (beside or below when there is no room), never over them.
 */
function AnchoredBubble({
  b,
  anchor,
  keepClear,
  viewport,
  onPlaced,
}: {
  b: BubbleView;
  /** The bubble's own speaker and name tag (it points at these). */
  anchor: Rect[];
  /** Everything it keeps off: its speaker, the other speakers and listeners. */
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
  const target = placeBubbleBox(keepClear, size, viewport, playing ? prev?.box.side : null, anchor);
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
      who: b.who,
      text: b.text,
      tag: b.tag,
      tone,
      speaker: { name: c?.name ?? b.who, role: c?.role, colour: c?.colour ?? "#888888" },
    };
  });
}

/** A speaker's screen anchor from the 3D view. */
export interface SpeakerAnchor {
  id: string;
  rect: Rect;
  head: readonly [number, number] | null;
}

/**
 * Pure: each bubble with its own speaker's anchor (`speakers`, else the first bubble's `speaker`
 * rect for its speaker), and the boxes it keeps clear: its speaker, every other speaker and the
 * listeners (`others`). A bubble whose speaker is not drawn has no anchor (it goes to the stack).
 */
export function anchorBubbles(
  views: readonly BubbleView[],
  a: {
    speaker: Rect | null;
    speakerHead: readonly [number, number] | null;
    speakers?: readonly SpeakerAnchor[];
    others: readonly SpeakerAnchor[];
  },
  nameOf: (id: string) => string,
): { b: BubbleView; anchor: Rect[] | null; keepClear: Rect[] }[] {
  const own = new Map<string, SpeakerAnchor>();
  for (const s of a.speakers ?? []) own.set(s.id, s);
  const first = views[0];
  if (first && a.speaker && !own.has(first.who))
    own.set(first.who, { id: first.who, rect: a.speaker, head: a.speakerHead });
  const boxes = (s: SpeakerAnchor, name: string) => speakerKeepClear(s.rect, s.head, name);
  const listeners = a.others.filter((o) => !own.has(o.id)).flatMap((o) => boxes(o, nameOf(o.id)));
  return views.map((b) => {
    const mine = own.get(b.who);
    if (!mine) return { b, anchor: null, keepClear: [] };
    const anchor = boxes(mine, b.speaker.name);
    const rest = [...own.values()]
      .filter((s) => s.id !== b.who)
      .flatMap((s) => boxes(s, nameOf(s.id)));
    return { b, anchor, keepClear: [...anchor, ...rest, ...listeners] };
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
  const brief = rectOf(q("brief"), origin);
  if (brief) rects.brief = brief;
  if (bubble) rects.bubble = bubble;
  if (label) rects.hypotheticalLabel = label;
  if (badge) rects.simBadge = badge;
  return { rects };
}

/**
 * Room under the schedule and playback bars: the map's bottom-left notes slot (the renderer's
 * "Decorative details are illustrative." pill, 1 rem up) stays clear of them.
 */
const BARS_BOTTOM = "3.25rem";

/** The Impact Brief slides in over this long from 33 s (prototype `#brief` transition). */
const BRIEF_SLIDE_S = 0.5;
/** The brief's width before it is measured (prototype 440 px; 26 rem here). */
const BRIEF_W_ESTIMATE = 416;

/** Pure: how far (CSS px) the 3D look point moves left at t so the tower clears the brief. */
export function briefViewShift(t: number, briefW: number): number {
  if (t < BUILD_T.brief) return 0;
  return ease((t - BUILD_T.brief) / BUILD_T.briefShiftS) * briefW;
}

/**
 * The Development Simulation's DOM overlay (spec §5.3; demo polish §6.2, §6.3), shown while the
 * devsim store is active: the Simulation badge, the hypothetical label (throughout), the estimate
 * HUD and the timed cards in the map's "sim" slot; set-piece banners; bubbles at the speaker (3D
 * anchors) or in a fixed stack; the simulated residents from 33 s; the Impact Brief from 33 s (the
 * 3D view shifts left of it); the schedule bar and the playback bar. Copy comes from the plan.
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
  const playing = useDevsim((s) => s.playing);
  const status = useDevsim((s) => s.status);
  const speakerHead = useDevsimAnchors((s) => s.speakerHead);
  const speakerRect = useDevsimAnchors((s) => s.speaker);
  const speakers = useDevsimAnchors((s) => s.speakers);
  const others = useDevsimAnchors((s) => s.others);
  const siteLabel = useDevsimAnchors((s) => s.siteLabel);
  const tagPoints = useDevsimAnchors((s) => s.tagPoints);
  const labelPoint = useDevsimAnchors((s) => s.labelPoint ?? s.towerTop);
  const ownStage = useRef<HTMLDivElement>(null);
  const stage = stageRef ?? ownStage;
  const briefRef = useRef<HTMLElement>(null);
  const [briefW, setBriefW] = useState(BRIEF_W_ESTIMATE);
  // only the 45 s building plan has a schedule, brief and banners (a legacy plan plays bare)
  const build = !!plan && isBuildPlan(plan);
  const briefOn = build && t >= BUILD_T.brief;

  useEffect(() => registerDomProbe(() => domProbe(stage.current)), [stage]);
  useLayoutEffect(() => {
    const w = briefRef.current?.offsetWidth ?? 0;
    if (briefOn && w > 0 && Math.abs(w - briefW) > 0.5) setBriefW(w);
  });
  // the tower stays clear of the brief: the engine's view offset moves the look point left
  const shift = briefOn ? briefViewShift(t, briefW) : 0;
  useEffect(() => {
    useDevsim.getState().setViewShift(shift);
  }, [shift]);
  useEffect(() => () => useDevsim.getState().setViewShift(0), []);

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
  const views = bubbleViews(plan, t);
  const placed = anchorBubbles(
    views,
    { speaker: speakerRect, speakerHead, speakers, others },
    (id) => plan.cast.find((x) => x.id === id)?.name ?? id,
  );
  const stacked = placed.filter((p) => !p.anchor).map((p) => p.b);
  const latest = views.at(-1);
  const hud = build ? hudAt(plan, t) : null;
  const banners = build ? bannersAt(plan, t) : [];
  // a banner holds the top centre: the anchored label keeps below it, so it stays readable (AC-W9)
  const anchoredLabel = labelPoint
    ? placeLabel(labelPoint, viewport, banners.length > 0 ? BANNER_CLEAR : 0)
    : null;
  const tags = build ? tagsAt(plan, t) : [];
  const slide = briefOn ? 1 - ease((t - BUILD_T.brief) / BRIEF_SLIDE_S) : 1;
  const rightOfBars = `calc(var(--panel-w,0px) + 1rem + ${briefOn ? briefW : 0}px)`;
  const site = t < BUILD_T.construction[0] ? siteLabel : null;
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
          {!anchoredLabel && <HypotheticalLabel text={plan.labels.hypothetical} />}
          {hud && (
            <EstimateHud schedule={plan.schedule} at={hud.at} sources={plan.estimate_sources} />
          )}
          {hud?.moveIn && <MoveInCounter n={hud.moveIn.n} homes={hud.moveIn.homes} />}
          {build && hoardingCardOn(plan, t) && <HoardingCard plan={plan} />}
          {tags
            .filter((g) => !tagPoints?.[g.kind])
            .map((g) => (
              <TimedTagCard key={g.kind} tag={g} />
            ))}
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
      {tags.map((g) => {
        const at = tagPoints?.[g.kind];
        return at ? <TimedTagCard key={g.kind} tag={g} at={at} /> : null;
      })}
      {site && (
        <p
          role="note"
          data-testid="devsim-site-label"
          data-beat="brief-overview"
          style={{
            left: `${Math.max(150, Math.min(viewport.w - 150, site[0]))}px`,
            top: `${Math.max((viewport.top ?? 0) + 60, Math.min(viewport.h - BELOW, site[1] - 12))}px`,
          }}
          className="pointer-events-none absolute z-20 m-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border-2 border-[#2f7fd1] bg-surface px-3 py-1.5 text-sm font-semibold text-fg shadow-[var(--c-shadow)]"
        >
          <span className="block text-[10px] uppercase tracking-wide text-fg-soft">
            {SITE_LABEL.source}
          </span>
          <span className="block">{SITE_LABEL.text}</span>
        </p>
      )}
      {banners.length > 0 && (
        <div
          className="pointer-events-none absolute z-30 flex -translate-x-1/2 flex-col items-center gap-2"
          style={{
            top: `${(viewport.top ?? 0) + 12}px`,
            left: "calc((100% - var(--panel-w,0px)) / 2)",
          }}
        >
          {banners.map((b) => (
            <div key={b.kind} className="pointer-events-auto">
              <BuildBanner banner={b} plan={plan} />
            </div>
          ))}
        </div>
      )}
      {placed
        .filter((p) => p.anchor)
        .map((p) => (
          <AnchoredBubble
            key={p.b.n}
            b={p.b}
            anchor={p.anchor as Rect[]}
            keepClear={p.keepClear}
            viewport={viewport}
          />
        ))}
      {stacked.length > 0 && (
        <div
          data-testid="devsim-bubble-stack"
          className="pointer-events-none absolute z-20 flex flex-col items-end gap-2"
          style={{ top: `${(viewport.top ?? 0) + 12}px`, right: rightOfBars }}
        >
          {stacked.map((b) => (
            <Bubble key={b.n} b={b} />
          ))}
        </div>
      )}
      {briefOn && (
        <div
          className="pointer-events-none absolute left-4 z-30 flex flex-col justify-end *:pointer-events-auto"
          style={{
            bottom: `calc(var(--sheet-h,0px) + var(--attr-h,0px) + ${BARS_BOTTOM} + 13.5rem)`,
            top: `${(viewport.top ?? 0) + 12}px`,
          }}
        >
          <ResidentsLayer data={plan.residents} t={t} playing={playing} />
        </div>
      )}
      {briefOn && (
        <div
          className="pointer-events-auto absolute inset-y-0 z-30"
          style={{
            right: "var(--panel-w,0px)",
            width: "min(26rem, calc(100% - var(--panel-w,0px) - 2rem))",
            transform: `translateX(${(slide * 110).toFixed(2)}%)`,
          }}
        >
          <ImpactBrief ref={briefRef} plan={plan} />
        </div>
      )}
      <div
        className="pointer-events-none absolute left-4 z-20 flex justify-center *:pointer-events-auto"
        style={{
          right: rightOfBars,
          bottom: `calc(var(--sheet-h,0px) + var(--attr-h,0px) + ${BARS_BOTTOM})`,
        }}
      >
        <div className="flex w-full max-w-[42rem] flex-col gap-2">
          {hud && <ScheduleBar schedule={plan.schedule} month={hud.month} />}
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
  /** Extra room kept at the top (a banner is on screen). */
  clearTop = 0,
): { x: number; y: number } {
  const half = 150;
  return {
    x: Math.max(half, Math.min(vp.w - half, at[0])),
    y: Math.max((vp.top ?? 0) + 60 + clearTop, Math.min(vp.h - BELOW, at[1])),
  };
}

/** Room a set-piece banner takes at the top centre (two lines of text plus its margin). */
const BANNER_CLEAR = 96;
