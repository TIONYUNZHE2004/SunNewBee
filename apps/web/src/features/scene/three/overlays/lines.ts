import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

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
 * Overlay pass: depthTest false, depthWrite false, `renderOrder` >= 10 so it always draws on top.
 * Not decorative and no raycast override: picking is the shared picker's job.
 */
export function createLineBatch(
  lines: Float32Array[],
  style: LineStyle,
  liftM: number,
  renderOrder: number,
): THREE.Object3D {
  const usable = lines.filter((l) => l.length >= 6);
  let segs = 0;
  for (const l of usable) segs += l.length / 3 - 1;
  const pos = new Float32Array(segs * 6);
  const dist = new Float32Array(segs * 2);
  let s = 0;
  for (const l of usable) {
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
    depthTest: false,
    depthWrite: false,
  });
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
