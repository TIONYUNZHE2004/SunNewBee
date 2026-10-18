import { useEffect, useMemo, useState } from "react";
import { useDay, useRiverRollout } from "../../../../lib/api";
import { dotsAt, prepare, type Tracks } from "../../../day/dayModel";
import { useScene } from "../../sceneStore";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { MOTION_FRAME_MS } from "../motion/motionClock";
import type { OverlayLayer } from "./accessLayers";
import { createResidents, type Residents, rolloutPoints } from "./residents";

/**
 * Elmina Day and river-rollout residents on the overlay layer. Same data flow as the Cesium layers
 * (`useDay` + `prepare` + `dotsAt`, `useRiverRollout` + `rolloutPoints`); scrubbing the Day clock
 * just re-places the instances and asks for one frame. Rollout walkers are moved by the overlay
 * layer's per-frame view, so no loop of their own. The Day legend is the engine-independent
 * DayTag already mounted by MainPage.
 */
export function useResidents(
  engine: Engine | null,
  overlay: OverlayLayer | null,
  frame: LocalFrame | null,
) {
  const day = useScene((s) => s.day);
  const rollout = useScene((s) => s.rollout);
  const dayQ = useDay(day.scenario, day.on);
  const rolloutQ = useRiverRollout(rollout.on);
  const tracks = (dayQ.data as { tracks?: Tracks } | undefined)?.tracks;
  const prepared = useMemo(() => prepare(tracks), [tracks]);
  const [residents, setResidents] = useState<Residents | null>(null);
  const [walking, setWalking] = useState(false);

  useEffect(() => {
    if (!overlay || !frame) return;
    const r = createResidents(frame);
    const detach = overlay.attach(r);
    setResidents(r);
    return () => {
      setResidents(null);
      detach();
    };
  }, [overlay, frame]);

  useEffect(() => {
    if (!engine || !residents) return;
    residents.setDay(day.on && tracks ? dotsAt(prepared, day.t) : [], day.on ? day.focus : null);
    engine.requestRender();
  }, [engine, residents, day.on, day.t, day.focus, tracks, prepared]);

  const rolloutData = rolloutQ.data;
  useEffect(() => {
    if (!engine || !residents) return;
    residents.setRollout(
      rollout.on && rolloutData
        ? rolloutPoints(
            rolloutData.residents,
            rolloutData.routes as Record<string, { coordinates: number[][] }>,
            rollout.stage,
          )
        : [],
    );
    setWalking(residents.walking());
    engine.requestRender();
  }, [engine, residents, rollout.on, rollout.stage, rolloutData]);

  // Playback is simulation, not decoration: it runs whatever the Motion setting, on its own timer.
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const playing = playbackActive({
    on: rollout.on,
    loaded: !!rolloutData && !!residents,
    walking,
    visible,
  });
  useEffect(() => {
    if (!engine || !playing) return;
    return startPlayback(() => engine.requestRender());
  }, [engine, playing]);
}

/** Frame cadence of the rollout playback: the same ~30 fps as the decorative motion clock. */
export const PLAYBACK_MS = MOTION_FRAME_MS;

/** Rollout playback is simulation, not decoration: it plays whatever the Motion setting says. */
export function playbackActive(s: {
  on: boolean;
  loaded: boolean;
  walking: boolean;
  visible: boolean;
}): boolean {
  return s.on && s.loaded && s.walking && s.visible;
}

/** Asks for a render every PLAYBACK_MS until the returned stop is called. requestRender is
 * idempotent (it sets the dirty flag and schedules at most one animation frame), so this never
 * double-schedules with the decorative motion clock. */
export function startPlayback(requestRender: () => void): () => void {
  const id = setInterval(requestRender, PLAYBACK_MS);
  return () => clearInterval(id);
}
