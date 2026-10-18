import { DEMO_CHIP_TEXT, journeyCardContent, SIMULATION_LABEL } from "../../journey/cardContent";
import type { JourneyPlan } from "../../journey/timeline";

/** The resident journey as a numbered step list (spec §6.5): the same events and card content as
 * the Three.js player, no animation. Used by the List view and Mapbox lite. */
export function JourneyStepList({ plan, className }: { plan: JourneyPlan; className?: string }) {
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
          const c = journeyCardContent(e);
          return (
            <li
              key={`${e.kind}-${e.at_m}-${e.element_id ?? e.source ?? i}`}
              className="rounded-lg border border-line bg-card px-4 py-3"
            >
              <p className="font-semibold">
                <span className="mr-2">{i + 1}.</span>
                {c.title}
              </p>
              <p className="mt-1 text-sm">{c.body}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                {c.demoChip && (
                  <span className="rounded border border-line px-1.5 py-0.5 font-medium text-ink">
                    {DEMO_CHIP_TEXT}
                  </span>
                )}
                {!c.demoChip && <span className="font-medium text-ink">{c.statusLabel}</span>}
                {c.source && <span>Source: {c.source}</span>}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
