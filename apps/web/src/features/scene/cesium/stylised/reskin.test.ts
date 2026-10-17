import { describe, expect, it, vi } from "vitest";
import { ecef } from "./buildingsMesh";
import { paletteFor } from "./palette";
import { type ReskinCesium, type ReskinViewer, reskin, reskinPalette } from "./reskin";

class Cartesian3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
}
class DirectionalLight {
  constructor(
    public options: { direction: Cartesian3; color: { css: string }; intensity: number },
  ) {}
}
const C = {
  Cartesian3,
  DirectionalLight,
  Color: { fromCssColorString: (css: string) => ({ css }) },
} as unknown as ReskinCesium;
const AT = { lon: 101.51, lat: 3.18 };

function viewer() {
  return {
    scene: {
      globe: { baseColor: null },
      fog: { density: 0 },
      light: null,
      requestRender: vi.fn(),
    },
  } as unknown as ReskinViewer & { scene: { requestRender: ReturnType<typeof vi.fn> } };
}

describe("reskin", () => {
  it("re-themes every built layer, sets ground/fog and the key light, renders once", () => {
    const v = viewer();
    const a = { setPalette: vi.fn() };
    const b = { setPalette: vi.fn() };
    reskinPalette(C, v, [a, null, undefined, b], paletteFor("day"), AT, true);
    expect(a.setPalette).toHaveBeenCalledWith(paletteFor("day"), true);
    expect(b.setPalette).toHaveBeenCalledWith(paletteFor("day"), true);
    const day = paletteFor("day");
    expect(v.scene.globe.baseColor).toEqual({ css: day.ground });
    expect(v.scene.fog.density).toBe(day.fog);
    const light = v.scene.light as unknown as DirectionalLight;
    expect(light.options.color).toEqual({ css: day.light.key });
    expect(light.options.intensity).toBe(day.light.keyIntensity * 2.5);
    // The light travels downwards: its direction points against the local up vector.
    const up = ecef(AT.lon, AT.lat, 0);
    const d = light.options.direction;
    expect(d.x * up[0] + d.y * up[1] + d.z * up[2]).toBeLessThan(0);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    expect(v.scene.requestRender).toHaveBeenCalledTimes(1);
  });

  it("rapid toggles end on the latest theme", () => {
    const v = viewer();
    const h = { setPalette: vi.fn() };
    for (const t of ["night", "day", "night"] as const) reskin(C, v, [h], t, AT);
    expect(h.setPalette).toHaveBeenLastCalledWith(paletteFor("night"), true);
    expect((v.scene.light as unknown as DirectionalLight).options.color).toEqual({
      css: paletteFor("night").light.key,
    });
  });
});
