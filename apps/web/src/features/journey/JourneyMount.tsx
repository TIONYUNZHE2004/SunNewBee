import { type RefObject, useCallback, useEffect, useState } from "react";
import type { Engine } from "../scene/three/engine";
import type { LocalFrame } from "../scene/three/frame";
import { JourneyOverlay } from "./JourneyOverlay";
import { journeyStateOf, useJourney } from "./journeyStore";
import { createJourneyLayer, type JourneyLayer } from "./three/journeyLayer";
import { projectToScreen } from "./three/project";
import { useJourneyDriver } from "./useJourneyDriver";
import { useMapInsets } from "./useMapInsets";

/**
 * Minimal journey mount for the Three.js map (D-T7): while the scene store holds a journey it adds
 * the ribbon and the event markers to the engine and shows the DOM overlay (label, HUD, mini-map,
 * event card). It never starts playback (D-T8's controls and hook do; D-T10 the demo auto-play).
 * The timeline is advanced only by D-T8's shared, ref-counted `useJourneyDriver` loop (mounted here
 * too, so the trip runs with the assistant panel closed); a change of `t` asks the engine for a
 * frame. Per-frame work happens only in the shown event card (see `EventCard` `track`).
 */
export function JourneyMount({
  engine,
  frame,
  hostRef,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  /** The map element: the side panel and phone sheet sizes are read from its CSS variables. */
  hostRef?: RefObject<HTMLElement | null>;
}) {
  // The one "plan being shown": the player's loaded plan (an intent, Watch the trip, or nothing
  // after Clear route / a profile or scenario change), never sceneStore.journey.
  const plan = useJourney((s) => s.plan);
  const [layer, setLayer] = useState<JourneyLayer | null>(null);

  useEffect(() => {
    if (!engine || !frame || !plan) return;
    const l = createJourneyLayer(plan, frame);
    engine.setJourney(l);
    setLayer(l);
    return () => {
      engine.setJourney(null); // disposes the layer
      setLayer(null);
    };
  }, [engine, frame, plan]);

  // The hold event marker grows.
  const activeEvent = useJourney((s) => {
    const st = journeyStateOf(s);
    return st?.phase.kind === "event" ? (st.eventIndex ?? null) : null;
  });
  useEffect(() => {
    if (!layer) return;
    layer.setActive(activeEvent);
    engine?.requestRender();
  }, [layer, activeEvent, engine]);

  // The single journey driver (ref-counted with the controls); render a frame when t moves.
  useJourneyDriver();
  useEffect(() => {
    if (!engine || !plan) return;
    return useJourney.subscribe((s, prev) => {
      if (s.t !== prev.t) engine.requestRender();
    });
  }, [engine, plan]);

  const project = useCallback(
    (i: number) => {
      const a = layer?.anchorOf(i);
      if (!a || !engine) return null;
      const v = engine.pickView();
      return projectToScreen(v.camera, a, v.size);
    },
    [layer, engine],
  );

  const subscribeFrame = useCallback(
    (cb: () => void) => (engine ? engine.onFrame(() => cb()) : () => {}),
    [engine],
  );
  const { viewport, miniMapRef } = useMapInsets(hostRef, !!plan && !!engine, () =>
    engine ? engine.pickView().size : [1, 1],
  );

  if (!plan || !engine) return null;
  return (
    <JourneyOverlay
      project={project}
      viewport={viewport}
      subscribeFrame={subscribeFrame}
      miniMapRef={miniMapRef}
    />
  );
}
