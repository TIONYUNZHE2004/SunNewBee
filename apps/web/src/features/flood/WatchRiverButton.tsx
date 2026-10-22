import { useMarathonPlay } from "../closures/marathonPlayStore";
import { useDevsim } from "../devsim/devsimStore";
import { useCompare } from "../journey/compareStore";
import { useJourney } from "../journey/journeyStore";
import { prefersReducedMotion } from "../scene/sceneSettingsStore";
import { useScene } from "../scene/sceneStore";
import { beginFloodStory, useFloodStory } from "./floodStoryStore";

export function WatchRiverButton() {
  const stylised = useScene(
    (s) => s.view === "cesium" && s.mapStyle === "stylised" && !s.rendererFailed,
  );
  const ready = useFloodStory((s) => s.rendererReady);
  const otherPlayback = useScene((s) => s.day.on || s.rollout.on);
  const status = useFloodStory((s) => s.status);
  const journey = useJourney((s) => !!s.plan);
  const compare = useCompare((s) => !!s.payload);
  const marathon = useMarathonPlay((s) => !!s.result);
  const devsim = useDevsim((s) => s.status !== "idle");
  if (!stylised || !ready || status !== "idle") return null;
  const busy = journey || compare || devsim || marathon || otherPlayback;
  return (
    <button
      type="button"
      disabled={busy}
      title={busy ? "Close the current playback to watch the river." : undefined}
      onClick={() => void beginFloodStory(!prefersReducedMotion())}
      className="mt-2 rounded-full border border-edge bg-surface px-4 py-2 text-xs font-semibold text-fg shadow-sm transition-colors hover:bg-raised disabled:opacity-50"
    >
      <span aria-hidden="true" className="mr-2">
        ▶
      </span>
      Watch the river rise
    </button>
  );
}
