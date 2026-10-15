import type { SceneIntent } from "@tl/api-client";
import { pickSuggestion } from "../chat/suggestions";
import { type DeepSpot, goToDeepSpot } from "../scene/DeepSpots";
import { type Profile, useScene } from "../scene/sceneStore";
import type { StepAction } from "./heroScript";

export interface RunDeps {
  spots: DeepSpot[];
  applyIntent: (i: SceneIntent) => void;
  setProfile: (p: Profile) => void;
  setScenario: (id: string | null) => void;
  /** Queue a question for the chat panel (the same path the scenario bar uses). */
  ask: (text: string, opts: { profile: Profile; scenarioId: string | null }) => void;
  navigate: (to: string) => void;
}

export const UNAVAILABLE_NOTE = "(not available in this dataset)";

/** Run one scripted action through the app's existing store and router paths. */
export function runAction(a: StepAction, d: RunDeps): "ok" | "unavailable" {
  if (a.kind === "openManage") {
    d.navigate(`/manage?tab=${a.tab}`);
    return "ok";
  }
  if (a.kind === "wait") return "ok";
  // Everything else acts on the resident view.
  d.navigate("/");
  switch (a.kind) {
    case "jump": {
      const spot = d.spots.find((s) => s.id === a.deepSpotId);
      if (!spot) return "unavailable";
      goToDeepSpot(spot, d.applyIntent);
      return "ok";
    }
    case "setProfile":
      d.setProfile(a.profile);
      return "ok";
    case "setScenario":
      d.setScenario(a.scenarioId);
      return "ok";
    case "setLens":
      d.applyIntent({ kind: "layer.toggle", lens: a.lens, visible: a.on });
      return "ok";
    case "ask":
      // Persona and scenario travel with the question, so a later step cannot change them.
      if (a.scenarioId !== undefined) d.setScenario(a.scenarioId);
      pickSuggestion({ text: a.text, profile: a.profile }, (text, profile) => {
        const s = useScene.getState();
        d.ask(text, {
          profile: profile ?? s.profile,
          scenarioId: a.scenarioId === undefined ? s.scenarioId : a.scenarioId,
        });
      });
      return "ok";
  }
}

/** Autoplay dwell for a step: its wait(ms), else a default long enough to read the caption. */
export const dwellMs = (a: StepAction): number => (a.kind === "wait" ? a.ms : 7000);
