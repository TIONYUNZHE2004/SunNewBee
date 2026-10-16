import { useMemo } from "react";
import { type BuildingsLayer, useBuildings } from "../../lib/api";
import { ENV } from "../../lib/env";
import { type MapStyle, resolveMapStyle, useScene } from "./sceneStore";
import { availableViews, effectiveView, type View, webglSupported } from "./selectView";

/** Pure: the world has at least one building footprint to draw (a 404 is null, so false). */
export function hasBuildingsData(d: BuildingsLayer | null | undefined): boolean {
  const features = (d?.buildings as { features?: unknown } | undefined)?.features;
  return Array.isArray(features) && features.length > 0;
}

/**
 * The map style actually drawn, with what it depends on. `settled` is false while the buildings
 * request is in flight: callers wait for it before creating anything billable.
 */
export function useMapStyle(): {
  style: MapStyle;
  hasBuildings: boolean;
  hasGoogle: boolean;
  settled: boolean;
} {
  const q = useBuildings();
  const mapStyle = useScene((s) => s.mapStyle);
  const mapStyleChosen = useScene((s) => s.mapStyleChosen);
  const hasBuildings = hasBuildingsData(q.data);
  const hasGoogle = !!ENV.googleKey;
  return {
    style: resolveMapStyle({ mapStyle, mapStyleChosen }, hasBuildings, hasGoogle),
    hasBuildings,
    hasGoogle,
    settled: q.isSuccess || q.isError,
  };
}

/** The view really on screen: chosen and available (WebGL, keys, buildings) and not crashed. */
export function useEffectiveView(): View {
  const view = useScene((s) => s.view);
  const rendererFailed = useScene((s) => s.rendererFailed);
  const { hasBuildings } = useMapStyle();
  const webglOk = useMemo(webglSupported, []);
  return effectiveView(view, availableViews(ENV, webglOk, hasBuildings), rendererFailed);
}
