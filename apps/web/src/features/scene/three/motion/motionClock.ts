import * as THREE from "three";
import type { Tier } from "../../shared/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { MoodMix } from "./agents";
import type { FlowSamples, MotionFlow, MotionLayer } from "./motionLayer";

/**
 * The 30 fps cadence: the P3 rate, and since P4 the fallback when display-rate motion is too slow
 * (see MotionClock). Always real time, never frame count.
 */
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
 * The motion clock's rate. "display": one motion tick per rAF while running (P4, High and Medium).
 * "30fps": one tick per MOTION_FRAME_MS (the P3 cadence), the fallback on a slow device.
 */
export type MotionMode = "display" | "30fps";
/** A median frame rate below this during motion switches the clock to 30 fps for the session. */
export const MOTION_FALLBACK_FPS = 45;
/** The fallback looks at the median of live frames over this much live time. */
const FALLBACK_WINDOW_MS = 3000;

/** Motion runs at display rate at High and Medium; Low has no motion at all (null). */
export function motionModeFor(tier: Tier): MotionMode | null {
  return tier === "low" ? null : "display";
}

/** Per page session: once the clock has fallen back, every later clock starts at 30 fps. */
const session = { fellBack: false };
/** Tests only: forget the session fallback. */
export function resetMotionSession(): void {
  session.fellBack = false;
}

/**
 * The engine's motion scheduler, pure (no timers, no rAF): the engine asks it per rendered frame
 * whether motion advances, and after the frame how to wake the next motion frame.
 */
export interface MotionClock {
  readonly mode: MotionMode;
  /** performance.now() of the last motion tick: the layers' (frozen while stopped) clock. */
  readonly at: number;
  /**
   * Once per rendered frame with `live = layer present && running()`. True when this frame is a
   * motion tick (then `at` = nowMs). display: every live frame; 30fps: a (re)start at once, then
   * one per MOTION_FRAME_MS - MOTION_SLACK_MS. Live frame gaps feed the 45 fps fallback monitor.
   */
  frame(nowMs: number, live: boolean): boolean;
  /**
   * After the frame: null = schedule nothing (motion stopped or paused, Review Focus 3);
   * 0 = request the next rAF; > 0 = arm a timer for that many ms, then request a rAF.
   */
  nextWakeMs(nowMs: number, live: boolean): number | null;
  /** A new motion layer: its clock starts now (the frozen `at` while stopped). */
  restart(nowMs: number): void;
  /**
   * External frame-monitor hook: a median fps measured during motion. Below 45 fps (and only while
   * the last frame was live) the clock falls back to 30 fps; true only the one time it switches.
   */
  reportFrameMedian(fps: number): boolean;
  /** Called once when the mode changes (the fallback). Returns an unsubscribe. */
  onModeChange(cb: (m: MotionMode) => void): () => void;
}

export function createMotionClock(opts: { mode?: MotionMode } = {}): MotionClock {
  let mode: MotionMode = session.fellBack ? "30fps" : (opts.mode ?? "display");
  let at = 0;
  let wasLive = false;
  let lastLive: number | null = null;
  let samples: number[] = [];
  let elapsed = 0;
  const listeners = new Set<(m: MotionMode) => void>();

  const fallBack = () => {
    if (mode === "30fps") return false;
    mode = "30fps";
    session.fellBack = true;
    samples = [];
    for (const cb of listeners) cb(mode);
    return true;
  };
  const sample = (dtMs: number) => {
    if (mode !== "display" || !(dtMs > 0)) return;
    const dt = Math.min(dtMs, 1000); // a very slow frame still counts as slow
    samples.push(dt);
    elapsed += dt;
    if (elapsed < FALLBACK_WINDOW_MS) return;
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    samples = [];
    elapsed = 0;
    if (1000 / median < MOTION_FALLBACK_FPS) fallBack();
  };

  return {
    get mode() {
      return mode;
    },
    get at() {
      return at;
    },
    frame(nowMs, live) {
      // Only gaps between consecutive live frames count: an idle spell is not one slow frame.
      if (live && wasLive && lastLive !== null) sample(nowMs - lastLive);
      lastLive = live ? nowMs : null;
      const due =
        live && (mode === "display" || !wasLive || nowMs - at >= MOTION_FRAME_MS - MOTION_SLACK_MS);
      if (due) at = nowMs;
      wasLive = live;
      return due;
    },
    nextWakeMs(nowMs, live) {
      if (!live) return null;
      if (mode === "display") return 0;
      return Math.max(0, at + MOTION_FRAME_MS - MOTION_SLACK_MS - nowMs);
    },
    restart(nowMs) {
      at = nowMs;
    },
    reportFrameMedian(fps) {
      if (!wasLive || !(fps < MOTION_FALLBACK_FPS)) return false;
      return fallBack();
    },
    onModeChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

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
  /** The devsim flow (`motionLayer.ts` MotionFlow); optional so older doubles need not provide it. */
  setFlow?(f: MotionFlow | null): void;
  /** Ambient vehicles on / off (T-031 ambient-traffic switch); optional for older doubles. */
  setVehicles?(on: boolean): void;
  samples?(): FlowSamples;
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
  /**
   * The devsim fast-forward flow (spec §7) for the current and every later agent layer; null
   * restores the mood density and the plain clock.
   */
  setFlow(f: MotionFlow | null): void;
  /**
   * Ambient vehicles (T-031 `sceneStore.ambientTraffic`) for the current and every later agent
   * layer: false fades the decorative cars out while a scenario plays its own; true brings them back.
   */
  setVehicles(on: boolean): void;
  /** The agent layer's last drawn positions (devsim probe), or null without a layer. */
  samples(): FlowSamples | null;
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
  let vehicles = true;
  let weights: MoodMix = { day: 1, dusk: 0, night: 0 };
  let last: number | null = null;
  let flow: MotionFlow | null = null;

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
    tick(nowMs, camera, frustum, pure) {
      const dt = last === null ? 0 : nowMs - last;
      last = nowMs;
      // Stopped frames carry a frozen clock (dt 0): a fade caught mid-way applies at once instead
      // of freezing half-visible (ruling: with motion stopped the fade applies at once).
      if (!opts.running()) {
        if (opacity !== target) show(target);
      } else if (opacity !== target) show(decorativeOpacity(opacity, target, dt));
      if (pure) agents?.tick(nowMs, camera, frustum, true);
      else agents?.tick(nowMs, camera, frustum);
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
        l.setFlow?.(flow);
        l.setVehicles?.(vehicles);
        l.setOpacity(opacity);
        group.add(l.group);
      }
    },
    setFlow(f) {
      flow = f;
      agents?.setFlow?.(f);
    },
    setVehicles(on) {
      vehicles = on;
      agents?.setVehicles?.(on);
    },
    samples: () => agents?.samples?.() ?? null,
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
