import type { MapStyle } from "../sceneStore";
import type { View } from "../selectView";

export type StylisedEngine = "three" | "cesium";
export type Renderer = "three" | "cesium" | "mapbox" | "list";

const KEY = "tl.engine";
const isEngine = (v: unknown): v is StylisedEngine => v === "three" || v === "cesium";

/** `?engine=three|cesium` wins and is persisted as `tl.engine`; else the stored value; else "cesium". */
export function readStylisedEngine(
  search: string,
  store?: Pick<Storage, "getItem" | "setItem">,
): StylisedEngine {
  const asked = new URLSearchParams(search).get("engine");
  if (isEngine(asked)) {
    try {
      store?.setItem(KEY, asked);
    } catch {
      /* per-viewer convenience only */
    }
    return asked;
  }
  try {
    const stored = store?.getItem(KEY);
    if (isEngine(stored)) return stored;
  } catch {
    /* unavailable storage: default */
  }
  return "cesium";
}

let memo: StylisedEngine | undefined;

/** Read once per page load (location.search + localStorage). */
export const stylisedEngine = (): StylisedEngine => {
  if (memo) return memo;
  let store: Storage | undefined;
  try {
    store = typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    store = undefined;
  }
  const search = typeof location === "undefined" ? "" : location.search;
  memo = readStylisedEngine(search, store);
  return memo;
};

/** Three.js only draws the Stylised style on the Cesium view; everything else is unchanged. */
export function rendererFor(view: View, style: MapStyle, engine: StylisedEngine): Renderer {
  return view === "cesium" && style === "stylised" && engine === "three" ? "three" : view;
}
