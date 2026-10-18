import type { MapStyle } from "../sceneStore";
import type { View } from "../selectView";

export type Renderer = "three" | View;

const LEGACY_KEY = "tl.engine";

/** Three.js draws the Stylised style on the 3D view; everything else is unchanged. */
export function rendererFor(view: View, style: MapStyle): Renderer {
  return view === "cesium" && style === "stylised" ? "three" : view;
}

/** Removes the retired `tl.engine` choice (the `?engine=` switch no longer exists). */
export function clearLegacyEngineChoice(store: Pick<Storage, "removeItem"> | null): void {
  try {
    store?.removeItem(LEGACY_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}
