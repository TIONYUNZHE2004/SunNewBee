import { useScene } from "../scene/sceneStore";
import { useJourney } from "./journeyStore";

/** "Watch the trip" in the assistant answer: loads the answer's journey (if needed) and plays it from the start. */
export function WatchTripButton() {
  const plan = useScene((s) => s.journey);
  if (!plan) return null;
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
