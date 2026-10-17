import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBuildings, useLayer, useSite } from "../../../lib/api";
import { useTheme } from "../../../ui/theme";
import { usePanel } from "../../main/panelStore";
import { isWide } from "../../main/usePanelReserve";
import { PANEL_INSET_PX, panelWidthPx } from "../../main/viewport";
import { CameraControls, handleMapKey } from "../cesium/controls/CameraControls";
import { useCameraHeading } from "../cesium/controls/cameraHeadingStore";
import { type CameraOps, reducedMotion } from "../cesium/controls/cameraOps";
import { homeView } from "../cesium/home";
import { PerfOverlay, SlowBanner, usePerfStats } from "../cesium/PerfOverlay";
import {
  createFrameMonitor,
  gpuName,
  lowerTier,
  pickTier,
  type Tier,
} from "../cesium/stylised/quality";
import { type LonLat, pointFeatures } from "../geo";
import { useSceneSettings } from "../sceneSettingsStore";
import { useScene } from "../sceneStore";
import { BOOKMARKS, bookmarkFromSearch, DEFAULT_BOOKMARK } from "./bookmarks";
import { createThreeCameraOps, type Pose, type ThreeCameraOps } from "./cameraRig";
import { buildCityGeometry } from "./cityMesh";
import { createEngine, type Engine } from "./engine";
import { createFrame, type LocalFrame } from "./frame";
import { boundsGoal, type CameraGoal, intentGoal } from "./intents";
import { keyLightDir, LIGHT_PRESETS } from "./lighting";
import { lineToLocal } from "./routeLine";

const INTENT_PITCH_DEG = -45;
const WHOLE_PITCH_DEG = -50;
const FLY_MS = 1800;
const FRAMES_PUBLISH_MS = 500;
const PERF_PUBLISH_MS = 250;
const RAD = Math.PI / 180;

const goalPose = (g: CameraGoal, frame: LocalFrame, pitchDeg: number): Pose => ({
  target: frame.toLocal(g.centre[0], g.centre[1]),
  rangeM: g.rangeM,
  pitchDeg,
  headingDeg: 0,
});

/** The start view: `?bookmark=` when given, else the default gate bookmark. */
function startPose(frame: LocalFrame): Pose {
  const b = BOOKMARKS[bookmarkFromSearch(location.search) ?? DEFAULT_BOOKMARK];
  return {
    target: frame.toLocal(b.centre[0], b.centre[1]),
    rangeM: b.rangeM,
    pitchDeg: b.pitchDeg,
    headingDeg: b.headingDeg,
  };
}

const bboxCorners = (b: number[] | undefined): LonLat[] =>
  b?.length === 4
    ? [
        [b[0] as number, b[1] as number],
        [b[2] as number, b[3] as number],
      ]
    : [];

/** Three.js stylised city (opt-in with `?engine=three`). All WebGL lives in `engine.ts`. */
export default function ThreeScene({
  onOps,
  createEngineFn = createEngine,
}: {
  onOps?: (ops: CameraOps | null) => void;
  createEngineFn?: typeof createEngine;
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  const site = useSite().data;
  const buildings = useBuildings().data;
  const theme = useTheme((s) => s.theme);
  const quality = useSceneSettings((s) => s.quality);
  const panelOpen = usePanel((s) => s.open);
  const route = useScene((s) => s.route);
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const access = useLayer("access", profile, scenarioId);

  const center = site?.center;
  const frame = useMemo(
    () =>
      center && Number.isFinite(center[0]) && Number.isFinite(center[1])
        ? createFrame([center[0] as number, center[1] as number])
        : null,
    [center],
  );

  // Same place lookup as CesiumScene: place ids to coordinates from the access layer.
  const placesRef = useRef(new Map<string, LonLat>());
  placesRef.current = new Map(pointFeatures(access.data).map((p) => [p.id, p.coord]));
  const focusPoint = useCallback((id: string) => placesRef.current.get(id) ?? null, []);

  // The initial tier: the user's choice, else Medium until the GPU is known.
  const initialTier = useRef<Tier>(quality === "auto" ? "medium" : quality);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let e: Engine;
    try {
      e = createEngineFn(canvas, initialTier.current);
    } catch (err) {
      setFailure(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    setEngine(e);
    return () => {
      setEngine(null);
      e.dispose();
    };
  }, [createEngineFn]);

  // Canvas size.
  useEffect(() => {
    const el = sectionRef.current;
    if (!engine || !el) return;
    const apply = () => engine.resize(el.clientWidth, el.clientHeight);
    apply();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine]);

  // Camera bounds: the site extent until the city arrives (setCity replaces them).
  const bbox = site?.bbox;
  useEffect(() => {
    if (!engine || !frame || bbox?.length !== 4) return;
    const a = frame.toLocal(bbox[0] as number, bbox[1] as number);
    const b = frame.toLocal(bbox[2] as number, bbox[3] as number);
    engine.setBounds({
      min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
      max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    });
  }, [engine, frame, bbox]);

  useEffect(() => {
    if (!engine || !frame || !buildings) return;
    engine.setCity(buildCityGeometry(buildings, frame));
  }, [engine, frame, buildings]);

  // Frame the start view once per engine, as soon as the local frame exists.
  const framed = useRef<Engine | null>(null);
  useEffect(() => {
    if (!engine || !frame || framed.current === engine) return;
    framed.current = engine;
    engine.rig.set(startPose(frame));
  }, [engine, frame]);

  const routePositions = useMemo(
    () => (route && frame ? lineToLocal(route.geojson.coordinates as LonLat[], frame) : null),
    [route, frame],
  );
  const routeOn = !!engine && !!routePositions && routePositions.length >= 6;
  useEffect(() => {
    if (!engine) return;
    engine.setRoute(routeOn ? routePositions : null);
  }, [engine, routeOn, routePositions]);

  // Scene intents to camera moves (same precedence as cesium/camera.ts).
  useEffect(() => {
    if (!engine || !frame) return;
    return useScene.subscribe((s, prev) => {
      const goal = intentGoal(s, prev, focusPoint);
      if (!goal) return;
      const pose = goalPose(goal, frame, INTENT_PITCH_DEG);
      if (reducedMotion()) engine.rig.set(pose);
      else engine.rig.flyTo(pose, FLY_MS);
    });
  }, [engine, frame, focusPoint]);

  // Lighting per mood; the key light follows the real sun by day (display only).
  const home = homeView(site);
  useEffect(() => {
    if (!engine) return;
    engine.setLighting(LIGHT_PRESETS[theme], keyLightDir(theme, new Date(), home.lat, home.lon));
  }, [engine, theme, home.lat, home.lon]);

  // Look point in the middle of the map area left of the side panel (phones use the sheet).
  useEffect(() => {
    if (!engine) return;
    const panel = isWide() && panelOpen ? panelWidthPx(innerWidth) + PANEL_INSET_PX * 2 : 0;
    engine.setViewOffset(panel);
  }, [engine, panelOpen]);

  // Quality tier: the user's choice, or the GPU-picked tier lowered by the frame monitor.
  const detected = useMemo<Tier>(
    () =>
      engine
        ? pickTier(
            gpuName(engine.gl()),
            (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          )
        : "medium",
    [engine],
  );
  const [dropped, setDropped] = useState<Tier | null>(null);
  const tier: Tier = quality === "auto" ? (dropped ?? detected) : quality;
  useEffect(() => {
    engine?.setTier(tier);
  }, [engine, tier]);

  // One frame listener: auto-drop (auto quality only), slow-device banner (Low only), perf stats,
  // the compass heading and `data-frames` (at most every 500 ms, with a trailing update).
  const [frames, setFrames] = useState(0);
  useEffect(() => {
    if (!engine) return;
    const autoMonitor =
      quality === "auto"
        ? createFrameMonitor(() => setDropped((d) => lowerTier(d ?? detected)))
        : null;
    const slowMonitor =
      tier === "low"
        ? createFrameMonitor(() => usePerfStats.getState().update({ slow: true }), { minFps: 15 })
        : null;
    if (tier !== "low") usePerfStats.getState().update({ slow: false });
    const recent: number[] = [];
    let lastPublish = 0;
    let framesTimer: ReturnType<typeof setTimeout> | undefined;
    const off = engine.onFrame((dt, info) => {
      autoMonitor?.sample(dt, info.moving);
      slowMonitor?.sample(dt, info.moving);
      const heading = engine.rig.get().headingDeg * RAD;
      if (useCameraHeading.getState().heading !== heading) useCameraHeading.setState({ heading });
      framesTimer ??= setTimeout(() => {
        framesTimer = undefined;
        setFrames(engine.frames);
      }, FRAMES_PUBLISH_MS);
      if (dt > 0 && dt <= 500) {
        recent.push(dt);
        if (recent.length > 30) recent.shift();
      }
      const now = performance.now();
      if (now - lastPublish < PERF_PUBLISH_MS || recent.length === 0) return;
      lastPublish = now;
      const frameMs = recent.reduce((a, b) => a + b, 0) / recent.length;
      usePerfStats.getState().update({ fps: 1000 / frameMs, frameMs, drawCalls: info.calls, tier });
    });
    return () => {
      off();
      clearTimeout(framesTimer);
    };
  }, [engine, quality, detected, tier]);
  useEffect(() => () => usePerfStats.getState().update({ slow: false }), []);

  // Camera actions (buttons, keyboard, double-click).
  const startRef = useRef<() => Pose>(() => ({
    target: [0, 0],
    rangeM: 1200,
    pitchDeg: -35,
    headingDeg: 0,
  }));
  const wholeRef = useRef<() => Pose>(startRef.current);
  if (frame) {
    startRef.current = () => startPose(frame);
    wholeRef.current = () => {
      const g = boundsGoal(bboxCorners(bbox)) ?? {
        centre: BOOKMARKS.township.centre,
        rangeM: BOOKMARKS.township.rangeM,
      };
      return goalPose(g, frame, WHOLE_PITCH_DEG);
    };
  }
  const [ops, setOps] = useState<ThreeCameraOps | null>(null);
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;
  useEffect(() => {
    if (!engine) return;
    const o = createThreeCameraOps(
      engine.rig,
      () => startRef.current(),
      () => wholeRef.current(),
    );
    setOps(o);
    onOpsRef.current?.(o);
    return () => {
      setOps(null);
      onOpsRef.current?.(null);
    };
  }, [engine]);

  // To the renderer error boundary (MapStage falls back to Mapbox or List).
  if (failure) throw failure;
  return (
    <section
      ref={sectionRef}
      data-testid="three-scene"
      data-frames={frames}
      data-route={routeOn ? "on" : "off"}
      className="relative h-full w-full"
      style={{ background: LIGHT_PRESETS[theme].background }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the 3D map takes keyboard focus for WASD/QE/RF
      tabIndex={0}
      aria-label="3D map. Arrow keys or WASD move, Q and E rotate, R and F tilt, plus and minus zoom, N faces north."
      onKeyDown={(e) => handleMapKey(e, ops)}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ops?.glideTo({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
      />
      <CameraControls ops={ops} />
      <PerfOverlay />
      <SlowBanner />
    </section>
  );
}
