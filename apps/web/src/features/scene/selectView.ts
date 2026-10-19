let webglCached: true | undefined;

/**
 * WebGL 2 available. A success is cached for the page: each probe creates a throwaway WebGL
 * context (~100 ms on the reference laptop), and components that mount when an answer lands asked
 * again (gate AC-D18 hitch). The probe context is released at once. A failure is not cached (a
 * lost or busy GPU may recover; a probe that fails is cheap).
 */
export const webglSupported = (): boolean => {
  if (webglCached) return true;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl && typeof gl.getExtension === "function")
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (gl) webglCached = true;
    return !!gl;
  } catch {
    return false;
  }
};

/** Tests only: forget the cached probe. */
export const resetWebglProbe = () => {
  webglCached = undefined;
};

export type View = "cesium" | "mapbox" | "list";

type Env = { googleKey: string; cesiumToken: string; mapboxToken: string };

/**
 * Which views can be chosen (used to disable switcher buttons). The 3D view (id "cesium") needs
 * WebGL plus something to draw: Google/Ion tiles for Realistic on Cesium (a key), or buildings
 * data for the keyless Stylised city drawn by Three.js.
 */
export function availableViews(env: Env, webglOk: boolean, hasBuildings = false): View[] {
  if (!webglOk) return ["list"];
  return [
    ...(env.googleKey || env.cesiumToken || hasBuildings ? (["cesium"] as View[]) : []),
    ...(env.mapboxToken ? (["mapbox"] as View[]) : []),
    "list",
  ];
}

/**
 * The view actually on screen: the chosen one if available and not crashed. A crashed 3D renderer
 * (Three.js for Stylised, Cesium for Realistic) falls to Mapbox when available, else the list.
 */
export function effectiveView(view: View, available: View[], rendererFailed: boolean): View {
  if (!available.includes(view)) return "list";
  if (!rendererFailed) return view;
  return view === "cesium" && available.includes("mapbox") ? "mapbox" : "list";
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
