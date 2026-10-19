import type * as THREE from "three";
import type { HeroClip } from "../journey/heroDriver";

export type { HeroClip };

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
export const HERO_DISPLAY_SCALE = 1.55;
export const HERO_TRUE_HEIGHT_M = 1.55;

/** A world-space point that must touch the ground (a foot sole, a walker leg tip). */
export interface HeroContact {
  name: string;
  x: number;
  y: number;
  z: number;
}

/**
 * What the journey player needs from a hero model. The placeholder (`placeholderHero.ts`) and the
 * rigged GLB hero (C-T4) both implement it, so the driver and the mount never change.
 *
 * - `object3d` is added to the scene once; its local origin is between her feet on the ground, the
 *   front is +z (yaw = atan2(dx, dz), as `motion/agents.ts`). It includes the yellow ground ring.
 * - `setPose(pos, yaw)` places the root (pos.y is the ground height under her).
 * - `play(clip, time, rate)` shows `clip` at `time` seconds. `time` is absolute and already scaled
 *   by `rate` (the driver integrates the walk cadence), so a GLB sets `action.time = time` (wrapped
 *   for loops) and updates its mixer by 0; it never accumulates real time (scrub-safe). `rate` is the
 *   walk-cycle factor, for anything that wants it (blend weights, foot-planting); 0 when not walking.
 *   `sit_down` and `stand_up` are at most 1.5 s; a time past the end holds the last frame.
 * - `contacts()` returns the world-space ground-contact points (feet, walker leg tips) for the
 *   AC-D10 ground check; a GLB returns its foot bones and walker-leg nodes.
 * - `dispose()` frees geometry, materials and textures it owns.
 */
export interface Hero {
  readonly object3d: THREE.Object3D;
  setPose(pos: { x: number; y: number; z: number }, yaw: number): void;
  play(clip: HeroClip, time: number, rate: number): void;
  contacts(): HeroContact[];
  dispose(): void;
}
