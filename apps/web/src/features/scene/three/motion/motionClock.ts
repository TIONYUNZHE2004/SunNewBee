import * as THREE from "three";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { MoodMix } from "./agents";
import type { MotionLayer } from "./motionLayer";

/** The single motion clock runs at most 30 fps, on real time (never by frame count). */
export const MOTION_FRAME_MS = 1000 / 30;
/**
 * A motion frame is due this much early: rAF lands on vsync, so a frame meant for 33.3 ms often
 * arrives at 32.x. Without slack it would miss and the update slips a whole vsync (~20 fps). At
 * 60/120/144 Hz the frames still land 2/4/5 vsyncs apart, never above 30 fps.
 */
export const MOTION_SLACK_MS = 4;
/** Decorative people and vehicles fade over this long when Day or Rollout playback starts or ends. */
export const DECOR_FADE_MS = 1000;
/** Lit windows flicker only once the night weight is above this, and only while motion runs. */
const FLICKER_NIGHT = 0.5;

/**
 * Stop when Motion is off or reduced motion is set; pause when the tab is hidden or the map is off
 * screen. Any of these false means no motion frame is scheduled at all (render on demand).
 */
export function motionRunning(s: {
  enabled: boolean;
  reduced: boolean;
  visible: boolean;
  onScreen: boolean;
}): boolean {
  return s.enabled && !s.reduced && s.visible && s.onScreen;
}

/** Opacity for decorative people and vehicles: 0 while day.on || rollout.on, crossfading over 1000 ms. */
export function decorativeOpacity(prev: number, target: 0 | 1, dtMs: number): number {
  const step = Math.max(0, dtMs) / DECOR_FADE_MS;
  return target > prev ? Math.min(target, prev + step) : Math.max(target, prev - step);
}

/** The agent layer plus the mood-driven density hook the driver needs. */
export interface AgentLayer extends MotionLayer {
  setDensity(w: MoodMix): void;
}

/**
 * Everything the motion clock moves, behind the engine's one MotionLayer slot: the agents (faded by
 * Day/Rollout playback, thinned by mood), the ambient birds and clouds, and window flicker. The
 * engine owns uTime/uSway/uLimb; this owns uFlicker and the fade. Decorative only.
 */
export interface MotionDriver extends MotionLayer {
  readonly opacity: number;
  readonly target: 0 | 1;
  /** 0 while day.on || rollout.on, else 1. While stopped it applies at once (no clock to fade on). */
  setTarget(t: 0 | 1): void;
  /** Mood weights: density, flicker and the ambient day/night visibility. */
  setWeights(w: MoodMix): void;
  /** Replaces (and disposes) the agent layer; null removes it. */
  setAgents(l: AgentLayer | null): void;
  /** Motion stopped: static pose (no flicker), a running fade snaps to its target. The caller then asks for one final render. */
  rest(): void;
}

export function createMotionDriver(opts: {
  role: RoleUniforms;
  ambient: () => { tick(nowMs: number, w: MoodMix): void } | null;
  running: () => boolean;
}): MotionDriver {
  const group = new THREE.Group();
  group.name = "motion";
  group.userData.decorative = true;
  let agents: AgentLayer | null = null;
  let opacity = 1;
  let target: 0 | 1 = 1;
  let weights: MoodMix = { day: 1, dusk: 0, night: 0 };
  let last: number | null = null;

  const flicker = () => {
    opts.role.uFlicker.value = opts.running() && weights.night > FLICKER_NIGHT ? 1 : 0;
  };
  const show = (o: number) => {
    opacity = o;
    agents?.setOpacity(o);
  };

  return {
    group,
    get opacity() {
      return opacity;
    },
    get target() {
      return target;
    },
    tick(nowMs, camera, frustum) {
      const dt = last === null ? 0 : nowMs - last;
      last = nowMs;
      // Stopped frames carry a frozen clock (dt 0): a fade caught mid-way applies at once instead
      // of freezing half-visible (ruling: with motion stopped the fade applies at once).
      if (!opts.running()) {
        if (opacity !== target) show(target);
      } else if (opacity !== target) show(decorativeOpacity(opacity, target, dt));
      agents?.tick(nowMs, camera, frustum);
      opts.ambient()?.tick(nowMs, weights);
      flicker();
    },
    setOpacity: show,
    setTarget(t) {
      target = t;
      if (!opts.running()) show(t);
    },
    setWeights(w) {
      weights = w;
      agents?.setDensity(w);
      if (!opts.running()) {
        opts.ambient()?.tick(last ?? 0, w);
        flicker();
      }
    },
    setAgents(l) {
      if (l === agents) return;
      if (agents) {
        group.remove(agents.group);
        agents.dispose();
      }
      agents = l;
      if (l) {
        l.setDensity(weights);
        l.setOpacity(opacity);
        group.add(l.group);
      }
    },
    rest() {
      opts.role.uFlicker.value = 0;
      if (opacity !== target) show(target);
    },
    dispose() {
      if (agents) {
        group.remove(agents.group);
        agents.dispose();
        agents = null;
      }
    },
  };
}
