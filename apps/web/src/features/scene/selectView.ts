export const webglSupported = () => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
};

export type View = "cesium" | "mapbox" | "list";

type Env = { googleKey: string; cesiumToken: string; mapboxToken: string };

/**
 * Which views can be chosen (used to disable switcher buttons). Cesium needs WebGL plus something
 * to draw: Google/Ion tiles (a key) or the keyless stylised city (the world has buildings data).
 */
export function availableViews(env: Env, webglOk: boolean, hasBuildings = false): View[] {
  if (!webglOk) return ["list"];
  return [
    ...(env.googleKey || env.cesiumToken || hasBuildings ? (["cesium"] as View[]) : []),
    ...(env.mapboxToken ? (["mapbox"] as View[]) : []),
    "list",
  ];
}

/** The view actually on screen: the chosen one only if available and its renderer has not crashed. */
export function effectiveView(view: View, available: View[], rendererFailed: boolean): View {
  return !rendererFailed && available.includes(view) ? view : "list";
}

/** The single place the renderer is decided: preferred if available, else the best available. */
export function selectView(
  env: Env,
  webglOk: boolean,
  preferred?: View,
  hasBuildings = false,
): View {
  const available = availableViews(env, webglOk, hasBuildings);
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] ?? "list";
}
