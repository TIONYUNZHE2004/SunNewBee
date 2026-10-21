import { COMPARE_TOTAL_S, useCompare } from "./compareStore";
import { exitTrip } from "./exitTrip";
import { useJourney } from "./journeyStore";

const pill =
  "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium focus-visible:outline-2";

/**
 * On the map while a trip (journey or compare playback) is loaded: always an "Exit trip" button,
 * and once it has played to its end a "Trip finished" note with Replay, so the map never stays
 * stuck in the simulation. Part of the 3D player's overlay (JourneyMount; the compare overlay).
 */
export function TripBar() {
  const comparing = useCompare((s) => !!s.payload);
  const compareDone = useCompare((s) => !!s.payload && !s.playing && s.t >= COMPARE_TOTAL_S);
  const journeyDone = useJourney((s) => !!s.timeline && !s.playing && s.t >= s.timeline.total);
  const done = comparing ? compareDone : journeyDone;
  return (
    <div
      data-testid="journey-trip-bar"
      className={`glass inline-flex items-center gap-1.5 rounded-full p-1 text-sm text-fg${done ? " pl-3" : ""}`}
    >
      {done && (
        <>
          <span role="status" className="pr-1 font-medium">
            Trip finished
          </span>
          <button
            type="button"
            className={`${pill} border border-line text-fg hover:bg-surface-2`}
            onClick={() =>
              comparing ? useCompare.getState().restart() : useJourney.getState().restart()
            }
          >
            Replay
          </button>
        </>
      )}
      <button
        type="button"
        data-testid="journey-exit"
        className={`${pill} bg-accent text-on-accent hover:opacity-90`}
        onClick={exitTrip}
      >
        Exit trip
      </button>
    </div>
  );
}
