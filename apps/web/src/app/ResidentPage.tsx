import { ChatPanel } from "../features/chat/ChatPanel";
import { DisclaimerBanner } from "../features/flood/DisclaimerBanner";
import { ScenarioBar } from "../features/flood/ScenarioBar";
import { PlaceCard } from "../features/places/PlaceCard";
import { DeepSpots } from "../features/scene/DeepSpots";
import { SceneHost } from "../features/scene/SceneHost";
import { type Lens, useScene } from "../features/scene/sceneStore";
import { useScenarios } from "../lib/api";

const LENSES: [Lens, string][] = [
  ["access", "Access"],
  ["flood", "Flood"],
  ["waste", "Waste"],
];

export function ResidentPage() {
  const { lensVisible, toggleLens, scenarioId } = useScene();
  const scenarios = useScenarios();
  const scenario = scenarios.data?.find((s) => s.id === scenarioId);

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Resident view</h1>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 block text-sm font-medium">Layers</legend>
          <div className="inline-flex overflow-hidden rounded-lg border border-line bg-card">
            {LENSES.map(([l, label]) => (
              <button
                key={l}
                type="button"
                aria-pressed={lensVisible[l]}
                onClick={() => toggleLens(l)}
                className={`min-h-11 px-3 text-sm font-medium ${lensVisible[l] ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"}`}
              >
                <span aria-hidden="true">{lensVisible[l] ? "✓ " : ""}</span>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <ScenarioBar />
        <DeepSpots />
      </div>
      {scenarioId && (
        <DisclaimerBanner
          text={
            scenario?.disclaimer ??
            "Flood scenarios are indicative only and do not show real-time conditions."
          }
          links={scenario?.links}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SceneHost />
        </div>
        <ChatPanel />
      </div>
      <PlaceCard />
    </div>
  );
}
