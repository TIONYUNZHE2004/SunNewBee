import type * as Cesium from "cesium";
import { enuToEcef } from "./buildingsMesh";
import { type Palette, paletteFor, type Theme } from "./palette";

export interface Reskinnable {
  setTheme(t: Theme): void;
}

export type ReskinCesium = Pick<typeof Cesium, "Color" | "Cartesian3" | "DirectionalLight">;

export interface ReskinViewer {
  scene: {
    globe: { baseColor: Cesium.Color };
    fog: { density: number };
    light: Cesium.Light;
    requestRender(): void;
  };
}

/** The palette key light as a Cesium DirectionalLight (direction = where the light travels, ECEF). */
export function sunLight(
  C: ReskinCesium,
  p: Palette,
  at: { lon: number; lat: number },
): Cesium.DirectionalLight {
  const [x, y, z] = enuToEcef(p.light.keyDir, at.lon, at.lat);
  const n = Math.hypot(x, y, z) || 1;
  return new C.DirectionalLight({
    direction: new C.Cartesian3(x / n, y / n, z / n),
    color: C.Color.fromCssColorString(p.light.key),
    intensity: p.light.keyIntensity * 2.5,
  });
}

/**
 * Day/Night re-skin in place: flat ground colour and fog, every layer's `setTheme` (handles that
 * are not built yet are skipped: they are created with the latest theme), the sun light, then one
 * requestRender (requestRenderMode).
 */
export function reskin(
  C: ReskinCesium,
  viewer: ReskinViewer,
  handles: (Reskinnable | null | undefined)[],
  theme: Theme,
  at: { lon: number; lat: number },
): void {
  const p = paletteFor(theme);
  const { scene } = viewer;
  scene.globe.baseColor = C.Color.fromCssColorString(p.ground);
  scene.fog.density = p.fog;
  for (const h of handles) h?.setTheme(theme);
  scene.light = sunLight(C, p, at);
  scene.requestRender();
}
