import { CardSourceRow } from "../../journey/CardSourceRow";
import {
  journeyCardContent,
  SIMULATION_LABEL,
  vrFiledFor,
  withVerificationRequest,
} from "../../journey/cardContent";
import { useJourney } from "../../journey/journeyStore";
import type { JourneyPlan } from "../../journey/timeline";

/** The resident journey as a numbered step list (spec §6.5): the same events and card content as
 * the Three.js player (`journeyCardContent` + `CardSourceRow`, AC-D14), no animation. Used by the
 * List view and Mapbox lite. */
export function JourneyStepList({ plan, className }: { plan: JourneyPlan; className?: string }) {
  const vrs = useJourney((s) => s.vrs);
  if (!plan.events.length) return null;
  return (
    <section
      aria-labelledby="journey-h"
      data-testid="journey-steps"
      className={className ?? "rounded-lg border border-dashed border-lilac bg-card p-4"}
    >
      <h2 id="journey-h" className="text-xl font-semibold">
        The walk, step by step
      </h2>
      <p role="note" className="mt-1 text-sm text-ink-soft">
        {SIMULATION_LABEL}
      </p>
      <ol className="mt-3 space-y-2">
        {plan.events.map((e, i) => {
          const c = withVerificationRequest(journeyCardContent(e), e, vrFiledFor(e, vrs));
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed event order; index + kind + at_m is stable
              key={`${i}-${e.kind}-${e.at_m}`}
              className="rounded-lg border border-line bg-card px-4 py-3"
            >
              <p className="font-semibold">
                <span className="mr-2">{i + 1}.</span>
                {c.title}
                <span className="ml-2 text-xs font-medium text-ink-soft">{c.statusLabel}</span>
              </p>
              <p className="mt-1 text-sm">{c.body}</p>
              <CardSourceRow content={c} elementId={e.element_id} className="mt-1" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
