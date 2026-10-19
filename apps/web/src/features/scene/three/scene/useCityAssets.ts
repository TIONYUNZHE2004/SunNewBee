import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BuildingsLayer } from "../../../../lib/api";
import { usePerfStats } from "../../cesium/PerfOverlay";
import { useScene } from "../../sceneStore";
import type { Tier } from "../../shared/quality";
import { type CityInstances, createCityInstances } from "../assets/cityInstances";
import { modelBoxesOf, modelCellsOf } from "../assets/drawnBounds";
import type { Placement } from "../assets/fit";
import { type AssetLibrary, loadAssetLibrary } from "../assets/library";
import { MANIFEST_URL, type Manifest, parseManifest } from "../assets/manifest";
import {
  type CityPlan,
  coverOf,
  facadeInputs,
  planCity,
  type RoofInput,
  roofInputs,
} from "../assets/plan";
import type { RoleUniforms } from "../assets/roleMaterial";
import { showroomBounds, showroomManifest, showroomPlan } from "../assets/showroom";
import { HERO_CENTRE } from "../bookmarks";
import { useCityInfo } from "../cityInfo";
import { bevelForTier, buildCityGeometry, type CityGeometry } from "../cityMesh";
import { createClearance, obstaclesFromCity } from "../clearance";
import type { Engine } from "../engine";
import type { FacadeBuilding } from "../facade/facadeLayer";
import { largeRoofTint } from "../facade/roofPlan";
import { fallbackColourFn } from "../fallbackStyle";
import type { LocalFrame } from "../frame";
import type { Boundary } from "../ground/boundary";
import { KIT_LOD_SCALE } from "../props/caps";
import type { SliceJob } from "./idle";
import { fitPose } from "./useCameraOps";

export type AssetsState = "off" | "loading" | "ready" | "failed";
export interface LoadedAssets {
  manifest: Manifest;
  lib: AssetLibrary;
}
export const ASSET_WARN = "TownshipLens 3D: city assets unavailable, drawing the extruded city";
export const DECOR_WARN = "TownshipLens 3D: decorative facade or roof detail skipped";
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

export type FallbackCounts = [number, number, number, number];
const NO_FALLBACK: FallbackCounts = [0, 0, 0, 0];
/**
 * no_fit, generic_fill, no_archetype, no_asset (the order of `data-fallback` and `fb` on the perf
 * line). A `generic_stretch` (a generic box that would be stretched, extruded with a facade) counts
 * as no_fit: the asset cannot fit without stretching; so does a `walk_cover` (a stand-in that would
 * cover a walk edge its outline does not, 9.1 F1).
 */
const fallbackCounts = (f: Record<string, number>): FallbackCounts => [
  (f.no_fit ?? 0) + (f.generic_stretch ?? 0) + (f.walk_cover ?? 0),
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

type Kits = Map<string, Placement[]> | null;

/**
 * City assets: the manifest and glb library, the city plan, the city mesh (extruded fallbacks),
 * the `CityInstances` (archetypes and landmarks) and the building card's data.
 *
 * Single build: the instances are created once per (plan, tier) and kits (props) are applied with
 * `setKits`, which rebuilds only the kit buckets. Kits set before the build go into it.
 *
 * Procedural facades (decorative): `facadeSrc` is the facade input of every drawn extrusion
 * (fallbacks and stretched generics). The streamer buckets it by tile and `useFacades` draws the
 * buckets of rings 0-1 (P4-H). `baseBytes` is the city's GPU bytes without the facade layer.
 *
 * Roofs (Task 8, decorative): large styled roof caps take `largeRoofTint` instead of the grey
 * palette roof, and `roofSrc` (large extrusions plus landmark podiums) is streamed the same way
 * and drawn by `useRoofs`.
 */
export function useCityAssets({
  engine,
  frame,
  buildings,
  tier,
  assetsOn,
  showroom,
  roleUniforms,
  boundary = null,
  walk = null,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  /** Already cut to the Elmina outline when the world has one (`ground/clipLayer.ts`). */
  buildings: BuildingsLayer | null | undefined;
  tier: Tier;
  /** False with `?assets=0`: the extruded city only. */
  assetsOn: boolean;
  /** `?showroom=1`: every asset laid out for owner review. */
  showroom: boolean;
  roleUniforms: RoleUniforms;
  /** The Elmina outline (A-T4): anchor-placed landmarks outside it are skipped. */
  boundary?: Boundary | null;
  /**
   * The access layer (walk LineStrings), latched by the caller: no archetype or landmark stand-in
   * is drawn over a walk edge its OSM outline does not cover (9.1 F1). Display only.
   */
  walk?: unknown;
}) {
  const [assetsState, setAssetsState] = useState<AssetsState>(assetsOn ? "loading" : "off");
  const [loaded, setLoaded] = useState<LoadedAssets | null>(null);
  const [plan, setPlan] = useState<CityPlan | null>(null);
  const [instances, setInstances] = useState(0);
  /** True when the placed city assets include decorative kits or decorative landmarks. */
  const [decorAssets, setDecorAssets] = useState(false);
  const [fallback, setFallback] = useState<FallbackCounts>(NO_FALLBACK);
  /** The facade layer's input for the current plan (null: no facades, e.g. no assets or showroom). */
  const [facadeSrc, setFacadeSrc] = useState<FacadeBuilding[] | null>(null);
  /** The roof layer's input for the current plan (null: no roofs, e.g. no assets or showroom). */
  const [roofSrc, setRoofSrc] = useState<RoofInput[] | null>(null);
  /** The city's GPU bytes without the facade layer (the facade effect adds its own). */
  const baseBytes = useRef(0);
  /** True while the engine holds instances built from the current library. */
  const handedOff = useRef(false);
  /** The instances now in the engine (null while it holds none). */
  const instRef = useRef<CityInstances | null>(null);
  /** The detail bubble's LOD0-trees area (B-T8), re-applied to new instances. */
  const bubbleRef = useRef<{ x: number; z: number; r: number } | null>(null);
  /** The latest kits (props) handed to setKits, and what the instances were last given. */
  const kitsRef = useRef<Kits>(null);
  const applied = useRef<{ kits: Kits; scale: number } | null>(null);
  /** The engine whose camera already framed the showroom (once, so the owner can then look around). */
  const showroomFramed = useRef<Engine | null>(null);
  /** The decorative-inputs warning is logged once per scene. */
  const decorWarned = useRef(false);
  /** The live tier for code that must not re-run on a tier change (the city mesh build). */
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const kitLodScale = () => (showroom ? 1 : KIT_LOD_SCALE[tierRef.current]);
  /** The last city mesh build's inputs: a tier change re-extrudes with that tier's bevel (B-T2). */
  const cityArgs = useRef<{
    buildings: BuildingsLayer;
    frame: LocalFrame;
    opts: Parameters<typeof buildCityGeometry>[2] & {};
  } | null>(null);

  const dropInstances = () => {
    if (handedOff.current) engine?.setAssets(null);
    handedOff.current = false;
    instRef.current = null;
    applied.current = null;
    // Kits were planned against this library's manifest: the next build waits for a fresh setKits.
    kitsRef.current = null;
  };

  // City assets: manifest, then the glb library (aborted on unmount). Any failure leaves the full
  // extruded city drawn, with data-assets="failed" and one warning.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dropInstances reads refs and `engine`, a dependency
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
      dropInstances();
      lib?.dispose();
      setLoaded(null);
    };
  }, [engine, assetsOn]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tier is read live (a tier change rescales kits through setKits, never rebuilds the city)
  useEffect(() => {
    if (!engine || !frame || !buildings) return;
    const full = () => {
      const args = { bevel: bevelForTier(tierRef.current) };
      const g = buildCityGeometry(buildings, frame, args);
      cityArgs.current = { buildings, frame, opts: args };
      engine.setCity(g);
      // Building clearance (A-T7): every drawn footprint at its display height.
      engine.setClearance?.(createClearance(obstaclesFromCity(buildings, frame)));
      useCityInfo.setState({ manifest: null, extruded: null });
      setPlan(null);
      setInstances(0);
      setDecorAssets(false);
      setFallback(NO_FALLBACK);
      setFacadeSrc(null);
      setRoofSrc(null);
      baseBytes.current = geometryBytes(g);
      usePerfStats.getState().update({ gpuMB: baseBytes.current / MB, fallback: NO_FALLBACK });
    };
    if (!loaded) {
      full();
      return;
    }
    const { manifest, lib } = loaded;
    const boxOf = modelBoxesOf(lib, manifest);
    const cellsOf = modelCellsOf(lib);
    let built: { g: CityGeometry; m: Manifest } | null = null;
    try {
      const m = showroom ? showroomManifest(manifest) : manifest;
      const plan = showroom
        ? showroomPlan(m, frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]))
        : planCity(
            buildings,
            frame,
            manifest,
            lib.has,
            boundary,
            coverOf(walk, frame, boxOf, cellsOf),
          );
      const kits = kitsRef.current;
      const scale = kitLodScale();
      const inst = createCityInstances(lib, plan, m, roleUniforms, {
        kits: kits ?? undefined,
        motion: engine.motion,
        kitLodScale: scale,
      });
      const opts = {
        only: plan.extrude,
        colours: showroom ? undefined : fallbackColourFn(buildings.buildings, m),
        roofTint: showroom ? undefined : largeRoofTint,
        bevel: bevelForTier(tierRef.current),
      };
      const g = buildCityGeometry(buildings, frame, opts);
      cityArgs.current = { buildings, frame, opts };
      engine.setCity(g);
      engine.setAssets(inst);
      // Building clearance (A-T7): the footprints plus every placed archetype and landmark box (the
      // showroom draws no OSM buildings, only its laid-out assets).
      engine.setClearance?.(
        createClearance(
          obstaclesFromCity(showroom ? null : buildings, frame, plan, m, boxOf, cellsOf),
        ),
      );
      handedOff.current = true;
      instRef.current = inst;
      inst.setDetailBubble?.(bubbleRef.current);
      applied.current = { kits, scale };
      setPlan(plan);
      useCityInfo.setState({ manifest: m, extruded: plan.extrude });
      if (showroom && showroomFramed.current !== engine) {
        showroomFramed.current = engine;
        engine.rig.set(fitPose(showroomBounds(plan, m)));
      }
      setInstances(plan.stats.units + plan.landmarks.length);
      const decorative = (asset: string) => {
        const a = m.assets[asset];
        return !!a && (a.decorative || a.group === "kit");
      };
      setDecorAssets(
        plan.landmarks.some((l) => decorative(l.asset)) ||
          [...plan.placements].some(([k, l]) => l.length > 0 && decorative(k.split("/")[0] ?? "")),
      );
      setAssetsState("ready");
      const fb = fallbackCounts(plan.stats.fallback);
      setFallback(fb);
      baseBytes.current = geometryBytes(g) + lib.gpuBytes() + inst.stats().gpuBytes;
      usePerfStats.getState().update({ fallback: fb, gpuMB: baseBytes.current / MB });
      built = { g, m };
    } catch (err) {
      // Once per load: drop the library, so later buildings refetches draw the full city silently.
      console.warn(`${ASSET_WARN}: ${String(err)}`);
      dropInstances();
      lib.dispose();
      setFacadeSrc(null);
      setRoofSrc(null);
      // setLoaded(null) re-runs this effect, which draws the full city once (no full() here).
      setLoaded(null);
      setAssetsState("failed");
      return;
    }
    // Decorative inputs (facades, roofs and the podium deck) run apart from the city build: a throw
    // there empties their slot and never drops the archetype city to plain extrusions.
    // The showroom has no township: no facades or roof dressing there.
    const decor = <T>(what: string, run: () => T): T | null => {
      if (showroom) return null;
      try {
        return run();
      } catch (err) {
        if (!decorWarned.current) {
          decorWarned.current = true;
          console.warn(`${DECOR_WARN}: ${what}: ${String(err)}`);
        }
        return null;
      }
    };
    if (!built) return;
    const { g, m } = built;
    setFacadeSrc(decor("facades", () => facadeInputs(g.footprints, buildings, m)));
    setRoofSrc(decor("roofs", () => roofInputs(g.footprints, buildings, m, frame)));
  }, [engine, frame, buildings, loaded, showroom, roleUniforms, boundary, walk]);

  /** Hands the latest kits to the instances in the engine, unless they already hold them. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: kitLodScale reads the live tier and `showroom`, a dependency
  const applyKits = useCallback(() => {
    const inst = instRef.current;
    if (!engine || !inst) return;
    const kits = kitsRef.current;
    const scale = kitLodScale();
    if (applied.current?.kits === kits && applied.current.scale === scale) return;
    try {
      inst.setKits(kits, scale);
      applied.current = { kits, scale };
      engine.markSwap();
    } catch (err) {
      console.warn(`${ASSET_WARN}: props: ${String(err)}`);
    }
  }, [engine, showroom]);

  /** Props arrive after the city's first frame and are re-planned on a tier change: kit buckets only. */
  const setKits = useCallback(
    (kits: Kits) => {
      kitsRef.current = kits;
      applyKits();
    },
    [applyKits],
  );

  /**
   * `setKits` as a time-sliced job (Task 5): one step per kit key, built hidden, swapped in by
   * `done`. Null when the instances already hold these kits (or are not built yet: the build
   * picks the kits up).
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: kitLodScale reads the live tier and `showroom`, a dependency
  const kitJob = useCallback(
    (kits: Kits): SliceJob | null => {
      kitsRef.current = kits;
      const inst = instRef.current;
      if (!engine || !inst) return null;
      const scale = kitLodScale();
      if (applied.current?.kits === kits && applied.current.scale === scale) return null;
      const b = inst.kitSteps(kits, scale);
      return {
        steps: b.steps,
        done() {
          if (instRef.current !== inst) {
            b.cancel();
            return;
          }
          try {
            b.commit();
            applied.current = { kits, scale };
            engine.markSwap();
          } catch (err) {
            console.warn(`${ASSET_WARN}: props: ${String(err)}`);
          }
        },
        cancel: b.cancel,
      };
    },
    [engine, showroom],
  );

  // A tier change re-extrudes the city mesh with that tier's bevel (Low: plain boxes, Medium: one
  // segment, High: two). Only the merged extrusion mesh is rebuilt; plan and instances stay.
  useEffect(() => {
    const a = cityArgs.current;
    if (!engine || !a) return;
    const bevel = bevelForTier(tier);
    if (JSON.stringify(a.opts.bevel) === JSON.stringify(bevel)) return;
    a.opts = { ...a.opts, bevel };
    engine.setCity(buildCityGeometry(a.buildings, a.frame, a.opts));
  }, [engine, tier]);

  // A tier change rescales the kit LOD distances. Deferred to a microtask so a props re-plan for the
  // same tier change (setKits from useDecor, later in this commit) is applied once, not twice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tier` is the trigger; applyKits reads it live
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) applyKits();
    });
    return () => {
      live = false;
    };
  }, [tier, applyKits]);

  // The building card describes what this city draws; neither outlives the scene.
  useEffect(
    () => () => {
      useCityInfo.setState({ manifest: null, extruded: null });
      useScene.getState().selectBuilding(null);
    },
    [],
  );

  /** B-T8: trees inside the detail bubble are drawn at LOD0 (applied on the next LOD update). */
  const setDetailBubble = useCallback((b: { x: number; z: number; r: number } | null) => {
    bubbleRef.current = b;
    instRef.current?.setDetailBubble?.(b);
  }, []);

  return {
    assetsState,
    loaded,
    setDetailBubble,
    plan,
    setKits,
    kitJob,
    decorAssets,
    instances,
    fallback,
    facadeSrc,
    roofSrc,
    baseBytes,
  };
}
