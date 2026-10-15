import { describe, expect, it, vi } from "vitest";
import { applyCesiumTime, cesiumTimeStyle, mapboxLightPreset } from "./timeOfDay";

describe("timeOfDay", () => {
  it("night is darker than day; day brightness is 1", () => {
    expect(cesiumTimeStyle("night").tileBrightness).toBeLessThan(
      cesiumTimeStyle("day").tileBrightness,
    );
    expect(cesiumTimeStyle("day").tileBrightness).toBe(1);
  });
  it("uses the planned sky and fog values", () => {
    expect(cesiumTimeStyle("night")).toMatchObject({ skyColor: "#1f1838", fogDensity: 0.0004 });
    expect(cesiumTimeStyle("day")).toMatchObject({ skyColor: "#9bc4e8", fogDensity: 0.0001 });
  });
  it("maps to the Mapbox light preset", () => {
    expect(mapboxLightPreset("night")).toBe("night");
    expect(mapboxLightPreset("day")).toBe("day");
  });
});

describe("applyCesiumTime", () => {
  const make = () => {
    const requestRender = vi.fn();
    const viewer = {
      isDestroyed: () => false,
      scene: {
        backgroundColor: null as unknown,
        fog: { density: 0 },
        globe: { baseColor: null as unknown },
        skyAtmosphere: { brightnessShift: 0 },
        requestRender,
      },
    };
    const tiles = { customShader: undefined as unknown };
    const ops = { color: (c: string) => `color:${c}`, shader: (b: number) => `shader:${b}` };
    return { viewer, tiles, requestRender, ops };
  };

  it("sets background, fog, tile shader and requests a render", () => {
    const { viewer, tiles, requestRender, ops } = make();
    applyCesiumTime(viewer, tiles, cesiumTimeStyle("night"), ops);
    expect(viewer.scene.backgroundColor).toBe("color:#1f1838");
    expect(viewer.scene.fog.density).toBe(0.0004);
    expect(tiles.customShader).toBe("shader:0.45");
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("tolerates missing viewer, tiles and destroyed viewer", () => {
    const { viewer, ops } = make();
    expect(() => applyCesiumTime(undefined, undefined, cesiumTimeStyle("day"), ops)).not.toThrow();
    applyCesiumTime(viewer, undefined, cesiumTimeStyle("day"), ops);
    expect(viewer.scene.fog.density).toBe(0.0001);
    const dead = { ...viewer, isDestroyed: () => true };
    expect(() => applyCesiumTime(dead, undefined, cesiumTimeStyle("day"), ops)).not.toThrow();
  });

  it("tolerates a destroyed tileset", () => {
    const { viewer, ops } = make();
    const tiles = {
      isDestroyed: () => true,
      set customShader(_v: unknown) {
        throw new Error("destroyed");
      },
    };
    expect(() => applyCesiumTime(viewer, tiles, cesiumTimeStyle("day"), ops)).not.toThrow();
  });
});
