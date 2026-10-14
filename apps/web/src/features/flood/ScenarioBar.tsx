import { useScenarios } from "../../lib/api";
import { useScene } from "../scene/sceneStore";

const cls = (active: boolean) =>
  `min-h-11 px-3 text-sm font-medium transition-colors ${
    active ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"
  }`;

export function ScenarioBar() {
  const { scenarioId, setScenario } = useScene();
  const q = useScenarios();
  const scenarios = q.data ?? [];

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" aria-label="Flood scenario (indicative)">
      <legend className="mb-1 block text-sm font-medium">Flood scenario (indicative)</legend>
      {q.isPending ? (
        <p role="status" className="text-sm text-ink-soft">
          Loading scenarios…
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-sm">
          Scenarios unavailable.{" "}
          <button type="button" className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : scenarios.length === 0 ? (
        <p className="text-sm text-ink-soft">No scenarios available.</p>
      ) : (
        <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line bg-card">
          <button
            type="button"
            aria-pressed={scenarioId === null}
            onClick={() => setScenario(null)}
            className={cls(scenarioId === null)}
          >
            Normal
          </button>
          {scenarios
            .filter((s) => s.id !== "baseline")
            .map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={scenarioId === s.id}
                onClick={() => setScenario(s.id)}
                className={cls(scenarioId === s.id)}
              >
                {s.label}
              </button>
            ))}
        </div>
      )}
    </fieldset>
  );
}
