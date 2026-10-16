import { useEffect, useRef } from "react";
import { useMode } from "../../app/modeStore";
import { useDay } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import { DAY_END, stageAt } from "./dayModel";

const TICK_MS = 100;
const MIN_PER_TICK = 1.8; // 18 hours of the day in about a minute

/** Elmina Day playback, mounted with the map so it works whatever panel is open:
 * - the clock runs while playing (only once the day has loaded) and stops at 23:00;
 * - the flood layer follows the river stage at the clock;
 * - when the day starts, the scenario and flood lens on screen are remembered, and they are
 *   restored when it stops; a river level the user picks meanwhile ends the day and stays;
 * - leaving Management mode, or starting the rising-river rollout, ends the day. */
export function useDayPlayback() {
  const on = useScene((s) => s.day.on);
  const playing = useScene((s) => s.day.playing);
  const scenario = useScene((s) => s.day.scenario);
  const t = useScene((s) => s.day.t);
  const setDay = useScene((s) => s.setDay);
  const rolloutOn = useScene((s) => s.rollout.on);
  const mode = useMode((s) => s.mode);
  const scenarioId = useScene((s) => s.scenarioId);
  const q = useDay(scenario, on);
  const stages = (q.data?.scenario as { stages?: [number, string | null][] } | undefined)?.stages;
  const before = useRef<{ scenarioId: string | null; flood: boolean } | null>(null);
  const lastSet = useRef<string | null | undefined>(undefined);

  // remember on start, restore on stop
  useEffect(() => {
    if (on && before.current === null) {
      const s = useScene.getState();
      before.current = { scenarioId: s.scenarioId, flood: s.lensVisible.flood };
      lastSet.current = undefined;
      if (s.rollout.on) s.setRollout({ on: false, playing: false });
    }
    if (!on && before.current !== null) {
      // the day still owns the river level: put back what was on screen before it started
      const prev = before.current;
      before.current = null;
      lastSet.current = undefined;
      useScene.setState((s) => ({
        scenarioId: prev.scenarioId,
        lensVisible: { ...s.lensVisible, flood: prev.flood },
      }));
    }
  }, [on]);

  // leaving Management mode, or the rising-river rollout starting later, ends the day
  const rolloutWas = useRef(rolloutOn);
  useEffect(() => {
    const started = rolloutOn && !rolloutWas.current;
    rolloutWas.current = rolloutOn;
    if (on && (started || mode !== "management")) setDay({ on: false, playing: false });
  }, [on, rolloutOn, mode, setDay]);

  // the river follows the clock; a level the user picks meanwhile ends the day
  const stage = stageAt(stages, t);
  useEffect(() => {
    if (!on || !stages) return;
    const cur = scenarioId;
    if (lastSet.current !== undefined && cur !== lastSet.current) {
      before.current = null; // the user's choice stays
      setDay({ on: false, playing: false });
      return;
    }
    if (cur !== stage) {
      useScene.getState().setDayStage(stage);
    }
    lastSet.current = stage;
  }, [on, stages, stage, scenarioId, setDay]);

  // the clock
  const ready = !!q.data;
  useEffect(() => {
    if (!on || !playing || !ready) return;
    const id = window.setInterval(() => {
      const next = useScene.getState().day.t + MIN_PER_TICK;
      if (next >= DAY_END) setDay({ t: DAY_END, playing: false });
      else setDay({ t: next });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [on, playing, ready, setDay]);
}
