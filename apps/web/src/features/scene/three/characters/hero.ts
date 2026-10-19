import type * as THREE from "three";
import type { HeroClip, HeroFade } from "../journey/heroDriver";
import { HERO_MANIFEST } from "./benchGeometry";

export type { HeroClip, HeroFade };

/** The clip vocabulary every hero implements (spec §5 C1 H1), in this order. */
export const HERO_CLIPS: readonly HeroClip[] = [
  "walk",
  "idle",
  "sit_down",
  "sit_idle",
  "stand_up",
  "look",
];

/**
 * R-J3: people are drawn at 1.4-1.55x true scale; the hero always uses 1.55x. Her true standing
 * height is 1.55 m, so she is displayed at about 2.4 m (H4 window 2.2-2.5 m).
 */
export const HERO_DISPLAY_SCALE = HERO_MANIFEST.displayScale;
export const HERO_TRUE_HEIGHT_M = 1.55;

/** A world-space point that must touch the ground (a foot sole, a walker leg tip). */
export interface HeroContact {
  name: string;
  x: number;
  y: number;
  z: number;
  /**
   * On or climbing onto the bench (the rigged hero's authored window: `sit_idle`, `sit_down` from
   * 1.0 s, `stand_up` until 0.5 s; a clip-time rule, never foot height): her feet leave the ground
   * by design, so they are not ground contacts then. Never set while standing or walking.
   */
  airborne?: boolean;
}

/**
 * What the journey player needs from a hero model. The placeholder (`placeholderHero.ts`) and the
 * rigged GLB hero (C-T4) both implement it, so the driver and the mount never change.
 *
 * - `object3d` is added to the scene once; its local origin is between her feet on the ground, the
 *   front is +z (yaw = atan2(dx, dz), as `motion/agents.ts`). It includes the yellow ground ring.
 * - `setPose(pos, yaw)` places the root (pos.y is the drawn ground height under her).
 * - `play(clip, time, rate, fade?)` shows `clip` at `time` seconds.
 *   - `time` is absolute and already scaled by `rate` (the driver integrates the walk cadence), so a
 *     GLB sets `action.time = time` (wrapped for loops) and updates its mixer by 0; it never
 *     accumulates real time (the player scrubs).
 *   - `rate` is the walk-cycle factor, for blend weights or foot planting; 0 when not walking.
 *   - `fade` (first HERO_FADE_S = 0.2 s of a beat whose clip changed): also pose `fade.prevClip` at
 *     `fade.prevTime` and mix the two with weight `fade.blend` on the new clip (a GLB: both actions
 *     enabled, `setEffectiveWeight(1 - blend)` / `(blend)`). Pure inputs, so a seek mid-fade shows
 *     the same frame as play.
 * - **Time base:** `time` is in the clip's own seconds (the manifest durations). The driver plays
 *   `sit_down` / `stand_up` (1.5 s clips) over a 0.85 s screen beat (REST_TIMING), so `time` runs
 *   0..1.5 at 1.76x; a GLB just sets `action.time = time`. Past the end, hold the last frame.
 * - **Seat geometry (`benchGeometry.ts` `HERO_BENCH`, read from the asset manifest's `bench`).**
 *   Through every clip the root stays put; through `sit_down` / `sit_idle` / `stand_up` it is the
 *   bench-front stand point, and she already faces +z with her back to the bench (she steps round
 *   before `sit_down`). Seat box [-0.65, 0.39, -0.57]..[0.65, 0.45, -0.21], backrest
 *   [-0.65, 0.57, -0.62]..[0.65, 0.87, -0.55]; the clip carries the hips to `sitHips`
 *   (0, 0.48, -0.28) and parks the walker beside her right knee (prop bone). True metres,
 *   displayed x HERO_DISPLAY_SCALE (manifest `displayScale`, 1.55, R-J3).
 * - `contacts()` returns the world-space ground-contact points (`foot_l`, `foot_r`,
 *   `walker_{b|f}{l|r}`) for the AC-D10 ground check; a GLB returns its foot bones and walker-leg nodes.
 * - `dispose()` frees geometry, materials and textures it owns.
 */
export interface Hero {
  readonly object3d: THREE.Object3D;
  setPose(pos: { x: number; y: number; z: number }, yaw: number): void;
  play(clip: HeroClip, time: number, rate: number, fade?: HeroFade): void;
  /**
   * Optional ground for foot planting: with a sampler set (the drawn ground height at x, z, or null
   * where unknown), `play` puts each contact on the ground under it (a GLB: foot / walker-leg IK or
   * a per-leg offset); null sampler or null height: flat at pos.y. The player sets one whenever she
   * is not in a compressed walk while playing.
   */
  setGround?(sample: ((x: number, z: number) => number | null) | null): void;
  contacts(): HeroContact[];
  dispose(): void;
}
