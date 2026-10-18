import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { CESIUM_DASH, type EdgeStatus, statusStyle } from "../../styles";

/** Status lines are fully opaque inside this camera distance (metres) and gone beyond FADE_FAR_M. */
export const FADE_NEAR_M = 900;
export const FADE_FAR_M = 1500;

/**
 * Opacity factor for a line fragment `distM` metres from the camera: 1 up to `near`, 0 from `far`,
 * smoothstep (the same curve the shader uses) in between. AC-A3.
 */
export function distanceFade(distM: number, near = FADE_NEAR_M, far = FADE_FAR_M): number {
  if (!(distM > near)) return 1;
  if (distM >= far) return 0;
  const t = (distM - near) / (far - near);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Depth bias of a line, as a fraction of its view distance (it is pulled this much toward the
 * camera, screen position unchanged). The ground bands use a large polygonOffset factor, which on
 * an oblique plane at range moves them metres toward the camera (about 1% of the distance at the
 * hero bookmark), so a fixed 0.4 m lift loses to the roads at 800 m: lines would vanish. A line
 * quad is screen-aligned (no depth slope), so a polygonOffset does nothing for it. 0.2% of the
 * distance (1.6 m at 800 m, 0.6 m at 300 m) was enough to show lines on roads in the acceptance
 * renders and stays below a storey, so a roof or wall still hides a line behind it.
 */
export const LINE_DEPTH_BIAS = 0.004;

/**
 * Patches LineMaterial's shaders: a view-distance depth bias (always) and, with `fade`, a
 * view-distance alpha fade (a varying and two uniforms, no per-frame work).
 */
function patchLineShaders(material: LineMaterial, fade: boolean): void {
  material.uniforms.uDepthBias = { value: LINE_DEPTH_BIAS };
  let vs = material.vertexShader
    .replace(
      "void main() {",
      "uniform float uDepthBias;\n" + (fade ? "varying float vFadeDist;\n" : "") + "void main() {",
    )
    .replace(
      "gl_Position = clip;",
      "float dn = clip.w * ( 1.0 - uDepthBias );\n\t\t\tclip.z = ( projectionMatrix[3][2] / dn - projectionMatrix[2][2] ) * clip.w;\n\t\t\tgl_Position = clip;",
    );
  if (fade)
    vs = vs.replace(
      "#include <fog_vertex>",
      "#include <fog_vertex>\n\t\t\tvFadeDist = length( mvPosition.xyz );",
    );
  material.vertexShader = vs;
  if (fade) {
    material.uniforms.uFadeNear = { value: FADE_NEAR_M };
    material.uniforms.uFadeFar = { value: FADE_FAR_M };
    material.fragmentShader = material.fragmentShader
      .replace(
        "void main() {",
        "varying float vFadeDist;\nuniform float uFadeNear;\nuniform float uFadeFar;\nvoid main() {",
      )
      .replace(
        "gl_FragColor = vec4( diffuseColor.rgb, alpha );",
        "alpha *= 1.0 - smoothstep( uFadeNear, uFadeFar, vFadeDist );\n\t\t\tif ( alpha < 0.004 ) discard;\n\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha );",
      );
  }
  material.needsUpdate = true;
}

export interface LineStyle {
  color: string;
  widthPx: number;
  /** Cesium PolylineDash semantics: a 16-bit on/off mask stretched over `sizePx`. */
  dash?: { sizePx: number; pattern: number };
  opacity?: number;
}

/**
 * Line2 dashes run in world metres, Cesium's in screen pixels. The layer keeps them screen-constant
 * by scaling the dash by the current metres per pixel (`setDashScale`); a new batch assumes 1.
 */
/** Cesium dash params (`dashLength` px, `dashPattern` mask) as a LineStyle dash. */
export const dashFromCesium = (d: { dashLength: number; dashPattern: number }) => ({
  sizePx: d.dashLength,
  pattern: d.dashPattern,
});

/**
 * Number of set bits in the 16-bit mask. Only the duty cycle (on-fraction) of the pattern is kept:
 * Line2 has one dash and one gap per cycle. CESIUM_DASH / GAP_CESIUM_DASH / the what-if mask are
 * all a single contiguous run of ones (0xf000, 0xfff0, 0xff00, 0x00ff), so nothing is lost.
 */
const bits = (n: number) => {
  let c = 0;
  for (let v = n & 0xffff; v; v &= v - 1) c++;
  return c;
};

/**
 * One batched Line2 (LineSegments2, one draw call) for many polylines at a constant lift. Each
 * input is xyz triplets (y is replaced by `liftM`); lines under two points are skipped.
 * Transparent pass: depthTest true (a building hides a line behind it, AC-A2), depthWrite false, a
 * polygon offset on top of the lift so it never z-fights the ground ribbons, `renderOrder` >= 10 so
 * it draws after the ground bands (1-6). Buildings are opaque and write depth. With `fade` the
 * alpha follows `distanceFade` per fragment (view distance, shader uniform, no per-frame work).
 * Not decorative and no raycast override: picking is the shared picker's job. With `ids` (one per
 * input line) the batch keeps `userData.segPos` (the segment endpoints, 6 floats each) and
 * `userData.segIds` (the line id per segment), so the picker can name the line under the cursor.
 */
export function createLineBatch(
  lines: Float32Array[],
  style: LineStyle,
  liftM: number,
  renderOrder: number,
  ids?: readonly string[],
  fade = false,
): THREE.Object3D {
  const usable = lines.flatMap((l, i) => (l.length >= 6 ? [{ l, id: ids?.[i] ?? "" }] : []));
  let segs = 0;
  for (const { l } of usable) segs += l.length / 3 - 1;
  const pos = new Float32Array(segs * 6);
  const dist = new Float32Array(segs * 2);
  const segIds: string[] = [];
  let s = 0;
  for (const { l, id } of usable) {
    const n = l.length / 3;
    let d = 0; // the dash runs on across vertices; it restarts only per polyline
    for (let i = 0; i < n - 1; i++, s++) {
      const a = i * 3;
      pos.set([l[a] as number, liftM, l[a + 2] as number], s * 6);
      pos.set([l[a + 3] as number, liftM, l[a + 5] as number], s * 6 + 3);
      const len = Math.hypot(
        (l[a + 3] as number) - (l[a] as number),
        (l[a + 5] as number) - (l[a + 2] as number),
      );
      if (ids) segIds.push(id);
      dist[s * 2] = d;
      dist[s * 2 + 1] = d += len;
    }
  }
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(pos);
  const buf = new THREE.InstancedInterleavedBuffer(dist, 2, 1);
  geometry.setAttribute("instanceDistanceStart", new THREE.InterleavedBufferAttribute(buf, 1, 0));
  geometry.setAttribute("instanceDistanceEnd", new THREE.InterleavedBufferAttribute(buf, 1, 1));

  const material = new LineMaterial({
    color: new THREE.Color(style.color),
    linewidth: style.widthPx,
    worldUnits: false,
    transparent: true,
    opacity: style.opacity ?? 1,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  patchLineShaders(material, fade);
  if (style.dash) {
    material.dashed = true;
    material.userData.dashPx = {
      on: (bits(style.dash.pattern) / 16) * style.dash.sizePx,
      cycle: style.dash.sizePx,
    };
  }
  const batch = new LineSegments2(geometry, material);
  batch.renderOrder = renderOrder;
  batch.frustumCulled = false;
  setDashScale(batch, 1);
  if (ids) {
    batch.userData.segPos = pos;
    batch.userData.segIds = segIds;
  }
  return batch;
}

/** Dash sizes in metres for `mpp` metres per screen pixel, so a dash keeps its length in pixels. */
export function setDashScale(batch: THREE.Object3D, mpp: number): void {
  const m = (batch as LineSegments2).material as LineMaterial | undefined;
  const d = m?.userData.dashPx as { on: number; cycle: number } | undefined;
  if (!m || !d) return;
  m.dashSize = d.on * mpp;
  m.gapSize = (d.cycle - d.on) * mpp;
}

/** An edge status as a line style (colour, width, alpha and dash pattern from styles.ts). */
export function statusLineStyle(st: EdgeStatus, extraWidthPx = 0): LineStyle {
  const s = statusStyle(st);
  const d = CESIUM_DASH[st];
  return {
    color: s.color,
    widthPx: s.width + extraWidthPx,
    opacity: s.alpha,
    dash: d ? dashFromCesium(d) : undefined,
  };
}
