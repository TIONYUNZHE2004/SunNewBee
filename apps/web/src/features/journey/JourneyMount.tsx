import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { LonLat } from "../scene/geo";
import type { Clearance } from "../scene/three/clearance";
import type { Engine } from "../scene/three/engine";
import type { LocalFrame } from "../scene/three/frame";
import { elementPoint, type FollowScene } from "../scene/three/journey/followRig";
import { heroStateAt } from "../scene/three/journey/heroDriver";
import { createFollowController, overviewFor } from "./followCamera";
import { JourneyOverlay } from "./JourneyOverlay";
import { journeyCamera, journeyHero, journeyStateOf, useJourney } from "./journeyStore";
import { probeCamera } from "./three/cameraProbe";
import { applyCutaway, cutFor, NO_CUT, setCut } from "./three/cutaway";
import { createHeroLayer, type FactBench, type HeroLayer } from "./three/heroLayer";
import { heroScreenRect } from "./three/heroScreen";
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
  factBenches,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  /** The map element: the side panel and phone sheet sizes are read from its CSS variables. */
  hostRef?: RefObject<HTMLElement | null>;
  /** Place ids to coordinates (the access layer): a rest's bench place, when it has one. */
  places?: ReadonlyMap<string, LonLat>;
  /** OSM building footprints (`/layers/buildings` `buildings`): bench seats keep clear of them. */
  footprints?: unknown;
  /** The street dressing's fact benches (B-T7): a rest with one within ~3 m sits on it. */
  factBenches?: readonly FactBench[];
}) {
  // The one "plan being shown": the player's loaded plan (an intent, Watch the trip, or nothing
  // after Clear route / a profile or scenario change), never sceneStore.journey.
  const plan = useJourney((s) => s.plan);
  const [layer, setLayer] = useState<JourneyLayer | null>(null);
  const heroRef = useRef<HeroLayer | null>(null);

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

  // The drawn-building grid (A-T7), once the city is in: seats keep out of drawn boxes (D-T5 ruling).
  const [grid, setGrid] = useState<Clearance | null>(null);
  useEffect(() => {
    if (!engine || !plan) return;
    const poll = () => setGrid(engine.clearance?.() ?? null);
    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [engine, plan]);

  // The hero (D-T6): posed by the pure driver at every t (play or seek alike); what is drawn goes
  // to `journeyHero` (__journey.hero() and the crowd keep-out seam), with no second store update.
  useEffect(() => {
    if (!engine || !frame || !plan || !layer) return;
    const h = createHeroLayer(plan, layer.path, frame, {
      places,
      footprints,
      grid,
      factBenches,
      roots: () => engine.pickView().roots,
      groundGeneration: () => engine.groundGeneration ?? 0,
      onPose: (p) => {
        journeyHero.current = p;
        engine.requestRender();
      },
    });
    engine.setDecor(HERO_SLOT, { group: h.group, dispose: h.dispose });
    heroRef.current = h;
    const apply = () => {
      const s = useJourney.getState();
      h.refreshGround();
      if (s.timeline && s.plan === plan) h.pose(s.timeline, s.t);
    };
    apply();
    const unsub = useJourney.subscribe((s, prev) => {
      if (s.t !== prev.t || s.timeline !== prev.timeline) apply();
    });
    // Ground tiles streaming in while paused: re-pose on the new height table. A slow timer, not a
    // frame listener (no per-frame work outside event cards); playback re-checks on every pose.
    const timer = setInterval(() => {
      if (h.refreshGround()) apply();
    }, 500);
    return () => {
      unsub();
      clearInterval(timer);
      engine.setDecor(HERO_SLOT, null);
      journeyHero.current = null;
      if (heroRef.current === h) heroRef.current = null;
    };
  }, [engine, frame, plan, layer, places, footprints, grid, factBenches]);

  const { viewport, miniMapRef } = useMapInsets(hostRef, !!plan && !!engine, () =>
    engine ? engine.pickView().size : [1, 1],
  );
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // The follow camera (D-T5): once the player is used (play, seek, a camera mode), the engine's
  // camera is the journey camera at t (follow with per-event framing, overview), until Free mode or
  // the end of the trip hands it back to the orbit rig.
  useEffect(() => {
    if (!engine?.setCameraDriver || !frame || !plan || !layer) return;
    const arrive = plan.events.find((e) => e.kind === "arrive");
    const destLl = arrive?.element_id ? places?.get(arrive.element_id) : undefined;
    const destination = destLl ? frame.toLocal(destLl[0], destLl[1]) : null;
    let ov: { fit: unknown; pose: FollowScene["overview"] } | null = null;
    const overview = () => {
      const fit = engine.cameraFit?.() ?? null;
      if (!ov || ov.fit !== fit)
        ov = { fit, pose: overviewFor(engine, layer.path.pointAt, layer.path.planLength) };
      return ov.pose;
    };
    const scene = (): FollowScene | null => {
      const s = useJourney.getState();
      const tl = s.timeline;
      if (!tl || s.plan !== plan) return null;
      const h = heroRef.current;
      return {
        timeline: tl,
        pointAt: layer.path.pointAt,
        seatOf: h ? (i) => h.seats.get(i) ?? null : undefined,
        destination,
        clearance: engine.clearance?.() ?? null,
        overview: overview(),
        heroAt: h
          ? (t) => {
              const st = heroStateAt(tl, t, h.helpers);
              return [st.x, st.z];
            }
          : undefined,
      };
    };
    const ctl = createFollowController({
      engine,
      scene,
      hero: () => (journeyHero.current ? [journeyHero.current.x, journeyHero.current.z] : null),
      focus: (p) => engine.setFocusPoint?.(p ? new THREE.Vector3(...p) : null),
    });
    // Each frame: the journey camera, then the cutaway around her for the camera that will draw.
    engine.setCameraDriver((now, current) => {
      const p = ctl.driver(now, current);
      const h = journeyHero.current;
      setCut(
        cutFor(
          h ? [h.x, h.z] : null,
          p ? p.position : current.position,
          engine.clearance?.() ?? null,
        ),
      );
      return p;
    });
    // Building materials get the (inactive) cutaway ahead of need: no shader compile mid-trip.
    const patch = () => applyCutaway(engine.pickView().roots);
    patch();
    const patchTimer = setInterval(patch, 1000);
    const unsub = useJourney.subscribe((s, prev) => {
      if (s.plan !== plan) return;
      if ((s.playing && !prev.playing) || s.t !== prev.t || s.camMode !== prev.camMode)
        ctl.engage();
      if (s.camMode !== prev.camMode || s.playing !== prev.playing) engine.requestRender();
    });
    journeyCamera.current = () => {
      const v = engine.pickView();
      const st = journeyStateOf(useJourney.getState());
      const sc = scene();
      const idx = st?.phase.kind === "event" ? st.eventIndex : undefined;
      const el = sc && idx !== undefined ? elementPoint(sc, idx, st?.distance_m) : null;
      const vp = viewportRef.current;
      return probeCamera({
        camera: v.camera as THREE.PerspectiveCamera,
        driven: engine.cameraDriven?.() ?? false,
        cameraT: ctl.drivenT,
        canvas: v.size,
        frame: { w: vp.w, h: vp.h },
        hero: heroRef.current?.hero.object3d ?? null,
        roots: v.roots,
        clearance: engine.clearance?.() ?? null,
        element:
          el && idx !== undefined
            ? { index: idx, kind: plan.events[idx]?.kind ?? "", point: el }
            : null,
      });
    };
    return () => {
      unsub();
      clearInterval(patchTimer);
      setCut(NO_CUT);
      engine.setCameraDriver?.(null);
      engine.setFocusPoint?.(null);
      journeyCamera.current = null;
    };
  }, [engine, frame, plan, layer, places]);

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
  const heroRect = useCallback(() => {
    if (!engine) return null;
    const v = engine.pickView();
    return heroScreenRect(heroRef.current?.hero.object3d, v.camera, v.size);
  }, [engine]);

  if (!plan || !engine) return null;
  return (
    <JourneyOverlay
      project={project}
      viewport={viewport}
      subscribeFrame={subscribeFrame}
      miniMapRef={miniMapRef}
      heroRect={heroRect}
    />
  );
}
