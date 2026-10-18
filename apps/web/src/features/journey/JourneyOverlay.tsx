import { InSlot } from "../map-ui/mapSlots";
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
 * `project(eventIndex)` gives the event anchor in `viewport` CSS px (null when behind the camera);
 * the caller re-renders this component on every rendered 3D frame so the card follows the camera.
 */
export function JourneyOverlay({
  project,
  viewport,
}: {
  project: (eventIndex: number) => { x: number; y: number } | null;
  /** The map area cards may use, CSS px; `top` is a band kept clear (label, HUD, route tag). */
  viewport: { w: number; h: number; top?: number };
}) {
  const timeline = useJourney((s) => s.timeline);
  const t = useJourney((s) => s.t);
  const vrElements = useJourney((s) => s.vrElements);
  if (!timeline) return null;
  const st = stateAt(timeline, t);
  const ev = st.phase.kind === "event" ? st.event : undefined;
  const idx = st.eventIndex ?? -1;
  return (
    <>
      <InSlot name="sim">
        <div data-testid="journey-overlay" className="flex flex-col items-start gap-2">
          <SimulationLabel />
          <JourneyHud state={st} covered={timeline.covered} />
        </div>
      </InSlot>
      <div className="pointer-events-none absolute right-[calc(var(--panel-w,0px)+1rem)] top-4 z-20">
        <JourneyMiniMap plan={timeline.plan} distanceM={st.distance_m} />
      </div>
      {ev && (
        <EventCard
          key={idx}
          event={ev}
          eventIndex={idx}
          anchor={project(idx)}
          viewport={viewport}
          vrFiled={!!ev.element_id && vrElements.includes(ev.element_id)}
        />
      )}
    </>
  );
}
