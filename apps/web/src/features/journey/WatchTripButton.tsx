import { useId } from "react";
import { TRAVEL_LABELS } from "../map-ui/TravelLabels";
import { useScene } from "../scene/sceneStore";
import { useEffectiveView } from "../scene/useMapStyle";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

/**
 * "Watch the trip" in an answer: loads that answer's own plan (if the player has another) and
 * plays it from the start. Only while that answer's route is the one on the map: a trip is never
 * shown beside another route, so an older answer's button is disabled while a newer route is drawn.
 * The List view has no player: there it loads the trip paused at the start (its steps and slider).
 */
export function WatchTripButton({ plan }: { plan: JourneyPlan }) {
  const noteId = useId();
  const playable = useEffectiveView() !== "list";
  // no route drawn (cleared): the trip brings its own ribbon back; another route drawn: disabled
  const current = useScene((s) => !s.route || s.route.id === plan.route_id);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span data-testid="planned-for" className="w-full text-xs text-fg-soft">
        Planned for: {TRAVEL_LABELS[plan.profile]}
      </span>
      <button
        type="button"
        className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        disabled={!current}
        aria-describedby={current ? undefined : noteId}
        onClick={() => {
          // the trip's persona wins: the chip must never say another one while it plays
          useScene.getState().adoptProfile(plan.profile);
          const j = useJourney.getState();
          if (j.plan !== plan) j.load(plan);
          if (playable) useJourney.getState().restart();
          else useJourney.getState().seek(0);
        }}
      >
        Watch the trip
      </button>
      {!current && (
        <span id={noteId} className="text-xs text-fg-soft">
          This route is no longer on the map.
        </span>
      )}
    </div>
  );
}
