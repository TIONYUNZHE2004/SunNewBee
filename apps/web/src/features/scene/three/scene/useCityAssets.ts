import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildingsLayer } from "../../../../lib/api";
import { usePerfStats } from "../../cesium/PerfOverlay";
import type { Tier } from "../../cesium/stylised/quality";
import { useScene } from "../../sceneStore";
import { type CityInstances, createCityInstances } from "../assets/cityInstances";
import type { Placement } from "../assets/fit";
import { type AssetLibrary, loadAssetLibrary } from "../assets/library";
import { MANIFEST_URL, type Manifest, parseManifest } from "../assets/manifest";
import { type CityPlan, facadeInputs, planCity, type RoofInput, roofInputs } from "../assets/plan";
import type { RoleUniforms } from "../assets/roleMaterial";
import { showroomBounds, showroomManifest, showroomPlan } from "../assets/showroom";
import { HERO_CENTRE } from "../bookmarks";
import { useCityInfo } from "../cityInfo";
import { buildCityGeometry, type CityGeometry } from "../cityMesh";
import type { Engine } from "../engine";
import type { FacadeBuilding } from "../facade/facadeLayer";
import { largeRoofTint } from "../facade/roofPlan";
import { fallbackColourFn } from "../fallbackStyle";
import type { LocalFrame } from "../frame";
import { KIT_LOD_SCALE } from "../props/caps";
import { fitPose } from "./useCameraOps";

export type AssetsState = "off" | "loading" | "ready" | "failed";
export interface LoadedAssets {
  manifest: Manifest;
  lib: AssetLibrary;
}
export const ASSET_WARN = "TownshipLens 3D: city assets unavailable, drawing the extruded city";
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
 * as no_fit: the asset cannot fit without stretching.
 */
const fallbackCounts = (f: Record<string, number>): FallbackCounts => [
  (f.no_fit ?? 0) + (f.generic_stretch ?? 0),
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
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  buildings: BuildingsLayer | null | undefined;
  tier: Tier;
  /** False with `?assets=0`: the extruded city only. */
  assetsOn: boolean;
  /** `?showroom=1`: every asset laid out for owner review. */
  showroom: boolean;
  roleUniforms: RoleUniforms;
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
  /** The latest kits (props) handed to setKits, and what the instances were last given. */
  const kitsRef = useRef<Kits>(null);
  const applied = useRef<{ kits: Kits; scale: number } | null>(null);
  /** The engine whose camera already framed the showroom (once, so the owner can then look around). */
  const showroomFramed = useRef<Engine | null>(null);
  /** The live tier for code that must not re-run on a tier change (the city mesh build). */
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const kitLodScale = () => (showroom ? 1 : KIT_LOD_SCALE[tierRef.current]);

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
      const g = buildCityGeometry(buildings, frame);
      engine.setCity(g);
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
    try {
      const m = showroom ? showroomManifest(manifest) : manifest;
      const plan = showroom
        ? showroomPlan(m, frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]))
        : planCity(buildings, frame, manifest, lib.has);
      const kits = kitsRef.current;
      const scale = kitLodScale();
      const inst = createCityInstances(lib, plan, m, roleUniforms, {
        kits: kits ?? undefined,
        motion: engine.motion,
        kitLodScale: scale,
      });
      const g = buildCityGeometry(buildings, frame, {
        only: plan.extrude,
        colours: showroom ? undefined : fallbackColourFn(buildings.buildings, m),
        roofTint: showroom ? undefined : largeRoofTint,
      });
      engine.setCity(g);
      engine.setAssets(inst);
      handedOff.current = true;
      instRef.current = inst;
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
      // The showroom has no township: no facades there.
      setFacadeSrc(showroom ? null : facadeInputs(g.footprints, buildings, m));
      setRoofSrc(showroom ? null : roofInputs(g.footprints, buildings, m, frame));
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
    }
  }, [engine, frame, buildings, loaded, showroom, roleUniforms]);

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
      engine.requestRender();
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

  return {
    assetsState,
    loaded,
    plan,
    setKits,
    decorAssets,
    instances,
    fallback,
    facadeSrc,
    roofSrc,
    baseBytes,
  };
}
