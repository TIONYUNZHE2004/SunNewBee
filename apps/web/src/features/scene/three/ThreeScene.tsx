import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBuildings, useLayer, useSite } from "../../../lib/api";
import { useTheme } from "../../../ui/theme";
import { usePanel } from "../../main/panelStore";
import { isWide } from "../../main/usePanelReserve";
import { PANEL_INSET_PX, panelWidthPx } from "../../main/viewport";
import { InSlot } from "../../map-ui/mapSlots";
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
import { createCityInstances } from "./assets/cityInstances";
import { type AssetLibrary, loadAssetLibrary } from "./assets/library";
import { MANIFEST_URL, type Manifest, parseManifest } from "./assets/manifest";
import { planCity } from "./assets/plan";
import { createRoleUniforms } from "./assets/roleMaterial";
import { showroomBounds, showroomManifest, showroomPlan } from "./assets/showroom";
import { BOOKMARKS, bookmarkFromSearch, DEFAULT_BOOKMARK, HERO_CENTRE } from "./bookmarks";
import { createThreeCameraOps, type Pose, type ThreeCameraOps, VFOV_DEG } from "./cameraRig";
import { buildCityGeometry, type CityGeometry } from "./cityMesh";
import { createEngine, type Engine } from "./engine";
import { cesiumEngineHref } from "./engineChoice";
import { createFrame, type LocalFrame } from "./frame";
import { createFrameStats } from "./frameStats";
import { boundsGoal, type CameraGoal, intentGoal } from "./intents";
import { keyLightDir, LIGHT_PRESETS } from "./lighting";
import { lineToLocal } from "./routeLine";

const INTENT_PITCH_DEG = -45;
const WHOLE_PITCH_DEG = -50;
const FLY_MS = 1800;
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

/** Bottom-left map note (clear of the camera cluster and the attribution strip). */
function ExperimentalEngineChip() {
  return (
    <InSlot name="notes">
      <p
        role="note"
        className="flex items-center gap-1 rounded-full border border-edge bg-surface/95 px-3 py-1 text-xs text-fg shadow-md"
      >
        Experimental 3D engine ·{" "}
        <a className="font-medium underline" href={cesiumEngineHref(location.href)}>
          Switch back
        </a>
      </p>
    </InSlot>
  );
}

const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

type AssetsState = "off" | "loading" | "ready" | "failed";
interface LoadedAssets {
  manifest: Manifest;
  lib: AssetLibrary;
}
const ASSET_WARN = "TownshipLens 3D: city assets unavailable, drawing the extruded city";
const PARTIAL_WARN = "TownshipLens 3D: some city assets were dropped and stay extruded";

/**
 * The manifest plus its dropped-entry problems, or a throw for 404, a body that is not JSON
 * (Vite's index.html) or a bad shape. Never warns: the caller sends one warning per load.
 */
async function fetchManifest(
  signal: AbortSignal,
): Promise<{ manifest: Manifest; problems: string[] }> {
  const r = await fetch(MANIFEST_URL, { signal });
  if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
  let body: unknown;
  try {
    body = JSON.parse(await r.text());
  } catch {
    throw new Error("manifest is not JSON");
  }
  const { manifest, problems } = parseManifest(body);
  if (!manifest) throw new Error(`manifest rejected: ${problems.join("; ")}`);
  if (Object.keys(manifest.assets).length === 0)
    throw new Error(`manifest has no assets${problems.length ? `: ${problems.join("; ")}` : ""}`);
  return { manifest, problems };
}

/** One line naming every failed glb and every dropped manifest entry. */
function describeFailures(
  failed: readonly { asset: string; reason: string }[],
  problems: string[],
) {
  const parts: string[] = [];
  if (failed.length > 0)
    parts.push(`glbs failed: ${failed.map((f) => `${f.asset} (${f.reason})`).join(", ")}`);
  if (problems.length > 0) parts.push(`manifest entries dropped: ${problems.join("; ")}`);
  return parts.join("; ");
}

const SHOWROOM_MIN_RANGE_M = 150;
/** A top-down-ish view that fits a local xz box inside the 30 degree vertical field of view. */
function fitPose(b: { min: [number, number]; max: [number, number] }): Pose {
  const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2;
  return {
    target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2],
    rangeM: Math.max(SHOWROOM_MIN_RANGE_M, (radius / Math.tan((VFOV_DEG / 2) * RAD)) * 1.1),
    pitchDeg: WHOLE_PITCH_DEG,
    headingDeg: 0,
  };
}

const geometryBytes = (g: CityGeometry) => {
  let n = 0;
  for (const geo of [g.buildings, g.parks, g.water])
    for (const a of Object.values(geo.attributes)) n += a.array.byteLength;
  return n;
};
const MB = 1024 * 1024;

/** Three.js stylised city (opt-in with `?engine=three`). All WebGL lives in `engine.ts`. */
export default function ThreeScene({
  onOps,
  createEngineFn = createEngine,
}: {
  onOps?: (ops: CameraOps | null) => void;
  createEngineFn?: typeof createEngine;
} = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  // `?assets=0` keeps the extruded city only; `?showroom=1` lays out every asset for owner review.
  const [assetsOn, showroom] = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return [q.get("assets") !== "0", q.get("showroom") === "1"];
  }, []);
  const [assetsState, setAssetsState] = useState<AssetsState>(assetsOn ? "loading" : "off");
  const [loaded, setLoaded] = useState<LoadedAssets | null>(null);
  const [instances, setInstances] = useState(0);
  const roleUniforms = useMemo(createRoleUniforms, []);
  /** True while the engine holds instances built from the current library. */
  const handedOff = useRef(false);
  /** The engine whose camera already framed the showroom (once, so the owner can then look around). */
  const showroomFramed = useRef<Engine | null>(null);

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
  // A fresh canvas per engine: dispose() forces its context lost, so a remount (StrictMode, HMR)
  // must never reuse it. Construction and runtime failures (context lost, shader errors) go to the
  // error boundary through `failure`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    host.appendChild(canvas);
    let e: Engine;
    try {
      e = createEngineFn(canvas, initialTier.current);
    } catch (err) {
      canvas.remove();
      setFailure(asError(err));
      return;
    }
    const offFatal = e.onFatal((err) => setFailure(err));
    setEngine(e);
    return () => {
      offFatal();
      setEngine(null);
      e.dispose();
      canvas.remove();
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

  // City assets: manifest, then the glb library (aborted on unmount). Any failure leaves the full
  // extruded city drawn, with data-assets="failed" and one warning.
  useEffect(() => {
    if (!engine || !assetsOn) return;
    const ac = new AbortController();
    let lib: AssetLibrary | null = null;
    setAssetsState("loading");
    (async () => {
      const { manifest, problems } = await fetchManifest(ac.signal);
      const got = await loadAssetLibrary(manifest, { signal: ac.signal });
      // Aborted after the library resolved: the cleanup has already run, so free it here.
      if (ac.signal.aborted) {
        got.dispose();
        return;
      }
      lib = got;
      const why = describeFailures(got.failed, problems);
      if (!Object.keys(manifest.assets).some((id) => got.has(id))) {
        got.dispose();
        lib = null;
        console.warn(`${ASSET_WARN}: ${why || "no asset loaded"}`);
        setAssetsState("failed");
        return;
      }
      // Partial: the buildings of failed assets fall back to extrusion through has().
      if (why) console.warn(`${PARTIAL_WARN}: ${why}`);
      setLoaded({ manifest, lib: got });
    })().catch((err: unknown) => {
      if (ac.signal.aborted) return;
      console.warn(`${ASSET_WARN}: ${String(err)}`);
      setAssetsState("failed");
    });
    return () => {
      ac.abort();
      // The engine drops (and disposes) the instances before the library frees their geometry.
      if (handedOff.current) engine.setAssets(null);
      handedOff.current = false;
      lib?.dispose();
      setLoaded(null);
    };
  }, [engine, assetsOn]);

  useEffect(() => {
    if (!engine || !frame || !buildings) return;
    const full = () => {
      const g = buildCityGeometry(buildings, frame);
      engine.setCity(g);
      setInstances(0);
      usePerfStats.getState().update({ gpuMB: geometryBytes(g) / MB });
    };
    if (!loaded) {
      full();
      return;
    }
    const { manifest, lib } = loaded;
    try {
      const m = showroom ? showroomManifest(manifest) : manifest;
      const plan = showroom
        ? showroomPlan(m, frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]))
        : planCity(buildings, frame, manifest, lib.has);
      const inst = createCityInstances(lib, plan, m, roleUniforms);
      const g = buildCityGeometry(buildings, frame, { only: plan.extrude });
      engine.setCity(g);
      engine.setAssets(inst);
      handedOff.current = true;
      if (showroom && showroomFramed.current !== engine) {
        showroomFramed.current = engine;
        engine.rig.set(fitPose(showroomBounds(plan, m)));
      }
      setInstances(plan.stats.units + plan.landmarks.length);
      setAssetsState("ready");
      usePerfStats.getState().update({
        gpuMB: (geometryBytes(g) + lib.gpuBytes() + inst.stats().gpuBytes) / MB,
      });
    } catch (err) {
      // Once per load: drop the library, so later buildings refetches draw the full city silently.
      console.warn(`${ASSET_WARN}: ${String(err)}`);
      if (handedOff.current) engine.setAssets(null);
      handedOff.current = false;
      lib.dispose();
      setLoaded(null);
      full();
      setAssetsState("failed");
    }
  }, [engine, frame, buildings, loaded, showroom, roleUniforms]);

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

  // `data-frames` (first frames at once, then at most every 500 ms) and the compass heading follow
  // every engine frame; separate from the tier listener below so a tier change never drops a count.
  const [frames, setFrames] = useState(0);
  const tierRef = useRef(tier);
  tierRef.current = tier;
  useEffect(() => {
    if (!engine) return;
    const stats = createFrameStats({
      frames: setFrames,
      perf: (p) => usePerfStats.getState().update({ ...p, tier: tierRef.current }),
    });
    const off = engine.onFrame((dt, info) => {
      const heading = engine.rig.get().headingDeg * RAD;
      if (useCameraHeading.getState().heading !== heading) useCameraHeading.setState({ heading });
      stats.frame(engine.frames, dt, info.calls, info.tris);
    });
    return () => {
      off();
      stats.dispose();
    };
  }, [engine]);

  // Auto-drop (auto quality only) and the slow-device banner (Low only).
  useEffect(() => {
    if (!engine) return;
    usePerfStats.getState().update({ tier });
    const autoMonitor =
      quality === "auto"
        ? createFrameMonitor(() => setDropped((d) => lowerTier(d ?? detected)))
        : null;
    const slowMonitor =
      tier === "low"
        ? createFrameMonitor(() => usePerfStats.getState().update({ slow: true }), { minFps: 15 })
        : null;
    if (tier !== "low") usePerfStats.getState().update({ slow: false });
    if (!autoMonitor && !slowMonitor) return;
    return engine.onFrame((dt, info) => {
      autoMonitor?.sample(dt, info.moving);
      slowMonitor?.sample(dt, info.moving);
    });
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
    // Double-click glides in to the ground point under the pointer (as on the Cesium map).
    const host = hostRef.current;
    const onDblClick = (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      o.glideTo({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    host?.addEventListener("dblclick", onDblClick);
    return () => {
      host?.removeEventListener("dblclick", onDblClick);
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
      data-assets={assetsState}
      data-instances={instances}
      className="relative h-full w-full"
      style={{ background: LIGHT_PRESETS[theme].background }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the 3D map takes keyboard focus for WASD/QE/RF
      tabIndex={0}
      aria-label="3D map. Arrow keys or WASD move, Q and E rotate, R and F tilt, plus and minus zoom, N faces north."
      onKeyDown={(e) => handleMapKey(e, ops)}
    >
      <div ref={hostRef} className="absolute inset-0" />
      <CameraControls ops={ops} />
      <PerfOverlay />
      <SlowBanner />
      <ExperimentalEngineChip />
    </section>
  );
}
