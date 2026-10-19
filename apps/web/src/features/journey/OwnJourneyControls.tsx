import { JourneyControls } from "./JourneyControls";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

/** Controls only on the answer whose trip the player currently holds; gone after clear or another answer's Watch. */
export function OwnJourneyControls({ plan }: { plan: JourneyPlan }) {
  const loaded = useJourney((s) => s.plan);
  return loaded === plan ? <JourneyControls /> : null;
}
