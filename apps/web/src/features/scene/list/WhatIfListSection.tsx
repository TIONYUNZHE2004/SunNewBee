import { useMemo } from "react";
import {
  diffJourneys,
  diffMeta,
  routeStatusWord,
  summaryBars,
  touchedLabels,
  WHATIF_LEGEND,
} from "../../whatif/whatifModel";
import { useScene } from "../sceneStore";

/** The what-if diff in the list view (Cycle 8): the same imagined change the 3D map draws, as
 * text, so keyless, no-WebGL and screen-reader users get it too. Numbers are the engine's. */
export function WhatIfListSection() {
  const whatIf = useScene((s) => s.whatIf);
  const clear = useScene((s) => s.clearWhatIf);
  const fc = whatIf?.geojson as never;
  const meta = useMemo(() => diffMeta(fc), [fc]);
  const journeys = useMemo(() => diffJourneys(fc), [fc]);
  const touched = useMemo(() => touchedLabels(fc), [fc]);
  if (!whatIf) return null;
  return (
    <section
      aria-labelledby="whatif-h"
      className="rounded-lg border border-dashed border-lilac bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="whatif-h" className="text-xl font-semibold">
          {WHATIF_LEGEND}
        </h2>
        <button
          type="button"
          onClick={clear}
          className="min-h-11 rounded-md px-3 text-sm underline hover:bg-brand-tint"
        >
          Clear what-if
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        An imagined change on the township model, not a real plan or a forecast.
      </p>
      {meta && meta.actions.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-semibold">Imagined changes</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {meta.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {meta && (
        <dl className="mt-3 grid gap-1 text-sm">
          {summaryBars(meta.summary, meta.scope).map((b) => (
            <div key={b.label} className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{b.label}:</dt>
              <dd>
                today {b.today}, what-if {b.whatIf} (of {b.total})
              </dd>
            </div>
          ))}
        </dl>
      )}
      {touched.length > 0 && (
        <p className="mt-3 text-sm">
          <span className="font-medium">Imagined paths:</span> {touched.join("; ")}
        </p>
      )}
      {journeys.length > 0 ? (
        <>
          <h3 className="mt-3 text-sm font-semibold">Journeys that change</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {journeys.map((j, i) => (
              <li key={`${j.from}-${j.to}-${i}`}>
                {j.from} → {j.to}: {routeStatusWord(j.before)} → would be {routeStatusWord(j.after)}
              </li>
            ))}
          </ul>
          {meta && (meta.summary.changed ?? 0) > journeys.length && (
            <p className="mt-1 text-xs text-ink-soft">
              Showing {journeys.length} of {meta.summary.changed} journeys that change.
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">No sampled journey changes status.</p>
      )}
    </section>
  );
}
