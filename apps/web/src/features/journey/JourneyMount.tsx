import { type RefObject, useCallback, useEffect, useState } from "react";
import type { LonLat } from "../scene/geo";
import type { Engine } from "../scene/three/engine";
import type { LocalFrame } from "../scene/three/frame";
import { JourneyOverlay } from "./JourneyOverlay";
import { journeyHero, journeyStateOf, useJourney } from "./journeyStore";
import { createHeroLayer } from "./three/heroLayer";
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
/** The engine decor slot the hero and her rest benches live in. */
export const HERO_SLOT = "journey-hero";

export function JourneyMount({
  engine,
  frame,
  hostRef,
  places,
  footprints,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  /** The map element: the side panel and phone sheet sizes are read from its CSS variables. */
  hostRef?: RefObject<HTMLElement | null>;
  /** Place ids to coordinates (the access layer): a rest's bench place, when it has one. */
  places?: ReadonlyMap<string, LonLat>;
  /** OSM building footprints (`/layers/buildings` `buildings`): bench seats keep clear of them. */
  footprints?: unknown;
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

  // The hero (D-T6): posed by the pure driver at every t (play or seek alike); what is drawn goes
  // to `journeyHero` (__journey.hero() and the crowd keep-out seam), with no second store update.
  useEffect(() => {
    if (!engine || !frame || !plan || !layer) return;
    const h = createHeroLayer(plan, layer.path, frame, {
      places,
      footprints,
      roots: () => engine.pickView().roots,
      onPose: (p) => {
        journeyHero.current = p;
        engine.requestRender();
      },
    });
    engine.setDecor(HERO_SLOT, { group: h.group, dispose: h.dispose });
    const apply = () => {
      const s = useJourney.getState();
      if (s.timeline && s.plan === plan) h.pose(s.timeline, s.t, s.playing);
    };
    apply();
    const unsub = useJourney.subscribe((s, prev) => {
      if (s.t !== prev.t || s.timeline !== prev.timeline || s.playing !== prev.playing) apply();
    });
    return () => {
      unsub();
      engine.setDecor(HERO_SLOT, null);
      journeyHero.current = null;
    };
  }, [engine, frame, plan, layer, places, footprints]);

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
