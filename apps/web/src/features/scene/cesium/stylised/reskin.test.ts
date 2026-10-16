import { describe, expect, it, vi } from "vitest";
import { ecef } from "./buildingsMesh";
import { paletteFor } from "./palette";
import { type ReskinCesium, type ReskinViewer, reskin } from "./reskin";

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
      backgroundColor: null,
      fog: { density: 0 },
      light: null,
      requestRender: vi.fn(),
    },
  } as unknown as ReskinViewer & { scene: { requestRender: ReturnType<typeof vi.fn> } };
}

describe("reskin", () => {
  it("re-themes every built layer, sets ground/sky/fog and the sun light, renders once", () => {
    const v = viewer();
    const a = { setTheme: vi.fn() };
    const b = { setTheme: vi.fn() };
    reskin(C, v, [a, null, undefined, b], "day", AT);
    expect(a.setTheme).toHaveBeenCalledWith("day");
    expect(b.setTheme).toHaveBeenCalledWith("day");
    const day = paletteFor("day");
    expect(v.scene.globe.baseColor).toEqual({ css: day.ground });
    expect(v.scene.backgroundColor).toEqual({ css: day.sky });
    expect(v.scene.fog.density).toBe(day.fog);
    const light = v.scene.light as unknown as DirectionalLight;
    expect(light.options.color).toEqual({ css: day.sun.color });
    expect(light.options.intensity).toBe(day.sun.intensity);
    // The light travels downwards: its direction points against the local up vector.
    const up = ecef(AT.lon, AT.lat, 0);
    const d = light.options.direction;
    expect(d.x * up[0] + d.y * up[1] + d.z * up[2]).toBeLessThan(0);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    expect(v.scene.requestRender).toHaveBeenCalledTimes(1);
  });

  it("rapid toggles end on the latest theme", () => {
    const v = viewer();
    const h = { setTheme: vi.fn() };
    for (const t of ["night", "day", "night"] as const) reskin(C, v, [h], t, AT);
    expect(h.setTheme).toHaveBeenLastCalledWith("night");
    expect((v.scene.light as unknown as DirectionalLight).options.color).toEqual({
      css: paletteFor("night").sun.color,
    });
  });
});
