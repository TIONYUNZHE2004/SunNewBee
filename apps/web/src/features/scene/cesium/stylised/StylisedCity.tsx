import * as Cesium from "cesium";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCesium } from "resium";
import { useBuildings, useLayer, useSite } from "../../../../lib/api";
import { useTheme } from "../../../../ui/theme";
import { homeView } from "../home";
import { type BuildingPrimitives, buildBuildingPrimitives } from "./buildingsPrimitive";
import { buildGround, type Ground, roadsFromWalk, type WaterPolygon } from "./ground";
import { groupByClass, toBuildings, treesToPoints } from "./model";
import { paletteFor } from "./palette";
import { buildProps, kerbCars, type Props, streetTrees } from "./props";
import { reskin } from "./reskin";

export interface StylisedReady {
  buildings: number;
  skipped: number;
  primitives: number;
  /** Main-thread ms to parse, mesh and create the primitives (GPU upload happens on the next frame). */
  buildMs: number;
}

/** Hide imagery, sky and atmosphere (keeps the light, sky colour and fog to restore). Returns a restore function. */
export function applyStylisedLook(viewer: Cesium.Viewer): () => void {
  const { scene } = viewer;
  const { globe } = scene;
  const layers = Array.from({ length: scene.imageryLayers.length }, (_, i) =>
    scene.imageryLayers.get(i),
  );
  const prev = {
    baseColor: globe.baseColor.clone(),
    groundAtmosphere: globe.showGroundAtmosphere,
    lighting: globe.enableLighting,
    background: scene.backgroundColor.clone(),
    fog: scene.fog.density,
    skyAtmosphere: scene.skyAtmosphere?.show,
    skyBox: scene.skyBox?.show,
    sun: scene.sun?.show,
    moon: scene.moon?.show,
    light: scene.light,
    layers: layers.map((l) => l.show),
  };
  globe.showGroundAtmosphere = false;
  globe.enableLighting = false;
  for (const l of layers) l.show = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  if (scene.skyBox) scene.skyBox.show = false;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  return () => {
    if (viewer.isDestroyed()) return;
    globe.baseColor = prev.baseColor;
    globe.showGroundAtmosphere = prev.groundAtmosphere;
    globe.enableLighting = prev.lighting;
    scene.backgroundColor = prev.background;
    scene.fog.density = prev.fog;
    scene.light = prev.light;
    layers.forEach((l, i) => {
      if (!l.isDestroyed()) l.show = prev.layers[i] ?? true;
    });
    if (scene.skyAtmosphere && prev.skyAtmosphere !== undefined)
      scene.skyAtmosphere.show = prev.skyAtmosphere;
    if (scene.skyBox && prev.skyBox !== undefined) scene.skyBox.show = prev.skyBox;
    if (scene.sun && prev.sun !== undefined) scene.sun.show = prev.sun;
    if (scene.moon && prev.moon !== undefined) scene.moon.show = prev.moon;
    scene.requestRender();
  };
}

/** Seed for decorative placement (trees, cars): fixed, so the city looks the same every visit. */
const PROPS_SEED = "tl-stylised";
/**
 * Permanent water (rivers, lakes) is not served by the API yet (base/hydrology.geojson is not on
 * any endpoint). Flood scenario water is a scenario, never decoration, so it is not used here.
 */
const NO_WATER: WaterPolygon[] = [];

/**
 * Resium child of <Viewer>: the stylised city (flat ground, roads, buildings with lit windows,
 * decorative trees and parked cars). Buildings render nothing while the world has no buildings data
 * (API 404 -> null); roads come from the walk network and are drawn regardless.
 */
export function StylisedCity({ onReady }: { onReady?: (info: StylisedReady) => void }) {
  const { viewer } = useCesium();
  const buildingsQ = useBuildings();
  const data = buildingsQ.data;
  const site = useSite().data;
  const theme = useTheme((s) => s.theme);
  const buildings = useRef<BuildingPrimitives | null>(null);
  const ground = useRef<Ground | null>(null);
  const props = useRef<Props | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Roads and props start after the buildings' first frame (or at once when there are none), so
  // their worker builds never delay the city's first frame.
  const [buildingsShown, setBuildingsShown] = useState(false);
  const details = buildingsShown || buildingsQ.isError || (buildingsQ.isSuccess && !data);
  // The walk network (~5 MB) is fetched only then too: it would compete with the buildings fetch.
  const walk = useLayer("access", "default", null, details).data;
  const home = useMemo(() => homeView(site), [site]);

  const parsed = useMemo(() => {
    if (!data) return null;
    const t0 = performance.now();
    const { buildings, skipped } = toBuildings(data.buildings);
    return { classes: groupByClass(buildings), count: buildings.length, skipped, t0 };
  }, [data]);
  const roads = useMemo(() => (details ? roadsFromWalk(walk) : []), [walk, details]);
  const decor = useMemo(
    () => ({
      trees: [...treesToPoints(data?.trees), ...streetTrees(roads, PROPS_SEED)],
      cars: kerbCars(roads, PROPS_SEED),
    }),
    [data, roads],
  );

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    return applyStylisedLook(viewer);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !parsed) return;
    const t = useTheme.getState().theme;
    const h = buildBuildingPrimitives(
      Cesium,
      parsed.classes,
      paletteFor(t),
      t,
      viewer.scene.primitives,
    );
    buildings.current = h;
    viewer.scene.requestRender();
    const off = viewer.scene.postRender.addEventListener(() => {
      if (h.primitives.some((p) => !p.ready)) return;
      off();
      setBuildingsShown(true);
    });
    onReadyRef.current?.({
      buildings: parsed.count,
      skipped: parsed.skipped,
      primitives: h.primitives.length,
      buildMs: performance.now() - parsed.t0,
    });
    return () => {
      off();
      buildings.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, parsed]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || roads.length === 0) return;
    const h = buildGround(Cesium, viewer, {
      roads,
      water: NO_WATER,
      palette: paletteFor(useTheme.getState().theme),
    });
    ground.current = h;
    viewer.scene.requestRender();
    return () => {
      ground.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, roads]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !details) return;
    if (decor.trees.length === 0 && decor.cars.length === 0) return;
    const h = buildProps(
      Cesium,
      { ...decor, palette: paletteFor(useTheme.getState().theme) },
      viewer.scene.primitives,
    );
    props.current = h;
    viewer.scene.requestRender();
    return () => {
      props.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, decor, details]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    reskin(Cesium, viewer, [buildings.current, ground.current, props.current], theme, home);
  }, [viewer, theme, home]);

  return null;
}
