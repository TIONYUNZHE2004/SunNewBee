import * as THREE from "three";
import { DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";

/** At most this many drops (C9: ≤ 3,000). */
export const RAIN_DROPS = 2400;
/** The rain box round its centre (m): half width, height. */
const HALF_M = 80;
const HEIGHT_M = 90;
/** The box centre sits this far ahead of the camera along its view. */
const AHEAD_M = 70;
/** Fall speed (m per screen s) and the streak's length and slant (m). */
const FALL_M_S = 38;
const STREAK_M = 1.8;
const SLANT_M = 0.35;
const OPACITY = 0.55;

const frac = (x: number) => x - Math.floor(x);

/** Deterministic drop seeds in [0, 1)^3 (no Math.random: a seek restores the same frame). */
export function rainSeeds(n = RAIN_DROPS): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = frac(Math.sin(i * 12.9898 + 1.7) * 43758.5453);
    out[i * 3 + 1] = frac(Math.sin(i * 78.233 + 4.1) * 24634.6345);
    out[i * 3 + 2] = frac(Math.sin(i * 39.425 + 2.3) * 12543.1234);
  }
  return out;
}

/**
 * Monsoon rain (spec §6.2 set pieces, C9 step 5, AC-W3): one LineSegments streak system (one draw,
 * no triangles) in a box ahead of the camera. Drops are fixed in world space and wrap round the box
 * as the camera moves; they fall with screen time, so a paused or seeked frame is the same frame.
 * Off (not drawn, no per-frame work) whenever the set piece's rain level is 0. The sky and fog grey
 * is the mood grade's (`devsimView.devsimGrade` wet), not this part's. Decorative.
 */
export function createRain(): DevsimPart & { level(): number; drops(): number } {
  const seeds = rainSeeds();
  const n = seeds.length / 3;
  const pos = new Float32Array(n * 6);
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  const mat = new THREE.LineBasicMaterial({
    color: DEVSIM_COLOURS.rain,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = "devsim-rain";
  lines.frustumCulled = false;
  lines.raycast = () => {};
  lines.renderOrder = 4;
  lines.visible = false;
  const group = new THREE.Group();
  group.name = "devsim-rain-group";
  group.add(lines);
  let level = 0;
  let t = 0;
  let laidT = Number.NaN;
  const laidAt = new THREE.Vector3(Number.NaN, 0, 0);
  const dir = new THREE.Vector3();
  const c = new THREE.Vector3();

  /** Lays the drops round centre c at time t (wrapped into the box). */
  const lay = () => {
    const W = HALF_M * 2;
    const fall = t * FALL_M_S;
    for (let i = 0; i < n; i++) {
      const sx = seeds[i * 3] as number;
      const sy = seeds[i * 3 + 1] as number;
      const sz = seeds[i * 3 + 2] as number;
      // world-fixed columns wrapped round the box centre
      const x = c.x - HALF_M + frac((sx * W - (c.x - HALF_M)) / W) * W;
      const z = c.z - HALF_M + frac((sz * W - (c.z - HALF_M)) / W) * W;
      const y =
        c.y -
        HEIGHT_M / 2 +
        frac((sy * HEIGHT_M - fall - (c.y - HEIGHT_M / 2)) / HEIGHT_M) * HEIGHT_M;
      const k = i * 6;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      pos[k + 3] = x + SLANT_M;
      pos[k + 4] = y + STREAK_M;
      pos[k + 5] = z + SLANT_M * 0.4;
    }
    attr.needsUpdate = true;
  };

  return {
    group,
    level: () => level,
    drops: () => n,
    demoState: () => ({
      rain: level > 0,
      rainLevel: Math.round(level * 1000) / 1000,
      rainDrops: n,
    }),
    aoExcluded: () => [lines],
    update({ t: tt, sp }: DevsimFrame) {
      t = tt;
      level = sp?.rain ?? 0;
      lines.visible = level > 0;
      mat.opacity = OPACITY * level;
    },
    project(camera) {
      if (level <= 0) return;
      camera.getWorldDirection(dir);
      c.copy(camera.position).addScaledVector(dir, AHEAD_M);
      if (laidT === t && laidAt.distanceToSquared(c) < 0.25) return;
      laidT = t;
      laidAt.copy(c);
      lay();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      group.clear();
    },
  };
}
