import { useMemo } from "react";
import { useLayer, useScenarios } from "../../../lib/api";
import { useScene } from "../sceneStore";
import { statusStyle } from "../styles";
import { groupByType, humanType, parseLayer, routeSteps } from "./listModel";

function StatusBadge({ status }: { status: Parameters<typeof statusStyle>[0] }) {
  const st = statusStyle(status);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <svg width="28" height="8" aria-hidden="true">
        <line
          x1="0"
          y1="4"
          x2="28"
          y2="4"
          stroke={st.color}
          strokeWidth={Math.min(st.width, 7)}
          strokeDasharray={st.dotted ? "1 5" : st.dashed ? "5 4" : undefined}
          strokeLinecap={st.dotted ? "round" : "butt"}
        />
      </svg>
      {st.label}
    </span>
  );
}

export function ListView() {
  const { profile, scenarioId, route, focusPlaceId, lensVisible, selectPlace } = useScene();
  const layer = useLayer("access", profile, scenarioId);
  const scenarios = useScenarios();
  const parsed = useMemo(() => parseLayer(layer.data), [layer.data]);
  const groups = useMemo(() => groupByType(parsed.places), [parsed.places]);
  const steps = useMemo(
    () => routeSteps(route?.geojson ?? null, parsed.edges),
    [route, parsed.edges],
  );
  const flooded = parsed.edges.filter(
    (e) => e.status === "flooded_likely" || e.status === "flooded_possible",
  );
  const scenario = scenarios.data?.find((s) => s.id === scenarioId);

  if (layer.isPending)
    return (
      <p role="status" className="p-4 text-ink-soft">
        Loading…
      </p>
    );

  if (layer.isError)
    return (
      <div role="alert" className="rounded-lg border border-line bg-danger-tint p-4">
        <p className="font-medium">We could not load the places.</p>
        <p className="text-sm text-ink-soft">Check that the service is running, then try again.</p>
        <button
          type="button"
          onClick={() => layer.refetch()}
          className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Retry
        </button>
      </div>
    );

  return (
    <div className="space-y-8">
      <section aria-labelledby="route-h">
        <h2 id="route-h" className="text-xl font-semibold">
          Route
        </h2>
        <p role="status" aria-live="polite" className="sr-only">
          {route
            ? `Route updated: ${steps.length || route.geojson.coordinates.length} ${steps.length ? "steps" : "points"}.`
            : ""}
        </p>
        {!route ? (
          <p className="mt-2 text-ink-soft">
            No route yet. Ask the assistant for directions to see the steps here.
          </p>
        ) : steps.length === 0 ? (
          <p className="mt-2">
            Suggested route highlighted ({route.geojson.coordinates.length} points).
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-4 py-3"
              >
                <span>
                  <span className="mr-2 font-semibold">{i + 1}.</span>
                  {s.name}
                </span>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {scenarioId && (
        <section aria-labelledby="scn-h" className="rounded-lg border border-line bg-warn-tint p-4">
          <h2 id="scn-h" className="text-xl font-semibold">
            Scenario: {scenario?.label ?? scenarioId} (indicative)
          </h2>
          {scenario?.disclaimer && <p className="mt-1 text-sm">{scenario.disclaimer}</p>}
          {flooded.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              No paths flagged for this scenario in the loaded data.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {flooded.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{e.name}</span>
                  <StatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="places-h">
        <h2 id="places-h" className="text-xl font-semibold">
          Places
        </h2>
        {!lensVisible.access ? (
          <p className="mt-2 text-ink-soft">The access layer is hidden.</p>
        ) : groups.length === 0 ? (
          <p className="mt-2 text-ink-soft">No places to show yet.</p>
        ) : (
          groups.map(([type, items]) => (
            <div key={type} className="mt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                {humanType(type)}
              </h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {items.map((p) => (
                  <li key={p.id} aria-current={p.id === focusPlaceId ? "true" : undefined}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => selectPlace(p.id)}
                      className={`min-h-11 w-full rounded-lg border px-4 py-3 text-left hover:bg-brand-tint ${p.id === focusPlaceId ? "border-brand bg-brand-tint" : "border-line bg-card"}`}
                    >
                      {p.name}
                      {p.id === focusPlaceId && (
                        <span className="ml-2 text-sm font-medium text-brand">(selected)</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
