import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadProfile } from "../../lib/profileStore";
import type { LonLat } from "../scene/geo";
import { setTreeCut } from "../scene/three/assets/treeCut";
import { VFOV_DEG } from "../scene/three/cameraRig";
import { preloadHeroModel } from "../scene/three/characters/glbHero";
import type { Clearance } from "../scene/three/clearance";
import type { CameraDriver, Engine } from "../scene/three/engine";
import { releaseSlots } from "../scene/three/engineSlots";
import type { LocalFrame } from "../scene/three/frame";
import {
  elementPoint,
  type FollowScene,
  HERO_CHEST_Y,
  holdSubjects,
  type TrackMemo,
  trackMemoFor,
  warmTrack,
} from "../scene/three/journey/followRig";
import { heroPositionAt } from "../scene/three/journey/heroDriver";
import type { ViewFit } from "../scene/three/journey/safeFrame";
import type { CardViewport, PlacementLock } from "./cardPlacement";
import { holdCardLock } from "./cardTrack";
import { createFollowController, overviewFor, routeOverviewFit } from "./followCamera";
import { JourneyOverlay } from "./JourneyOverlay";
import {
  journeyCamera,
  journeyGrid,
  journeyHero,
  journeyShow,
  journeyStateOf,
  useJourney,
} from "./journeyStore";
import { probeCamera } from "./three/cameraProbe";
import { applyCutaway, cutFor, NO_CUT, setCut } from "./three/cutaway";
import { createHeroLayer, type FactBench, type HeroLayer } from "./three/heroLayer";
import { heroScreenRect } from "./three/heroScreen";
import { createJourneyLayer, type JourneyLayer, warmPinDrawings } from "./three/journeyLayer";
import { projectToScreen } from "./three/project";
import { createViewFit, safeRectOf } from "./three/viewFit";
import type { JourneyPlan } from "./timeline";
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
  // The layer is kept with the plan it was built for: in the commit where the plan changes, the
  // old (disposed) layer is not this plan's, so the hero and camera wait for the new one.
  const [layerState, setLayerState] = useState<{ plan: JourneyPlan; layer: JourneyLayer } | null>(
    null,
  );
  const layer = layerState && layerState.plan === plan ? layerState.layer : null;
  const heroRef = useRef<HeroLayer | null>(null);
  // The follow scene (pure camera inputs) while the camera effect runs: the event card's hold rule.
  const sceneRef = useRef<(() => FollowScene | null) | null>(null);

  useEffect(() => {
    if (!engine || !frame || !plan) return;
    const l = createJourneyLayer(plan, frame);
    engine.setJourney(l);
    setLayerState({ plan, layer: l });
    // heroColour false: her body drawn flat magenta (same geometry, order and depth, so shadows,
    // AO and the ribbon are untouched): the pixels that change are exactly her visible silhouette.
    const flat = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      transparent: true,
      toneMapped: false,
    });
    const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    journeyShow.current = (part, visible) => {
      if (part === "ribbon") l.ribbon.visible = visible;
      else if (!visible)
        heroRef.current?.hero.object3d.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || o.userData.heroPart === "ring" || saved.has(m)) return;
          saved.set(m, m.material);
          m.material = flat;
        });
      else {
        for (const [m, mat] of saved) m.material = mat;
        saved.clear();
      }
      engine.requestRender();
    };
    return () => {
      for (const [m, mat] of saved) m.material = mat;
      saved.clear();
      flat.dispose();
      journeyShow.current = null;
      engine.setJourney(null); // disposes the layer
      setLayerState(null);
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
      prepare: (o) => engine.prewarm?.(o) ?? Promise.resolve(),
      onPose: (p) => {
        journeyHero.current = p;
        engine.requestRender();
      },
    });
    engine.setDecor(HERO_SLOT, { group: h.group, dispose: h.dispose });
    heroRef.current = h;
    // Her ground table (a ~30 ms index of the drawn ground meshes) is built at the first idle
    // moment, not in the frame the answer lands (gate AC-D18); the dive starts from the overview,
    // where she is a speck, and she is posed on the default ground until then.
    let groundReady = false;
    const apply = () => {
      const s = useJourney.getState();
      if (groundReady) h.refreshGround();
      if (s.timeline && s.plan === plan) h.pose(s.timeline, s.t);
    };
    apply();
    const ric = globalThis as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const readyNow = () => {
      groundReady = true;
      apply();
    };
    const idleId = ric.requestIdleCallback
      ? ric.requestIdleCallback(readyNow, { timeout: 1200 })
      : (setTimeout(readyNow, 300) as unknown as number);
    const unsub = useJourney.subscribe((s, prev) => {
      if (s.t !== prev.t || s.timeline !== prev.timeline) apply();
    });
    // Ground tiles streaming in while paused: re-pose on the new height table. A slow timer, not a
    // frame listener (no per-frame work outside event cards); playback re-checks on every pose.
    const timer = setInterval(() => {
      if (groundReady && h.refreshGround()) apply();
    }, 500);
    return () => {
      unsub();
      clearInterval(timer);
      if (ric.requestIdleCallback && ric.cancelIdleCallback) ric.cancelIdleCallback(idleId);
      else clearTimeout(idleId as unknown as ReturnType<typeof setTimeout>);
      engine.setDecor(HERO_SLOT, null);
      journeyHero.current = null;
      if (heroRef.current === h) heroRef.current = null;
    };
  }, [engine, frame, plan, layer, places, footprints, grid, factBenches]);

  // The hero model of the current profile is loaded, parsed and drawn once off-screen at an idle
  // moment after the map loads: her skinned shadow variant was otherwise built by the driver on her
  // first real draw, in the second after the answer landed (gate AC-D18). Kept for the session.
  useEffect(() => {
    if (!engine?.warmDraw || import.meta.env.MODE === "test") return;
    let live = true;
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const go = () => {
      void preloadHeroModel(loadProfile()).then((m) => {
        if (!live || !m) return;
        void engine.prepare?.(m.object3d).then(() => {
          if (live) void engine.warmDraw?.(m.object3d, 3);
        });
      });
    };
    const id = ric ? ric(go) : setTimeout(go, 3000);
    return () => {
      live = false;
      if (!ric) clearTimeout(id as ReturnType<typeof setTimeout>);
    };
  }, [engine]);

  // The pin drawings (canvas text) are made at an idle moment, not when the answer lands.
  useEffect(() => {
    if (!engine) return;
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const id = ric ? ric(warmPinDrawings) : setTimeout(warmPinDrawings, 2000);
    return () => {
      const cic = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(id as number);
      else clearTimeout(id as ReturnType<typeof setTimeout>);
    };
  }, [engine]);

  // Building materials carry the (inactive) cutaway from their first compile (engine patch hook,
  // page load onwards): patching them when a trip loads, or as LOD buckets appear, recompiled
  // their programs on the main thread (gate AC-D18: 798 ms at answer landing).
  useEffect(() => {
    if (!engine?.addMaterialPatch) return;
    return engine.addMaterialPatch((root) => applyCutaway([root]));
  }, [engine]);

  // Decorative shader motion (tree sway, shimmer) runs on the trip clock while a trip is loaded:
  // a paused beat renders the same at any wall time (AC-D17).
  // The trip clock takes over once the trip has played (until then the motion clock runs on), so
  // loading a plan never makes the crowd and traffic jump; the take-over happens with the dive,
  // from the overview, where people and cars are specks.
  useEffect(() => {
    if (!engine?.setDecorClock || !plan) return;
    let started = false;
    const clock = () => {
      const s = useJourney.getState();
      if (s.plan !== plan || !s.timeline) return null;
      if (!started && (s.playing || s.t > 0)) started = true;
      return started ? s.t : null;
    };
    engine.setDecorClock(clock);
    // only its own clock: a Development Simulation that took the slot meanwhile keeps it
    return () => releaseSlots(engine, { clock });
  }, [engine, plan]);

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
    // The pull-back ends on the route's own overview, not the township's (gate §9.1 F4), fitted so
    // the whole route and every marker (the start and the final one included) sit in the UI-safe
    // area (iteration 2). Rebuilt when the view changes.
    const markers = plan.events
      .map((_, i) => layer.anchorOf(i))
      .filter((a): a is [number, number, number] => !!a);
    let end: { view: ViewFit | null; pose: FollowScene["overview"] } | null = null;
    const endPose = (view: ViewFit | null) => {
      if (!end || end.view !== view)
        end = {
          view,
          pose: routeOverviewFit(layer.path.pointAt, layer.path.planLength, view, markers),
        };
      return end.pose;
    };
    const overview = () => {
      const fit = engine.cameraFit?.() ?? null;
      if (!ov || ov.fit !== fit)
        ov = { fit, pose: overviewFor(engine, layer.path.pointAt, layer.path.planLength) };
      return ov.pose;
    };
    // The UI-safe hold fit's view (final gate, AC-D11): the engine camera's projection at the
    // follow camera's field of view (the dive widens the drawn one; a hold and the route overview
    // are framed at VFOV_DEG) and the map area no UI covers. Rebuilt only when the aspect, the
    // view offset, the canvas or the card viewport changes, so the camera track's memo keeps.
    let vf: { key: string; view: ViewFit } | null = null;
    const viewFit = (): ViewFit | null => {
      const v = engine.pickView();
      const cam = v.camera as THREE.PerspectiveCamera;
      if (!cam.isPerspectiveCamera) return null;
      const vp = viewportRef.current;
      const o = cam.view;
      const key = `${cam.aspect}|${o ? `${o.offsetX},${o.offsetY},${o.width},${o.height},${o.fullWidth},${o.fullHeight},${o.enabled}` : "-"}|${v.size[0]},${v.size[1]}|${vp.w},${vp.h},${vp.top ?? 0}`;
      if (!vf || vf.key !== key) {
        const follow = cam.clone();
        follow.fov = VFOV_DEG;
        follow.updateProjectionMatrix();
        vf = { key, view: createViewFit(follow, v.size, safeRectOf(vp)) };
      }
      return vf.view;
    };
    // The camera track's memo (iteration 2): one per follow-scene inputs.
    let memo: TrackMemo | null = null;
    const scene = (): FollowScene | null => {
      const s = useJourney.getState();
      const tl = s.timeline;
      if (!tl || s.plan !== plan) return null;
      const h = heroRef.current;
      const clearance = engine.clearance?.() ?? null;
      const ov = overview();
      const view = viewFit();
      memo = trackMemoFor(memo, [tl, clearance, ov, view, h]);
      return {
        timeline: tl,
        pointAt: layer.path.pointAt,
        seatOf: h ? (i) => h.seats.get(i) ?? null : undefined,
        destination,
        clearance,
        overview: ov,
        pullBackTo: endPose(view),
        heroAt: h ? (t) => heroPositionAt(tl, t, h.helpers) : undefined,
        markerOf: (i) => layer.anchorOf(i),
        view,
        track: memo,
      };
    };
    // The camera track is filled at idle moments ahead of the trip (pure values: no pose changes),
    // so the dive's first frame and a seek do not compute a window of samples at once (AC-D18).
    const ric = globalThis as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let warmId: number | undefined;
    let warmTimer: ReturnType<typeof setTimeout> | undefined;
    const warmSlice = () => {
      warmId = undefined;
      const sc = scene();
      // warm: look again in a second (a new memo when the building grid or the view changes)
      if (sc && warmTrack(sc, 6)) warmTimer = setTimeout(scheduleWarm, 1000);
      else if (sc) scheduleWarm();
      else warmTimer = setTimeout(scheduleWarm, 500);
    };
    const scheduleWarm = () => {
      if (warmId !== undefined) return;
      warmId = ric.requestIdleCallback
        ? ric.requestIdleCallback(warmSlice, { timeout: 1000 })
        : (setTimeout(warmSlice, 50) as unknown as number);
    };
    if (import.meta.env.MODE !== "test") scheduleWarm();
    const ctl = createFollowController({
      engine,
      scene,
      hero: () => (journeyHero.current ? [journeyHero.current.x, journeyHero.current.z] : null),
      focus: (p) => engine.setFocusPoint?.(p ? new THREE.Vector3(...p) : null),
    });
    // Each frame: the journey camera, then the cutaway around her for the camera that will draw,
    // and (following her) the decorative tree cut between the camera and her chest.
    const driver: CameraDriver = (now, current) => {
      const p = ctl.driver(now, current);
      const h = journeyHero.current;
      setCut(
        cutFor(
          h ? [h.x, h.z] : null,
          p ? p.position : current.position,
          engine.clearance?.() ?? null,
        ),
      );
      const following = !!p && !!h && useJourney.getState().camMode === "follow";
      // at an event hold, also the line to the event's element (the ramp, the crossing, the bench)
      const st = following ? journeyStateOf(useJourney.getState()) : null;
      const sc = st?.phase.kind === "event" && st.eventIndex !== undefined ? scene() : null;
      const el =
        sc && st?.eventIndex !== undefined ? elementPoint(sc, st.eventIndex, st.distance_m) : null;
      setTreeCut(
        following && p && h ? { a: p.position, b: [h.x, HERO_CHEST_Y, h.z], c: el } : null,
      );
      return p;
    };
    engine.setCameraDriver(driver);
    // Without the engine's material patch hook (tests), building materials get the (inactive)
    // cutaway here, ahead of need.
    const patch = () => applyCutaway(engine.pickView().roots);
    const patchTimer = engine.addMaterialPatch ? undefined : setInterval(patch, 1000);
    if (patchTimer !== undefined) patch();
    const unsub = useJourney.subscribe((s, prev) => {
      if (s.plan !== plan) return;
      if ((s.playing && !prev.playing) || s.t !== prev.t || s.camMode !== prev.camMode)
        ctl.engage();
      if (s.camMode !== prev.camMode || s.playing !== prev.playing) engine.requestRender();
    });
    sceneRef.current = scene;
    journeyGrid.current = () => engine.clearance?.()?.obstacles ?? null;
    journeyCamera.current = () => {
      const v = engine.pickView();
      const st = journeyStateOf(useJourney.getState());
      const sc = scene();
      const idx = st?.phase.kind === "event" ? st.eventIndex : undefined;
      const el = sc && idx !== undefined ? elementPoint(sc, idx, st?.distance_m) : null;
      const vp = viewportRef.current;
      // the UI-safe hold fit as the rig sees it now: its safe area and her / the element / the
      // marker projected from the drawn camera (acceptance diagnostics)
      const cam = v.camera as THREE.PerspectiveCamera;
      const pose = {
        pos: cam.position.toArray() as [number, number, number],
        look: cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3())).toArray() as [
          number,
          number,
          number,
        ],
      };
      const safeFit =
        sc?.view && idx !== undefined && st
          ? {
              safe: sc.view.safe,
              subjects: holdSubjects(sc, useJourney.getState().t, idx, st.distance_m).map((q) =>
                sc.view?.project(pose, q.p),
              ),
              canvas: v.size,
            }
          : null;
      const probe = probeCamera({
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
      return { ...probe, safeFit };
    };
    return () => {
      clearTimeout(warmTimer);
      if (warmId !== undefined) {
        if (ric.requestIdleCallback && ric.cancelIdleCallback) ric.cancelIdleCallback(warmId);
        else clearTimeout(warmId as unknown as ReturnType<typeof setTimeout>);
      }
      unsub();
      clearInterval(patchTimer);
      setCut(NO_CUT);
      setTreeCut(null);
      releaseSlots(engine, { driver }); // only its own: devsim may hold the slot by now
      engine.setFocusPoint?.(null);
      journeyCamera.current = null;
      if (sceneRef.current === scene) sceneRef.current = null;
      journeyGrid.current = null;
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

  // The event card's hold rule (iteration 2: no side switch within a hold), from the pure journey
  // camera; recomputed only when the hold, the card size, the viewport, the mode or the scene's
  // camera inputs change.
  const lockCache = useRef<{ key: unknown[]; lock: PlacementLock | null } | null>(null);
  const cardLock = useCallback(
    (i: number, card: { w: number; h: number }, vp: CardViewport): PlacementLock | null => {
      const sc = sceneRef.current?.();
      if (!sc) return null;
      const mode = useJourney.getState().camMode;
      const key = [i, card.w, card.h, vp, mode, sc.timeline, sc.view, sc.track, sc.clearance];
      const c = lockCache.current;
      if (c && c.key.length === key.length && c.key.every((v, k) => v === key[k])) return c.lock;
      const lock = holdCardLock(sc, i, mode, card, vp);
      lockCache.current = { key, lock };
      return lock;
    },
    [],
  );

  if (!plan || !engine) return null;
  return (
    <JourneyOverlay
      project={project}
      viewport={viewport}
      subscribeFrame={subscribeFrame}
      miniMapRef={miniMapRef}
      heroRect={heroRect}
      cardLock={cardLock}
    />
  );
}
