import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { InSlot } from "../../map-ui/mapSlots";
import { CompareControls } from "../CompareControls";
import { compareTimelineOf, type ScreenPoint, useCompare } from "../compareStore";
import { type BeatId, type BeatSide, compareStateAt, FLIGHT_S } from "../compareTimeline";
import { isPlayableCompare } from "../compareTypes";
import { SimulationLabel } from "../SimulationLabel";
import { useCompareDriver } from "../useCompareDriver";
import { ComparePills } from "./ComparePills";
import {
  fastestPill,
  fastestTag,
  flightCard,
  greetingFor,
  poiTag,
  queryChip,
  recommendedPill,
  recommendedPillNote,
  stopTag,
  type TagCopy,
  uncheckedTagParts,
} from "./copy";
import { GreetingBubble } from "./GreetingBubble";
import { PoiTag, stackTags, tagSizeEstimate } from "./PoiTag";
import { ReasonsCard } from "./ReasonsCard";
import { TicketFlight } from "./TicketFlight";
import { TicketsChip } from "./TicketsChip";
import { TicketToast } from "./TicketToast";

/** `top`: the bottom edge of the map's top stack (brand pill), CSS px of the stage; 0 without one. */
type Size = { w: number; h: number; panel: number; top: number };

const topStackOf = (el: HTMLElement) =>
  el.ownerDocument.querySelector<HTMLElement>('[data-testid="top-stack"]');

function measure(el: HTMLElement | null): Size {
  if (!el) return { w: 0, h: 0, panel: 0, top: 0 };
  const r = el.getBoundingClientRect();
  const panel = Number.parseFloat(getComputedStyle(el).getPropertyValue("--panel-w")) || 0;
  const stack = topStackOf(el)?.getBoundingClientRect();
  const top = stack && stack.height > 0 ? Math.max(0, Math.round(stack.bottom - r.top)) : 0;
  return { w: r.width, h: r.height, panel, top };
}

/** The split pills' top edge (CSS px of the stage): below the map's top stack, never above 64 px. */
export function pillTop(stackBottom: number): number {
  return Math.max(64, Math.round(stackBottom + 8));
}

/** The reasons card's width: the prototype's 760 px, inside the visible map with 1 rem each side. */
export function reasonsWidth(visibleW: number): number {
  return Math.max(0, Math.min(760, Math.round(visibleW - 32)));
}

/**
 * The compare playback's DOM overlay over the 3D map (spec §5.3, §5.4): split pills and divider,
 * POI / stop / unchecked tags, the greeting, the ticket flight, Tickets chip and toast, and the
 * reasons card. Every element carries `data-beat` (beat ids of `compareTimeline.ts`).
 * Positions come from the renderer's `useCompare().screen`; without one (before the renderer's
 * first frame, or none) tags stack in their half's column, so the beats still show in order.
 * It also mounts the playback's frame driver, so playback runs while the chat panel is closed.
 */
export function CompareOverlay() {
  useCompareDriver();
  const payload = useCompare((s) => s.payload);
  const t = useCompare((s) => s.t);
  const reduced = useCompare((s) => s.reduced);
  const screen = useCompare((s) => s.screen);
  const qc = useQueryClient();
  const host = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const chipCount = useRef<HTMLSpanElement>(null);
  const [chipAt, setChipAt] = useState<ScreenPoint | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0, panel: 0, top: 0 });
  const playable = isPlayableCompare(payload);
  const st = playable ? compareStateAt(compareTimelineOf(payload), t, { reduced }) : null;
  const tickets = st?.counters.tickets ?? 0;
  const reasonsOn = !!st?.beats.includes("reasons");

  useLayoutEffect(() => {
    if (!playable) return;
    const el = host.current;
    setSize(measure(el));
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize(measure(el)));
    ro.observe(el);
    const stack = topStackOf(el);
    if (stack) ro.observe(stack);
    return () => ro.disconnect();
  }, [playable]);

  // the ticket lands: the Rail badge and /tickets refetch (the VR was filed by the tool)
  const lastTickets = useRef(0);
  useEffect(() => {
    if (tickets > lastTickets.current) void qc.invalidateQueries({ queryKey: ["tickets"] });
    lastTickets.current = tickets;
  }, [tickets, qc]);

  // AC-N7: the reasons card's top edge, for the renderer's overview fit and the hook; and the
  // player dock's top, which the card always sits above (the overview keeps clear of both)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when the map resizes
  useLayoutEffect(() => {
    const st = useCompare.getState();
    const origin = host.current?.getBoundingClientRect().top;
    const d = dock.current?.getBoundingClientRect();
    st.setDockTop(origin !== undefined && d && d.height > 0 ? d.top - origin : null);
    if (!reasonsOn || !card.current || origin === undefined) {
      st.setCardTop(null);
      return;
    }
    st.setCardTop(card.current.getBoundingClientRect().top - origin);
  }, [reasonsOn, size, playable]);
  useEffect(
    () => () => {
      useCompare.getState().setCardTop(null);
      useCompare.getState().setDockTop(null);
    },
    [],
  );

  // the ticket flight lands on the chip's counter: measured (map slot px), not guessed
  const chipOn = !!st?.beats.includes("tickets-chip");
  const flying = !!st?.beats.includes("ticket-flight");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when the map resizes or a flight starts
  useLayoutEffect(() => {
    const el = chipCount.current;
    const h = host.current;
    if (!chipOn || !el || !h) {
      setChipAt(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const o = h.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return setChipAt(null);
    const next = { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top };
    setChipAt((p) => (p && p.x === next.x && p.y === next.y ? p : next));
  }, [chipOn, flying, size]);

  if (!playable || !st) return null;
  const c = payload;
  const tl = compareTimelineOf(c);
  const on = new Set<BeatId>(st.beats);
  const split = st.camera === "split";
  const visW = Math.max(0, size.w - size.panel);
  const vp = screen?.viewports ?? null;
  const pillsTop = pillTop(size.top);
  const halfCentre = (side: "L" | "R"): ScreenPoint => {
    const v = vp ? (side === "L" ? vp.left : vp.right) : null;
    return v
      ? { x: v.x + v.w / 2, y: size.h * 0.4 }
      : { x: (side === "L" ? 0.25 : 0.75) * visW, y: size.h * 0.4 };
  };
  const point = (id: BeatId): ScreenPoint | null => screen?.pois[id] ?? null;

  // the tags on screen now: [beat, side, copy]
  const tags: [BeatId, BeatSide, TagCopy][] = [];
  if (split)
    for (const b of tl.beats) {
      if (!on.has(b.id)) continue;
      let copy: TagCopy | null = null;
      if (b.id === "tag-fastest") copy = fastestTag(c);
      else if (b.id === "tag-stop") copy = stopTag(c);
      else if (b.id === "tag-unchecked") {
        const u = uncheckedTagParts(c);
        copy = u ? { key: u.key, text: u.text, note: u.note, tone: "unknown" } : null;
      } else if (b.id === "arrive")
        copy =
          b.poi !== undefined
            ? poiTag(c, b.poi)
            : { key: "Arrived", text: c.to_place.name || c.to_place.id, tone: "ok" };
      else if (b.poi !== undefined) copy = poiTag(c, b.poi);
      if (copy) tags.push([b.id, b.side, copy]);
    }
  const greeting =
    split && on.has("greeting") ? greetingFor(`${c.from_place.id}>${c.to_place.id}`) : null;
  const unplaced = (side: BeatSide) => tags.filter(([id, s]) => s === side && !point(id));
  const column = (side: "L" | "R") => {
    const items = unplaced(side);
    const g = side === "R" && greeting && !point("greeting");
    if (!items.length && !g) return null;
    const v = vp ? (side === "L" ? vp.left : vp.right) : null;
    const half = "calc((100% - var(--panel-w,0px)) / 2)";
    return (
      <div
        className="absolute flex flex-col items-center gap-2"
        style={{
          top: pillsTop + 48,
          ...(v ? { left: v.x, width: v.w } : { left: side === "L" ? 0 : half, width: half }),
        }}
      >
        {g && greeting && <GreetingBubble text={greeting} at={null} />}
        {items.map(([id, , copy]) => (
          <PoiTag key={id} beat={id} copy={copy} at={null} />
        ))}
      </div>
    );
  };
  // anchored tags never cover each other (R28: kerb and covered walkway at 4.5–7 s)
  const anchored = tags.filter(([id]) => point(id));
  const lifts = stackTags(
    anchored.map(([id, , copy]) => ({
      id,
      at: point(id) as ScreenPoint,
      size: tagSizeEstimate(copy),
    })),
  );
  const fc = flightCard(c);
  const from = screen?.unchecked ?? point("tag-unchecked") ?? halfCentre("R");
  // fallback before the chip has been measured (first frame, or no layout): its usual place
  const to = chipAt ?? { x: visW - 16 - 40, y: 30 };
  const bump =
    tl.flightAt !== null && t >= tl.flightAt + FLIGHT_S && t < tl.flightAt + FLIGHT_S + 0.6;

  return (
    <>
      {/* V2 fix N-a / N-c: the compare's own chrome sits in the map's bottom stack (above the
          decorative note and the attribution, scrolling there if it must), not in the top stack
          over the left pill: the reasons card, then one player (label, controls, Exit trip). */}
      <InSlot name="card">
        <div data-testid="compare-overlay" className="flex flex-col items-start gap-2">
          {reasonsOn && (
            <ReasonsCard
              ref={card}
              compare={c}
              style={{ width: reasonsWidth(visW) || undefined }}
              className="max-w-full rounded-[20px] shadow-[0_4px_0_var(--c-edge),0_18px_40px_rgba(44,42,58,.22)]"
            />
          )}
          {on.has("intro") && (
            <p
              data-beat="intro"
              className="glass m-0 rounded-full px-3 py-1 text-xs font-semibold text-fg-soft"
            >
              {queryChip(c)}
            </p>
          )}
          {/* one row: the label, then the one player (play, restart, scrub, Exit trip) */}
          <div
            ref={dock}
            data-testid="compare-dock"
            className="flex max-w-full flex-wrap items-center gap-2"
          >
            <SimulationLabel />
            <div className="glass max-w-full rounded-full px-2 py-1.5" style={{ width: 440 }}>
              <CompareControls row />
            </div>
          </div>
        </div>
      </InSlot>
      <div
        ref={host}
        data-testid="compare-stage"
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      >
        {split && on.has("split") && (
          <ComparePills
            left={fastestPill(c)}
            right={recommendedPill(c)}
            rightNote={recommendedPillNote(c)}
            viewports={vp}
            top={pillsTop}
          />
        )}
        {anchored.map(([id, , copy]) => (
          <PoiTag key={id} beat={id} copy={copy} at={point(id)} lift={lifts[id] ?? 0} />
        ))}
        {greeting && point("greeting") && <GreetingBubble text={greeting} at={point("greeting")} />}
        {column("L")}
        {column("R")}
        {on.has("tickets-chip") && <TicketsChip count={tickets} bump={bump} countRef={chipCount} />}
        {on.has("ticket-flight") && fc && st.flight !== null && (
          <TicketFlight title={fc.title} text={fc.text} from={from} to={to} progress={st.flight} />
        )}
        {on.has("ticket-toast") && (
          <TicketToast
            compare={c}
            className="absolute right-[calc(var(--panel-w,0px)+1rem)] top-16 w-[300px] max-w-[calc(100%-2rem)] shadow-[0_3px_0_var(--c-edge),0_10px_30px_rgba(44,42,58,.18)]"
          />
        )}
      </div>
    </>
  );
}
