import { CompareControls } from "../CompareControls";
import { useCompare } from "../compareStore";
import { attributeName } from "./copy";
import { ReasonsCard } from "./ReasonsCard";
import { TicketToast } from "./TicketToast";

/**
 * The compare, text version (List view / no WebGL, AC-N9): no 3D and no split screen, only both
 * routes' minutes, the ticket toast and the reasons card, with Exit trip.
 */
export function CompareListSection() {
  const c = useCompare((s) => s.payload);
  if (!c?.fastest || !c.recommended) return null;
  return (
    <section
      aria-labelledby="compare-list-h"
      data-testid="compare-list"
      className="space-y-3 rounded-lg border border-line bg-card p-4"
    >
      <h2 id="compare-list-h" className="m-0 text-xl font-semibold">
        Fastest and recommended route
      </h2>
      <ul className="m-0 list-none space-y-1 p-0 text-sm">
        <li>Fastest route · {c.fastest.est_minutes} min</li>
        <li>Recommended route · {c.recommended.est_minutes} min</li>
        {c.stop && (
          <li>
            The fastest route has a known barrier ({attributeName(c.stop.attribute).toLowerCase()})
            at {Math.round(c.stop.at_m)} m.
          </li>
        )}
      </ul>
      <TicketToast compare={c} />
      <ReasonsCard compare={c} />
      <CompareControls />
    </section>
  );
}
