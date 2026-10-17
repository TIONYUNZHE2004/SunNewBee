import { useEffect, useRef } from "react";
import { useRiverRollout } from "../../lib/api";
import { useScene } from "../scene/sceneStore";

const STEP_MS = 2500;

/** Playback for the rising-river rollout, mounted with the map so it works in every mode
 * (the assistant's river.rollout intent can start it from Resident mode too):
 * - Play steps one stage every STEP_MS and stops at the highest.
 * - The flood layer follows the playback stage without clearing a route or what-if diff.
 * - When the rollout stops, the scenario that was on screen before it is restored. */
export function useRolloutPlayback() {
  const rollout = useScene((s) => s.rollout);
  const setRollout = useScene((s) => s.setRollout);
  const q = useRiverRollout(rollout.on);
  const stages = q.data?.stages ?? [];
  const before = useRef<{ scenarioId: string | null } | null>(null);

  useEffect(() => {
    if (rollout.on && before.current === null) {
      before.current = { scenarioId: useScene.getState().scenarioId };
    }
    if (!rollout.on && before.current !== null) {
      const prev = before.current.scenarioId;
      before.current = null;
      useScene.setState({ scenarioId: prev });
    }
  }, [rollout.on]);

  const stage = stages[rollout.stage];
  useEffect(() => {
    if (!rollout.on || !stage) return;
    const sid = stage.id === "baseline" ? null : stage.id;
    useScene.setState((s) => ({
      scenarioId: sid,
      lensVisible: { ...s.lensVisible, flood: s.lensVisible.flood || !!sid },
    }));
  }, [rollout.on, stage]);

  useEffect(() => {
    if (!rollout.on || !rollout.playing || !stages.length) return;
    if (rollout.stage >= stages.length - 1) {
      setRollout({ playing: false });
      return;
    }
    const t = setTimeout(() => setRollout({ stage: rollout.stage + 1 }), STEP_MS);
    return () => clearTimeout(t);
  }, [rollout.on, rollout.playing, rollout.stage, stages.length, setRollout]);
}
