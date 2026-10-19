import { useMemo } from "react";
import { InSlot } from "../map-ui/mapSlots";
import { vrFiledFor } from "./cardContent";
import type { CardViewport } from "./cardPlacement";
import { EventCard } from "./EventCard";
import { JourneyHud } from "./JourneyHud";
import { JourneyMiniMap } from "./JourneyMiniMap";
import { useJourney } from "./journeyStore";
import { SimulationLabel } from "./SimulationLabel";
import { stateAt } from "./timeline";

/**
 * The journey player's DOM overlay (spec §6.4), shown while the journey store holds a plan:
 * - the Simulation label and the HUD in the map's "sim" slot (always visible while loaded);
 * - the mini-map at the top right of the map;
 * - one event card during each event hold, none during dive / walk / pull (AC-D11).
 * `project(eventIndex)` gives the event anchor in `viewport` CSS px (null when behind the camera).
 * With `subscribeFrame` (the engine's rendered frames) the shown card follows the camera itself,
 * subscribed only during its hold; this component re-renders only when the store changes.
 */
export function JourneyOverlay({
  project,
  viewport,
  subscribeFrame,
  miniMapRef,
}: {
  project: (eventIndex: number) => { x: number; y: number } | null;
  /** The map area cards may use, CSS px: `top` is a band kept clear, `avoid` the mini-map. */
  viewport: CardViewport;
  subscribeFrame?: (cb: () => void) => () => void;
  /** Called with the mini-map element when it mounts (the card area measures it). */
  miniMapRef?: (el: HTMLElement | null) => void;
}) {
  const timeline = useJourney((s) => s.timeline);
  const t = useJourney((s) => s.t);
  const vrs = useJourney((s) => s.vrs);
  const st = timeline ? stateAt(timeline, t) : null;
  const ev = st?.phase.kind === "event" ? st.event : undefined;
  const idx = ev ? (st?.eventIndex ?? -1) : -1;
  const track = useMemo(
    () =>
      subscribeFrame && idx >= 0
        ? { project: () => project(idx), subscribe: subscribeFrame }
        : undefined,
    [subscribeFrame, project, idx],
  );
  if (!timeline || !st) return null;
  return (
    <>
      <InSlot name="sim">
        <div data-testid="journey-overlay" className="flex flex-col items-start gap-2">
          <SimulationLabel />
          <JourneyHud state={st} covered={timeline.covered} />
        </div>
      </InSlot>
      <div className="pointer-events-none absolute right-[calc(var(--panel-w,0px)+1rem)] top-4 z-20">
        <JourneyMiniMap plan={timeline.plan} distanceM={st.distance_m} figureRef={miniMapRef} />
      </div>
      {ev && (
        <EventCard
          key={idx}
          event={ev}
          eventIndex={idx}
          anchor={project(idx)}
          viewport={viewport}
          vrFiled={vrFiledFor(ev, vrs)}
          track={track}
        />
      )}
    </>
  );
}
