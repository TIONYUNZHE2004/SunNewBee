import * as Cesium from "cesium";
import { useEffect, useMemo, useRef } from "react";
import { useCesium } from "resium";
import { useBuildings } from "../../../../lib/api";
import { useTheme } from "../../../../ui/theme";
import { type BuildingPrimitives, buildBuildingPrimitives } from "./buildingsPrimitive";
import { groupByClass, toBuildings } from "./model";
import { type Palette, paletteFor } from "./palette";

export interface StylisedReady {
  buildings: number;
  skipped: number;
  primitives: number;
  /** Main-thread ms to parse, mesh and create the primitives (GPU upload happens on the next frame). */
  buildMs: number;
}

/** Hide imagery, sky and atmosphere; paint ground and sky flat. Returns a restore function. */
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

export function paintStylisedLook(viewer: Cesium.Viewer, p: Palette): void {
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(p.ground);
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(p.sky);
  viewer.scene.fog.density = p.fog;
}

/**
 * Resium child of <Viewer>: the stylised city (flat ground + extruded buildings with lit windows).
 * Renders nothing while the world has no buildings data (API 404 -> null).
 */
export function StylisedCity({ onReady }: { onReady?: (info: StylisedReady) => void }) {
  const { viewer } = useCesium();
  const data = useBuildings().data;
  const theme = useTheme((s) => s.theme);
  const handle = useRef<BuildingPrimitives | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const parsed = useMemo(() => {
    if (!data) return null;
    const t0 = performance.now();
    const { buildings, skipped } = toBuildings(data.buildings);
    return { classes: groupByClass(buildings), count: buildings.length, skipped, t0 };
  }, [data]);

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
    handle.current = h;
    viewer.scene.requestRender();
    onReadyRef.current?.({
      buildings: parsed.count,
      skipped: parsed.skipped,
      primitives: h.primitives.length,
      buildMs: performance.now() - parsed.t0,
    });
    return () => {
      handle.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, parsed]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    paintStylisedLook(viewer, paletteFor(theme));
    handle.current?.setTheme(theme);
    viewer.scene.requestRender();
  }, [viewer, theme]);

  return null;
}
