/**
 * Detail bubble (B-T8, spec §4 B3, AC-B9). Inside about 150 m of the focus point the scene draws
 * street-level detail: the street dressing kit, high-detail (LOD0) trees and the crowd's LOD0.
 * Outside it, today's LOD. The focus is the hero in follow mode (while a journey is loaded and her
 * pose is known), else the camera's orbit target.
 *
 * Pure core plus a small registry. The dressing fades in and out at the bubble edge over
 * `BUBBLE_FADE_S` (per instance, by key: `createBubbleFader`), with each frame's step capped so a
 * long frame gap can never make a single-frame pop. Other layers (the crowd renderer, C-T7)
 * register with `bubble.register` and receive the bubble on every change; `bubble.contains` and
 * `bubble.weight` answer membership for any point.
 *
 * Display only: nothing here is read by routing, the journey plan or its events.
 */

export const BUBBLE_RADIUS_M = 150;
/** Fade time at the edge (s). AC-B9: at least 0.5 s. */
export const BUBBLE_FADE_S = 0.5;
/** A frame advances a fade by at most this much time (s): >= FADE / MAX_STEP frames per fade. */
export const BUBBLE_MAX_STEP_S = 0.1;
/** The bubble is re-published when its focus moves at least this far (m). */
export const BUBBLE_MOVE_EPS_M = 1;

export type XZ = readonly [number, number];

export interface BubbleFocusInput {
  /** Journey camera mode (`useJourney().camMode`); only "follow" puts the focus on the hero. */
  camMode: "follow" | "overview" | "free" | null;
  /** A journey is loaded (the hero exists). */
  playing: boolean;
  /** The rendered hero's local x/z (`journeyHero.current`), or null. */
  hero: { x: number; z: number } | null;
  /** The camera's orbit target (local x/z). */
  target: { x: number; z: number };
}

/** The focus point: the hero in follow mode, else the camera target. */
export function bubbleFocus(i: BubbleFocusInput): [number, number] {
  if (
    i.camMode === "follow" &&
    i.playing &&
    i.hero &&
    Number.isFinite(i.hero.x) &&
    Number.isFinite(i.hero.z)
  )
    return [i.hero.x, i.hero.z];
  return [i.target.x, i.target.z];
}

export const inBubble = (focus: XZ | null, x: number, z: number, r = BUBBLE_RADIUS_M): boolean =>
  !!focus && Math.hypot(x - focus[0], z - focus[1]) <= r;

/**
 * Per-key fade weights in [0, 1]: `weight(key, inside, nowMs)` moves the key's weight toward 1
 * (inside) or 0 (outside) at 1 / fadeS per second of elapsed time, each call's step capped at
 * `maxStepS`. A key seen for the first time starts at 0 (fades in). `prune` forgets keys not
 * touched since the last prune (they left the candidate set).
 */
export function createBubbleFader(fadeS = BUBBLE_FADE_S, maxStepS = BUBBLE_MAX_STEP_S) {
  const state = new Map<string, { w: number; t: number; seen: number }>();
  let pass = 0;
  let moving = 0;
  return {
    weight(key: string, inside: boolean, nowMs: number): number {
      const target = inside ? 1 : 0;
      let s = state.get(key);
      if (!s) {
        s = { w: 0, t: nowMs, seen: pass };
        state.set(key, s);
      }
      const dt = Math.min(maxStepS, Math.max(0, (nowMs - s.t) / 1000));
      s.t = nowMs;
      s.seen = pass;
      const step = dt / fadeS;
      s.w = target > s.w ? Math.min(target, s.w + step) : Math.max(target, s.w - step);
      if (s.w !== target) moving++;
      return s.w;
    },
    /** Starts a pass (call before a round of `weight` calls); returns whether the last pass was still fading. */
    begin(): boolean {
      const was = moving > 0;
      moving = 0;
      pass++;
      return was;
    },
    /** True when the last pass left any key between its weight and its target. */
    fading: () => moving > 0,
    prune(): void {
      for (const [k, s] of state) if (s.seen !== pass && s.w === 0) state.delete(k);
    },
    size: () => state.size,
  };
}
export type BubbleFader = ReturnType<typeof createBubbleFader>;

export interface BubbleState {
  focus: [number, number] | null;
  radiusM: number;
}

/** Something that mounts detail inside the bubble (the dressing, the trees, the crowd's LOD0). */
export type BubbleClient = (s: BubbleState) => void;

export interface DetailBubble {
  readonly radiusM: number;
  state(): BubbleState;
  /** Moves the bubble; clients hear about it when the focus moved >= BUBBLE_MOVE_EPS_M or was set / cleared. */
  setFocus(focus: [number, number] | null): void;
  /** Registers a client; it is called at once with the current state. Returns the unregister. */
  register(client: BubbleClient): () => void;
  contains(x: number, z: number): boolean;
}

export function createDetailBubble(radiusM = BUBBLE_RADIUS_M): DetailBubble {
  let focus: [number, number] | null = null;
  const clients = new Set<BubbleClient>();
  const state = (): BubbleState => ({ focus, radiusM });
  return {
    radiusM,
    state,
    setFocus(next) {
      const moved =
        (next === null) !== (focus === null) ||
        (!!next &&
          !!focus &&
          Math.hypot(next[0] - focus[0], next[1] - focus[1]) >= BUBBLE_MOVE_EPS_M);
      if (!moved) return;
      focus = next ? [next[0], next[1]] : null;
      const s = state();
      for (const c of [...clients]) c(s);
    },
    register(client) {
      clients.add(client);
      client(state());
      return () => {
        clients.delete(client);
      };
    },
    contains: (x, z) => inBubble(focus, x, z, radiusM),
  };
}
