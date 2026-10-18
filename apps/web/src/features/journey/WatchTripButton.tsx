import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

/** "Watch the trip" in an answer: loads that answer's own plan (if the player has another) and plays it from the start. */
export function WatchTripButton({ plan }: { plan: JourneyPlan }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs text-fg hover:bg-surface-2"
      onClick={() => {
        const j = useJourney.getState();
        if (j.plan !== plan) j.load(plan);
        useJourney.getState().restart();
      }}
    >
      Watch the trip
    </button>
  );
}
