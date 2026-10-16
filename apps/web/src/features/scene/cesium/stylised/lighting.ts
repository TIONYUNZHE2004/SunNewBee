import type * as Cesium from "cesium";
import { ecef, enuToEcef } from "./buildingsMesh";
import type { Palette } from "./palette";

/**
 * Soft, drifting cloud-shadow patches (decorative). `tl_cloud` returns 1.0 for no shadow, down to
 * 1.0 - cloudShadow under a passing cloud. It works in ECEF xy around `cloudOrigin` (the scene
 * anchor): not the local ground plane, but over a 5 km township the skew is invisible in soft noise.
 * Uniforms: time (seconds, from the motion clock), cloudShadow (0 to 0.15), cloudOrigin (vec3).
 */
export const CLOUD_GLSL = /* glsl */ `
float tl_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 1.0 = no shadow; down to 1.0 - cloudShadow under a passing cloud.
float tl_cloud(vec3 positionWC) {
  vec2 p = (positionWC.xy - cloudOrigin.xy) / 350.0 - vec2(time * 0.008, time * 0.003);
  float n = tl_noise(p) * 0.6 + tl_noise(p * 2.1) * 0.4;
  return 1.0 - cloudShadow * smoothstep(0.55, 0.8, n);
}
`;

/**
 * Shared GLSL for every stylised material: warm key + sky fill (from above) + ground bounce (from
 * below), distance fog towards the mood's horizon colour, and cloud shadows. Uniform names are
 * fixed: keyColor, fillColor, bounceColor, horizonColor, keyWC, upWC, keyIntensity, ambient,
 * fogDensity, time, cloudShadow, cloudOrigin (all supplied by `lightUniforms`).
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
${CLOUD_GLSL}`;

/** World (ECEF) position of the fragment, from inside `czm_getMaterial`. */
export const POSITION_WC_GLSL =
  "vec3 positionWC = (czm_inverseView * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;";

const unit = (C: Pick<typeof Cesium, "Cartesian3">, v: [number, number, number]) => {
  const n = Math.hypot(...v) || 1;
  return new C.Cartesian3(v[0] / n, v[1] / n, v[2] / n);
};

/**
 * Every uniform LIGHTING_GLSL reads. `time` is the motion clock's seconds: pass the current value
 * when re-applying a palette so a mood change never jumps the cloud shadows back to 0.
 */
export function lightUniforms(
  C: Pick<typeof Cesium, "Color" | "Cartesian3">,
  p: Palette,
  at: { lon: number; lat: number },
  time = 0,
): Record<string, unknown> {
  const col = (c: string) => C.Color.fromCssColorString(c);
  const toLight = enuToEcef(
    p.light.keyDir.map((d) => -d) as [number, number, number],
    at.lon,
    at.lat,
  );
  const origin = ecef(at.lon, at.lat, 0);
  return {
    keyColor: col(p.light.key),
    fillColor: col(p.light.fill),
    bounceColor: col(p.light.bounce),
    horizonColor: col(p.horizon),
    keyWC: unit(C, toLight),
    upWC: unit(C, origin),
    keyIntensity: p.light.keyIntensity,
    ambient: p.light.ambient,
    fogDensity: p.fog,
    time,
    // No cloud shadows at Night.
    cloudShadow: p.glow >= 1 ? 0 : 0.15,
    cloudOrigin: new C.Cartesian3(origin[0], origin[1], origin[2]),
  };
}

export const LIT_COLOR_SOURCE = /* glsl */ `
${LIGHTING_GLSL}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  ${POSITION_WC_GLSL}
  // Lift like the roofs, so props stay readable at Dusk and Night.
  m.diffuse = tl_fog(color.rgb * mix(tl_light(materialInput.normalEC), vec3(1.0), 0.35) * tl_cloud(positionWC), materialInput.positionToEyeEC);
  return m;
}
`;

/** LIT_COLOR_SOURCE that also takes its alpha from `color` (translucent materials). */
const LIT_COLOR_ALPHA_SOURCE = LIT_COLOR_SOURCE.replace(
  "return m;",
  "m.alpha = color.a;\n  return m;",
);

/**
 * A flat-colour material lit by the stylised lighting model (use with MaterialAppearance flat: true).
 * With `alpha`, the material is translucent (use a translucent MaterialAppearance).
 */
export function litColorMaterial(
  C: Pick<typeof Cesium, "Material" | "Color" | "Cartesian3">,
  css: string,
  p: Palette,
  at: { lon: number; lat: number },
  alpha?: number,
): Cesium.Material {
  const color = C.Color.fromCssColorString(css);
  return new C.Material({
    fabric: {
      uniforms: {
        color: alpha === undefined ? color : color.withAlpha(alpha),
        ...lightUniforms(C, p, at),
      },
      source: alpha === undefined ? LIT_COLOR_SOURCE : LIT_COLOR_ALPHA_SOURCE,
    },
    translucent: alpha !== undefined,
  });
}

export function setLightUniforms(m: Cesium.Material, u: Record<string, unknown>) {
  Object.assign(m.uniforms, u);
}
