export type View = "cesium" | "mapbox" | "list";

export function selectView(
  env: { googleKey: string; cesiumToken: string; mapboxToken: string },
  webglOk: boolean,
  preferred?: View,
): View {
  if (!webglOk) return "list";
  const available: View[] = [
    ...(env.googleKey || env.cesiumToken ? (["cesium"] as View[]) : []),
    ...(env.mapboxToken ? (["mapbox"] as View[]) : []),
    "list",
  ];
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] ?? "list";
}

/** Which views can be chosen (used to disable switcher buttons). */
export function availableViews(
  env: { googleKey: string; cesiumToken: string; mapboxToken: string },
  webglOk: boolean,
): View[] {
  if (!webglOk) return ["list"];
  return [
    ...(env.googleKey || env.cesiumToken ? (["cesium"] as View[]) : []),
    ...(env.mapboxToken ? (["mapbox"] as View[]) : []),
    "list",
  ];
}
