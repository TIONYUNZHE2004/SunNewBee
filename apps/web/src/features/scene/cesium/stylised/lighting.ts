import type * as Cesium from "cesium";
import { ecef, enuToEcef } from "./buildingsMesh";
import type { Palette } from "./palette";

/**
 * Shared GLSL for every stylised material: warm key + sky fill (from above) + ground bounce (from
 * below), and distance fog towards the mood's horizon colour. Uniform names are fixed: keyColor,
 * fillColor, bounceColor, horizonColor, keyWC, upWC, keyIntensity, ambient, fogDensity.
 */
export const LIGHTING_GLSL = /* glsl */ `
vec3 tl_light(vec3 normalEC) {
  vec3 n = normalize(normalEC);
  vec3 l = normalize(czm_viewRotation * keyWC);
  vec3 up = normalize(czm_viewRotation * upWC);
  float key = max(dot(n, l), 0.0) * keyIntensity;
  float sky = 0.5 + 0.5 * dot(n, up);
  return ambient * mix(bounceColor.rgb, fillColor.rgb, sky) + key * keyColor.rgb;
}
vec3 tl_fog(vec3 c, vec3 positionToEyeEC) {
  float d = length(positionToEyeEC) * fogDensity;
  return mix(c, horizonColor.rgb, clamp(1.0 - exp(-d * d), 0.0, 0.85));
}
`;

const unit = (C: Pick<typeof Cesium, "Cartesian3">, v: [number, number, number]) => {
  const n = Math.hypot(...v) || 1;
  return new C.Cartesian3(v[0] / n, v[1] / n, v[2] / n);
};

export function lightUniforms(
  C: Pick<typeof Cesium, "Color" | "Cartesian3">,
  p: Palette,
  at: { lon: number; lat: number },
): Record<string, unknown> {
  const col = (c: string) => C.Color.fromCssColorString(c);
  const toLight = enuToEcef(
    p.light.keyDir.map((d) => -d) as [number, number, number],
    at.lon,
    at.lat,
  );
  return {
    keyColor: col(p.light.key),
    fillColor: col(p.light.fill),
    bounceColor: col(p.light.bounce),
    horizonColor: col(p.horizon),
    keyWC: unit(C, toLight),
    upWC: unit(C, ecef(at.lon, at.lat, 0)),
    keyIntensity: p.light.keyIntensity,
    ambient: p.light.ambient,
    fogDensity: p.fog,
  };
}

export const LIT_COLOR_SOURCE = /* glsl */ `
${LIGHTING_GLSL}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  // Lift like the roofs, so props stay readable at Dusk and Night.
  m.diffuse = tl_fog(color.rgb * mix(tl_light(materialInput.normalEC), vec3(1.0), 0.35), materialInput.positionToEyeEC);
  return m;
}
`;

/** A flat-colour material lit by the stylised lighting model (use with MaterialAppearance flat: true). */
export function litColorMaterial(
  C: Pick<typeof Cesium, "Material" | "Color" | "Cartesian3">,
  css: string,
  p: Palette,
  at: { lon: number; lat: number },
): Cesium.Material {
  return new C.Material({
    fabric: {
      uniforms: { color: C.Color.fromCssColorString(css), ...lightUniforms(C, p, at) },
      source: LIT_COLOR_SOURCE,
    },
    translucent: false,
  });
}

export function setLightUniforms(m: Cesium.Material, u: Record<string, unknown>) {
  Object.assign(m.uniforms, u);
}
