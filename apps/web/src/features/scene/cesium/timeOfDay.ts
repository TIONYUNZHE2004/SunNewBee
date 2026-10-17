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
  dusk: {
    skyColor: "#c98aa6",
    globeBase: "#4a4a5a",
    tileBrightness: 0.75,
    fogDensity: 0.0002,
    hue: 0,
  },
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

export const mapboxLightPreset = (t: Theme): "day" | "dusk" | "night" => t;

/** Narrow structural types so the helper can be tested with fakes (no WebGL in jsdom). */
export interface TimeViewer {
  isDestroyed(): boolean;
  scene: {
    backgroundColor: unknown;
    fog: { density: number };
    requestRender(): void;
  };
}
export interface TimeTiles {
  isDestroyed?: () => boolean;
  customShader: unknown;
}
export interface TimeShader {
  setUniform(name: string, value: number): void;
}
export interface TimeOps {
  color: (css: string) => unknown;
  shader: (brightness: number) => TimeShader;
}

// One CustomShader per tileset: toggling the theme only updates the uniform (no shader rebuild).
const shaders = new WeakMap<object, TimeShader>();

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
  if (tiles && !tiles.isDestroyed?.()) {
    try {
      let shader = shaders.get(tiles);
      if (shader) shader.setUniform("u_brightness", style.tileBrightness);
      else {
        shader = ops.shader(style.tileBrightness);
        shaders.set(tiles, shader);
        tiles.customShader = shader;
      }
    } catch {
      /* tileset torn down mid-update: ignore */
    }
  }
  scene.requestRender();
}
