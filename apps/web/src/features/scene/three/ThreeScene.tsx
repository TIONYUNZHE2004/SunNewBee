import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  useBuildings,
  useEvacCentres,
  useGaps,
  useLayer,
  useScenarioWater,
  useSite,
} from "../../../lib/api";
import { useTheme } from "../../../ui/theme";
import { gapsActive } from "../../gaps/gapModel";
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
import { prefersReducedMotion, useSceneSettings } from "../sceneSettingsStore";
import { useScene } from "../sceneStore";
import { createAmbient } from "./ambient/ambient";
import { createCityInstances } from "./assets/cityInstances";
import type { Placement } from "./assets/fit";
import { type AssetLibrary, loadAssetLibrary } from "./assets/library";
import { MANIFEST_URL, type Manifest, parseManifest } from "./assets/manifest";
import { type CityPlan, planCity } from "./assets/plan";
import { createRoleUniforms } from "./assets/roleMaterial";
import { showroomBounds, showroomManifest, showroomPlan } from "./assets/showroom";
import {
  BOOKMARKS,
  bookmarkFromSearch,
  DEFAULT_BOOKMARK,
  HERO_CENTRE,
  HERO_RADIUS_M,
} from "./bookmarks";
import { createThreeCameraOps, type Pose, type ThreeCameraOps, VFOV_DEG } from "./cameraRig";
import { useCityInfo } from "./cityInfo";
import { buildCityGeometry, type CityGeometry } from "./cityMesh";
import { createEngine, type Engine } from "./engine";
import { cesiumEngineHref } from "./engineChoice";
import { fallbackColourFn } from "./fallbackStyle";
import { createFrame, type LocalFrame } from "./frame";
import { createFrameStats } from "./frameStats";
import { createGroundLayer } from "./ground/groundLayer";
import { landcoverMesh } from "./ground/landcover";
import { ribbonsFromWalk } from "./ground/ribbons";
import { boundsGoal, type CameraGoal, intentGoal } from "./intents";
import { LIGHT_PRESETS } from "./lighting";
import {
  dominant,
  glowFor,
  type MoodSource,
  type MoodWeights,
  mixWeights,
  moodKeyDir,
  moodPreset,
  moodSource,
  moodWeights,
} from "./mood";
import { planAgents } from "./motion/agents";
import { createMotionDriver, type MotionDriver, motionRunning } from "./motion/motionClock";
import { createMotionLayer } from "./motion/motionLayer";
import { createOverlayLayer, type OverlayLayer } from "./overlays/accessLayers";
import { useResidents } from "./overlays/useResidents";
import { applyPick, LINE_PICK_PX, pickAt } from "./pick";
import { KIT_LOD_SCALE } from "./props/caps";
import { createLampPools } from "./props/lampPools";
import { planProps } from "./props/propsPlan";
import { lineToLocal } from "./routeLine";
import { createSignLayer } from "./signs/signLayer";
import { planSigns } from "./signs/signPlan";

const EMPTY_FC = { type: "FeatureCollection", features: [] };
const INTENT_PITCH_DEG = -45;
const WHOLE_PITCH_DEG = -50;
const FLY_MS = 1800;
/** Mood crossfade on a source change: day to dusk, and any other pair. */
const DAY_DUSK_FADE_MS = 3000;
const FADE_MS = 2000;
const RAD = Math.PI / 180;
/** A pointer that moves further than this between down and up is a drag (the camera rig), not a click. */
const CLICK_DRAG_PX = 4;

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

const SHOWROOM_LABEL = "Model showroom — not the city";

/** `?showroom=1` replaces the city with a grid of every model: say so while it is shown. */
function ShowroomChip() {
  return (
    <InSlot name="notes">
      <p
        role="note"
        aria-label={SHOWROOM_LABEL}
        className="rounded-full border border-edge bg-surface/95 px-3 py-1 text-xs font-medium text-fg shadow-md"
      >
        {SHOWROOM_LABEL}
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

type FallbackCounts = [number, number, number, number];
const NO_FALLBACK: FallbackCounts = [0, 0, 0, 0];
/** no_fit, generic_fill, no_archetype, no_asset (the order of `data-fallback` and `fb` on the perf line). */
const fallbackCounts = (f: Record<string, number>): FallbackCounts => [
  f.no_fit ?? 0,
  f.generic_fill ?? 0,
  f.no_archetype ?? 0,
  f.no_asset ?? 0,
];

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
  const [fallback, setFallback] = useState<FallbackCounts>(NO_FALLBACK);
  const roleUniforms = useMemo(createRoleUniforms, []);
  /** True while the engine holds instances built from the current library. */
  const handedOff = useRef(false);
  /** The engine whose camera already framed the showroom (once, so the owner can then look around). */
  const showroomFramed = useRef<Engine | null>(null);

  const site = useSite().data;
  const buildingsQ = useBuildings();
  const buildings = buildingsQ.data;
  const theme = useTheme((s) => s.theme);
  // Constant for React; the mood loop then drives the live (blended) colour on the element.
  const [initialBackground] = useState(() => LIGHT_PRESETS[theme].background);
  const quality = useSceneSettings((s) => s.quality);
  const panelOpen = usePanel((s) => s.open);
  const route = useScene((s) => s.route);
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const access = useLayer("access", profile, scenarioId);
  const accessVisible = useScene((s) => s.lensVisible.access);
  const gapsOn = useScene((s) => gapsActive(s.gapsVisible, s.profile));
  const whatIf = useScene((s) => s.whatIf);
  const gapsQ = useGaps(profile, gapsOn && accessVisible);
  // Flood tint, waste points, place markers and evacuation centres share the overlay pass.
  const floodLens = useScene((s) => s.lensVisible.flood);
  const wasteLens = useScene((s) => s.lensVisible.waste);
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const floodOn = !!scenarioId && floodLens;
  const waterQ = useScenarioWater(floodOn ? scenarioId : null);
  const floodQ = useLayer("flood", profile, scenarioId, floodOn);
  const wasteQ = useLayer("waste", profile, scenarioId, wasteLens);
  const evacQ = useEvacCentres(floodOn ? scenarioId : null, profile);
  // Roads are built only after the first frame with the buildings (or at once when the world has
  // none), so their build never delays the city's first frame. The ribbons need only the walk
  // LineStrings and their `type`, which do not depend on profile or scenario: reuse this query's
  // data (latched once, so a profile switch does not rebuild the ground) instead of a second
  // fetch of the ~5 MB layer under the default key.
  const [cityShown, setCityShown] = useState(false);
  const detailsOn = cityShown || buildingsQ.isError || (buildingsQ.isSuccess && !buildings);
  const walkRef = useRef<typeof access.data>(undefined);
  if (!walkRef.current && access.data) walkRef.current = access.data;
  const walk = walkRef.current;

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
  /** The live tier for code that must not re-run on a tier change (the city mesh build). */
  const tierRef = useRef(tier);
  tierRef.current = tier;

  // Seeded static props (trees, lamps, furniture, construction) for the hero district. Planned once
  // the buildings, land cover and walk are all in, from data that does not depend on profile or
  // scenario, and re-planned when the quality tier changes (PROP_CAPS[tier]; none at Low).
  // Decorative only.
  const propsPlan = useMemo(
    () =>
      frame && detailsOn && walk && buildings && loaded && !showroom
        ? planProps({
            walk,
            landcover: buildings.landcover,
            buildings: buildings.buildings,
            parks: buildings.parks,
            trees: buildings.trees,
            places: walk,
            frame,
            centre: HERO_CENTRE,
            radiusM: HERO_RADIUS_M,
            tier,
            m: loaded.manifest,
          })
        : null,
    [frame, detailsOn, walk, buildings, loaded, showroom, tier],
  );
  const propsKits = useRef<Map<string, Placement[]> | undefined>(undefined);
  propsKits.current = propsPlan?.kits;
  /** The plan behind the instances now in the engine, so props can be added without a city rebuild. */
  const cityPlanRef = useRef<CityPlan | null>(null);
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
      useCityInfo.setState({ manifest: null, extruded: null });
      setInstances(0);
      setFallback(NO_FALLBACK);
      usePerfStats.getState().update({ gpuMB: geometryBytes(g) / MB, fallback: NO_FALLBACK });
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
      const inst = createCityInstances(lib, plan, m, roleUniforms, {
        kits: propsKits.current,
        motion: engine.motion,
        kitLodScale: showroom ? 1 : KIT_LOD_SCALE[tierRef.current],
      });
      cityPlanRef.current = plan;
      const g = buildCityGeometry(buildings, frame, {
        only: plan.extrude,
        colours: showroom ? undefined : fallbackColourFn(buildings.buildings, m),
      });
      engine.setCity(g);
      engine.setAssets(inst);
      handedOff.current = true;
      useCityInfo.setState({ manifest: m, extruded: plan.extrude });
      if (showroom && showroomFramed.current !== engine) {
        showroomFramed.current = engine;
        engine.rig.set(fitPose(showroomBounds(plan, m)));
      }
      setInstances(plan.stats.units + plan.landmarks.length);
      setAssetsState("ready");
      const fb = fallbackCounts(plan.stats.fallback);
      setFallback(fb);
      usePerfStats.getState().update({
        fallback: fb,
        gpuMB: (geometryBytes(g) + lib.gpuBytes() + inst.stats().gpuBytes) / MB,
      });
    } catch (err) {
      // Once per load: drop the library, so later buildings refetches draw the full city silently.
      console.warn(`${ASSET_WARN}: ${String(err)}`);
      if (handedOff.current) engine.setAssets(null);
      handedOff.current = false;
      lib.dispose();
      // setLoaded(null) re-runs this effect, which draws the full city once (no full() here).
      setLoaded(null);
      setAssetsState("failed");
    }
  }, [engine, frame, buildings, loaded, showroom, roleUniforms]);

  // Props arrive after the city's first frame, and are re-planned on a tier change: rebuild only the
  // instances (the city mesh is kept).
  useEffect(() => {
    if (!engine || !loaded || !propsPlan || !handedOff.current || !cityPlanRef.current) return;
    try {
      const inst = createCityInstances(
        loaded.lib,
        cityPlanRef.current,
        loaded.manifest,
        roleUniforms,
        {
          kits: propsPlan.kits,
          motion: engine.motion,
          kitLodScale: KIT_LOD_SCALE[tier],
        },
      );
      engine.setAssets(inst);
    } catch (err) {
      console.warn(`${ASSET_WARN}: props: ${String(err)}`);
    }
  }, [engine, loaded, propsPlan, roleUniforms, tier]);

  // Lamp light pools (one instanced draw, from the planned lamps). Decorative; the engine slot
  // disposes them when the props are re-planned or the scene goes away.
  useEffect(() => {
    if (!engine || !propsPlan) return;
    const lamps = [
      ...(propsPlan.kits.get("furniture/lamp_single") ?? []),
      ...(propsPlan.kits.get("furniture/lamp_double") ?? []),
    ];
    if (lamps.length === 0) return;
    const pools = createLampPools(lamps, roleUniforms);
    const group = new THREE.Group();
    group.name = "lamp-pools";
    group.add(pools.mesh);
    engine.setDecor("lamp-pools", { group, dispose: pools.dispose });
    return () => engine.setDecor("lamp-pools", null);
  }, [engine, propsPlan, roleUniforms]);

  // Sourced, text-only shop signs: a sign without text, source_url and as_of never reaches the
  // client (the API filters) and is dropped again in the plan. Planned once the walk is in, for the hero district only and none at Low.
  const signPlan = useMemo(
    () =>
      frame && detailsOn && walk && buildings && !showroom && tier !== "low"
        ? planSigns(buildings.signage, buildings.buildings, walk, frame, {
            centre: HERO_CENTRE,
            radiusM: HERO_RADIUS_M,
          })
        : null,
    [frame, detailsOn, walk, buildings, showroom, tier],
  );
  useEffect(() => {
    if (!engine || !signPlan || signPlan.signs.length === 0) return;
    const layer = createSignLayer(signPlan.signs, roleUniforms);
    engine.setDecor("signs", layer);
    engine.requestRender();
    return () => {
      engine.setDecor("signs", null);
      // A card must not outlive its signs.
      useScene.getState().selectSign(null);
    };
  }, [engine, signPlan, roleUniforms]);

  // Birds and cloud shadows. The motion clock ticks them; while it is stopped the driver re-ticks
  // them at the frozen time on each mood change, so their day/night visibility stays right.
  const ambientRef = useRef<ReturnType<typeof createAmbient> | null>(null);
  const driverRef = useRef<MotionDriver | null>(null);
  const moodRef = useRef<MoodWeights>({ day: 1, dusk: 0, night: 0 });
  useEffect(() => {
    // None at Low (Review Focus 5); counts follow the tier.
    if (!engine || !frame || showroom || tier === "low") return;
    const ambient = createAmbient(tier, frame, HERO_CENTRE, "ambient");
    ambient.tick(performance.now(), moodRef.current);
    ambientRef.current = ambient;
    engine.setDecor("ambient", ambient);
    return () => {
      ambientRef.current = null;
      engine.setDecor("ambient", null);
    };
  }, [engine, frame, showroom, tier]);

  // The motion clock (decorative traffic, pedestrians, birds, sway, shimmer, flicker). Runs only while
  // Motion is on, reduced motion is off, the tab is visible and the map is on screen; otherwise the
  // engine idles at render on demand (Review Focus 3).
  const motionOn = useSceneSettings((s) => s.motion);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === "visible");
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    const mq =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const onMq = () => setReduced(prefersReducedMotion());
    mq?.addEventListener?.("change", onMq);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOnScreen(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const running = motionRunning({ enabled: motionOn, reduced, visible: tabVisible, onScreen });
  const runningRef = useRef(running);
  runningRef.current = running;
  const [driver, setDriver] = useState<MotionDriver | null>(null);
  useEffect(() => {
    if (!engine) return;
    const d = createMotionDriver({
      role: roleUniforms,
      ambient: () => ambientRef.current,
      running: () => runningRef.current,
    });
    d.setWeights(moodRef.current);
    const scene = useScene.getState();
    d.setTarget(scene.day.on || scene.rollout.on ? 0 : 1);
    engine.setMotion(d, () => runningRef.current);
    setDriver(d);
    driverRef.current = d;
    return () => {
      driverRef.current = null;
      setDriver(null);
      engine.setMotion(null, () => false);
    };
  }, [engine, roleUniforms]);
  // Start: one frame starts the clock. Stop: static pose, then one final frame.
  useEffect(() => {
    if (!engine || !driver) return;
    if (!running) driver.rest();
    engine.requestRender();
  }, [engine, driver, running]);
  // Decorative people and vehicles fade out over 1 s while Elmina Day or Rollout playback is on.
  useEffect(() => {
    if (!engine || !driver) return;
    let target: 0 | 1 = driver.target;
    return useScene.subscribe((s) => {
      const next = s.day.on || s.rollout.on ? 0 : 1;
      if (next === target) return;
      target = next;
      driver.setTarget(next);
      engine.requestRender();
    });
  }, [engine, driver]);
  // Seeded agents on the hero district's walk edges (decorative, like the props).
  const agents = useMemo(
    () =>
      frame && detailsOn && walk && loaded && !showroom
        ? planAgents({
            walk,
            places: walk,
            frame,
            centre: HERO_CENTRE,
            radiusM: HERO_RADIUS_M,
            tier,
            m: loaded.manifest,
            seed: "motion",
          })
        : null,
    [frame, detailsOn, walk, loaded, showroom, tier],
  );
  useEffect(() => {
    if (!engine || !driver || !loaded || !agents || agents.length === 0) return;
    driver.setAgents(
      createMotionLayer(agents, loaded.lib, loaded.manifest, roleUniforms, engine.motion),
    );
    engine.requestRender();
    return () => driver.setAgents(null);
  }, [engine, driver, loaded, agents, roleUniforms]);

  // First frame after the city is set: the ground details may now load.
  useEffect(() => {
    if (!engine || !buildings || cityShown) return;
    const off = engine.onFrame(() => {
      off();
      setCityShown(true);
    });
    return off;
  }, [engine, buildings, cityShown]);

  // Land cover covers the whole township; roads are clipped to the hero radius (display only).
  const landcover = useMemo(
    () =>
      frame
        ? landcoverMesh(
            (buildings?.landcover ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection,
            frame,
          )
        : null,
    [frame, buildings],
  );
  const roads = useMemo(
    () =>
      frame && detailsOn && walk
        ? ribbonsFromWalk(walk as unknown as GeoJSON.FeatureCollection, frame, {
            clipCentre: HERO_CENTRE,
            clipRadiusM: HERO_RADIUS_M,
          })
        : [],
    [frame, detailsOn, walk],
  );
  useEffect(() => {
    if (!engine || !landcover) return;
    // The layer owns (and disposes) its land-cover geometry, so each layer gets a clone.
    engine.setGround(createGroundLayer(roads, landcover.clone(), tier, engine.motion.uTime));
    return () => engine.setGround(null);
  }, [engine, landcover, roads, tier]);
  useEffect(() => () => landcover?.dispose(), [landcover]);

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

  // Access / gaps / route / what-if lines: one layer per engine and frame, owned by the engine.
  const [overlay, setOverlay] = useState<OverlayLayer | null>(null);
  useEffect(() => {
    if (!engine || !frame) return;
    const layer = createOverlayLayer(frame);
    engine.setOverlays(layer);
    setOverlay(layer);
    return () => {
      engine.setOverlays(null); // disposes the layer
      setOverlay(null);
    };
  }, [engine, frame]);
  useEffect(() => {
    if (!engine || !overlay) return;
    overlay.update({
      access: access.data ?? null,
      accessVisible,
      gaps: gapsQ.data ?? null,
      gapsOn,
      route: routeOn ? (route?.geojson ?? null) : null,
      whatIf,
      water: waterQ.data ?? null,
      floodEdges: floodQ.data ?? null,
      floodOn,
      waste: wasteQ.data ?? null,
      wasteOn: wasteLens,
      evac: evacQ.data ?? null,
      focusPlaceId,
    });
    engine.requestRender();
  }, [
    engine,
    overlay,
    access.data,
    accessVisible,
    gapsQ.data,
    gapsOn,
    routeOn,
    route,
    whatIf,
    waterQ.data,
    floodQ.data,
    floodOn,
    wasteQ.data,
    wasteLens,
    evacQ.data,
    focusPlaceId,
  ]);
  // Elmina Day and rollout residents ride the same overlay layer.
  useResidents(engine, overlay, frame);

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

  // Lighting follows the mood clock: Elmina Day playback, else a pinned theme, else the real
  // Kuala Lumpur clock. A source change crossfades (reduced motion applies at once). Display only.
  const home = homeView(site);
  useEffect(() => {
    if (!engine) return;
    let shown: MoodWeights | null = null;
    let key = "";
    let fade: { from: MoodWeights; start: number; dur: number } | null = null;
    let raf = 0;
    const source = () => {
      const day = useScene.getState().day;
      return moodSource({
        dayOn: day.on,
        dayT: day.t,
        choice: useTheme.getState().choice,
        now: new Date(),
      });
    };
    const apply = (w: MoodWeights, src: MoodSource) => {
      shown = w;
      moodRef.current = w;
      driverRef.current?.setWeights(w);
      const g = glowFor(w);
      roleUniforms.uWindowGlow.value = g.uWindowGlow;
      roleUniforms.uLitShare.value = g.uLitShare;
      roleUniforms.uLightGlow.value = g.uLightGlow;
      const preset = moodPreset(w);
      if (sectionRef.current) sectionRef.current.style.background = preset.background;
      engine.setLighting(preset, moodKeyDir(src, w, new Date(), home.lat, home.lon));
    };
    const step = () => {
      raf = 0;
      if (!fade) return;
      const src = source();
      const k = Math.min(1, (performance.now() - fade.start) / fade.dur);
      const to = moodWeights(src);
      apply(k >= 1 ? to : mixWeights(fade.from, to, k), src);
      if (k >= 1) fade = null;
      else raf = requestAnimationFrame(step);
    };
    const evaluate = () => {
      const src = source();
      const to = moodWeights(src);
      const k = src.kind === "pinned" ? `p:${src.theme}` : src.kind;
      const changed = shown !== null && k !== key;
      key = k;
      if (changed && shown && !reducedMotion()) {
        const pair = new Set([dominant(shown), dominant(to)]);
        const dayDusk = pair.size === 2 && pair.has("day") && pair.has("dusk");
        fade = {
          from: shown,
          start: performance.now(),
          dur: dayDusk ? DAY_DUSK_FADE_MS : FADE_MS,
        };
        if (!raf) raf = requestAnimationFrame(step);
        return;
      }
      if (fade) return; // the running crossfade follows the new target by itself
      apply(to, src);
    };
    engine.setFogRange(engine.rig.get().rangeM);
    evaluate();
    const offTheme = useTheme.subscribe(evaluate);
    const offDay = useScene.subscribe((s, prev) => {
      if (s.day.on !== prev.day.on || s.day.t !== prev.day.t) evaluate();
    });
    const timer = setInterval(evaluate, 60_000);
    return () => {
      offTheme();
      offDay();
      clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [engine, roleUniforms, home.lat, home.lon]);

  // Fog follows the camera range (only when it moves by more than 10 %).
  useEffect(() => {
    if (!engine) return;
    let last = engine.rig.get().rangeM;
    return engine.onFrame(() => {
      const r = engine.rig.get().rangeM;
      if (Math.abs(r - last) > 0.1 * last) {
        last = r;
        engine.setFogRange(r);
      }
    });
  }, [engine]);

  // Look point in the middle of the map area left of the side panel (phones use the sheet).
  useEffect(() => {
    if (!engine) return;
    const panel = isWide() && panelOpen ? panelWidthPx(innerWidth) + PANEL_INSET_PX * 2 : 0;
    engine.setViewOffset(panel);
  }, [engine, panelOpen]);

  useEffect(() => {
    engine?.setTier(tier);
  }, [engine, tier]);

  // `data-frames` (first frames at once, then at most every 500 ms) and the compass heading follow
  // every engine frame; separate from the tier listener below so a tier change never drops a count.
  const [frames, setFrames] = useState(0);
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

  // The building card describes what this city draws; neither outlives the scene.
  useEffect(
    () => () => {
      useCityInfo.setState({ manifest: null, extruded: null });
      useScene.getState().selectBuilding(null);
    },
    [],
  );

  // Click to pick (one shared picker, fixed priority). Only a primary-button press released within
  // CLICK_DRAG_PX is a click; a drag orbits (MapControls) and a second finger cancels the click.
  useEffect(() => {
    const host = hostRef.current;
    if (!engine || !host) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.isPrimary && e.button === 0 && !down ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || !e.isPrimary || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_DRAG_PX) return;
      const r = host.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const ndc = {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -((e.clientY - r.top) / r.height) * 2 + 1,
      };
      const v = engine.pickView();
      const hit = pickAt(ndc, v.camera, v.roots, LINE_PICK_PX, {
        width: v.size[0],
        height: v.size[1],
      });
      if (hit) applyPick(hit, useScene.getState(), (id) => placesRef.current.has(id));
    };
    const onCancel = () => {
      down = null;
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
    };
  }, [engine]);

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
      data-fallback={fallback.join(",")}
      className="relative h-full w-full"
      style={{ background: initialBackground }}
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
      {showroom && (assetsState === "loading" || assetsState === "ready") && <ShowroomChip />}
    </section>
  );
}
