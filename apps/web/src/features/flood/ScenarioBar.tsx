import { useScenarios } from "../../lib/api";
import { useScene } from "../scene/sceneStore";

const cls = (active: boolean) =>
  `min-h-11 px-2.5 sm:px-3 text-sm font-medium transition-colors ${
    active ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"
  }`;

/** "River +1 m (indicative)" -> "+1 m"; labels without a level are kept whole. */
export const shortLabel = (label: string) =>
  label.match(/(?:^|\s)([+-]\d+(?:\.\d+)?\s*m)(?:\s*\(.*\))?$/)?.[1] ?? label;

export function ScenarioButtons({
  scenarios,
  scenarioId,
  onSelect,
}: {
  scenarios: { id: string; label: string }[];
  scenarioId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line bg-card">
      <button
        type="button"
        aria-label="Normal"
        aria-pressed={scenarioId === null}
        onClick={() => onSelect(null)}
        className={cls(scenarioId === null)}
      >
        Normal
      </button>
      {scenarios.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={s.label}
          aria-pressed={scenarioId === s.id}
          onClick={() => onSelect(s.id)}
          className={cls(scenarioId === s.id)}
        >
          <span aria-hidden="true" className="sm:hidden">
            {shortLabel(s.label)}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}

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
        <ScenarioButtons
          scenarios={scenarios.filter((s) => s.id !== "baseline")}
          scenarioId={scenarioId}
          onSelect={setScenario}
        />
      )}
    </fieldset>
  );
}
