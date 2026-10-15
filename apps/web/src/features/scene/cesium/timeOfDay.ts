import type { Theme } from "../../../ui/theme";

export interface CesiumTimeStyle {
  skyColor: string;
  globeBase: string;
  tileBrightness: number;
  fogDensity: number;
  hue: number;
}

const STYLES: Record<Theme, CesiumTimeStyle> = {
  day: { skyColor: "#9bc4e8", globeBase: "#5f7f5a", tileBrightness: 1, fogDensity: 0.0001, hue: 0 },
  night: {
    skyColor: "#1f1838",
    globeBase: "#1c2330",
    tileBrightness: 0.45,
    fogDensity: 0.0004,
    hue: 0,
  },
};

/** Pure: display-only lighting for the 3D scene. Never used to derive any fact. */
export const cesiumTimeStyle = (t: Theme): CesiumTimeStyle => STYLES[t] ?? STYLES.night;

export const mapboxLightPreset = (t: Theme): "day" | "night" => (t === "day" ? "day" : "night");

/** Narrow structural types so the helper can be tested with fakes (no WebGL in jsdom). */
export interface TimeViewer {
  isDestroyed(): boolean;
  scene: {
    backgroundColor: unknown;
    fog: { density: number };
    globe?: { baseColor: unknown };
    skyAtmosphere?: { brightnessShift: number };
    requestRender(): void;
  };
}
export interface TimeTiles {
  isDestroyed?: () => boolean;
  customShader: unknown;
}
export interface TimeOps {
  color: (css: string) => unknown;
  shader: (brightness: number) => unknown;
}

export function applyCesiumTime(
  viewer: TimeViewer | undefined,
  tiles: TimeTiles | undefined,
  style: CesiumTimeStyle,
  ops: TimeOps,
): void {
  if (!viewer || viewer.isDestroyed()) return;
  const scene = viewer.scene;
  scene.backgroundColor = ops.color(style.skyColor);
  scene.fog.density = style.fogDensity;
  if (scene.globe) scene.globe.baseColor = ops.color(style.globeBase);
  if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = style.tileBrightness - 1;
  if (tiles && !tiles.isDestroyed?.()) {
    try {
      tiles.customShader = ops.shader(style.tileBrightness);
    } catch {
      /* tileset torn down mid-update: ignore */
    }
  }
  scene.requestRender();
}
