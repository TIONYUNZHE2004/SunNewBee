import { useId } from "react";
import { TRAVEL_LABELS } from "../map-ui/TravelLabels";
import { useScene } from "../scene/sceneStore";
import { useEffectiveView } from "../scene/useMapStyle";
import { useCompare } from "./compareStore";
import { type CompareIntent, isPlayableCompare } from "./compareTypes";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

/**
 * "Watch the trip" in an answer: with a playable `route.compare` (two different routes, AC-N1) it
 * loads that compare and plays the split-screen compare from the start; otherwise it loads the
 * answer's own journey plan (if the player has another) and plays it, exactly as before.
 * Only while that answer's route is the one on the map: a trip is never shown beside another
 * route, so an older answer's button is disabled while a newer route is drawn.
 * The List view has no player: there it loads the trip (or compare) paused at the start.
 */
export function WatchTripButton({
  plan,
  compare,
}: {
  plan?: JourneyPlan;
  compare?: CompareIntent;
}) {
  const noteId = useId();
  const playable = useEffectiveView() !== "list";
  const cmp = isPlayableCompare(compare) ? compare : null;
  const routeIds = cmp ? [cmp.recommended.id, cmp.fastest.id] : plan ? [plan.route_id] : [];
  // no route drawn (cleared): the trip brings its own ribbon back; another route drawn: disabled
  const current = useScene((s) => !s.route || routeIds.includes(s.route.id));
  const profile = cmp?.profile ?? plan?.profile;
  if (!cmp && !plan) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {profile && (
        <span data-testid="planned-for" className="w-full text-xs text-fg-soft">
          Planned for: {TRAVEL_LABELS[profile]}
        </span>
      )}
      <button
        type="button"
        className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        disabled={!current}
        aria-describedby={current ? undefined : noteId}
        onClick={() => {
          // the trip's persona wins: the chip must never say another one while it plays
          if (profile) useScene.getState().adoptProfile(profile);
          // one simulation at a time: the trip ends a Development Simulation (the stores' load
          // does too; this also covers a trip that is already loaded)
          useScene.getState().stopDevsim();
          if (cmp) {
            const c = useCompare.getState();
            if (c.payload !== cmp) c.load(cmp);
            if (playable) useCompare.getState().restart();
            else useCompare.getState().seek(0);
            return;
          }
          if (!plan) return;
          if (useCompare.getState().payload) useCompare.getState().clear();
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
