/**
 * Proportional wheel zoom for the Three.js map (AC-A7): the range changes by a fixed share per
 * wheel notch (exponential), never by more than MAX_NOTCH_CHANGE, and the change is spread over
 * several frames. Pure functions plus a small wheel adapter; the engine owns the camera.
 */

/** Largest share of the range one notch may change (zoom in: range x 0.8). */
export const MAX_NOTCH_CHANGE = 0.2;
/** Range multiplier for one full notch zooming in. */
export const NOTCH_FACTOR = 1 - MAX_NOTCH_CHANGE;
/** A wheel notch in deltaY units (pixel mode). */
export const NOTCH_DELTA = 100;
/** Frames one wheel event is spread over (>= 4 for AC-A7). */
export const SMOOTH_FRAMES = 6;

/** Normalises deltaY to pixel units: 3 lines or one page is about one notch. */
export function normaliseDelta(deltaY: number, deltaMode = 0): number {
  if (deltaMode === 1) return deltaY * (NOTCH_DELTA / 3);
  if (deltaMode === 2) return deltaY * NOTCH_DELTA;
  return deltaY;
}

/**
 * The range after a wheel event of `deltaY` (pixel units; negative zooms in). Step proportional
 * to the current range; a single event moves at most one notch (20%), so a fast flick or a huge
 * trackpad delta cannot jump; small trackpad deltas move proportionally less. Clamped to
 * [minM, maxM].
 */
export function zoomStep(range: number, deltaY: number, minM = 30, maxM = 9000): number {
  const notches = Math.min(1, Math.abs(deltaY) / NOTCH_DELTA);
  // Zoom out is the exact inverse of zoom in, so in-then-out returns to the start.
  const f = NOTCH_FACTOR ** notches;
  const next = deltaY < 0 ? range * f : deltaY > 0 ? range / f : range;
  return Math.min(maxM, Math.max(minM, next));
}

/**
 * Spreads multiplicative range changes over frames. `push(factor)` queues a change; each `tick()`
 * returns the factor to apply this frame (1 when idle). Queued changes compose, so quick notches
 * accumulate instead of cancelling each other. `frames` 1 applies at once (reduced motion).
 */
export interface ZoomTween {
  push(factor: number, frames?: number): void;
  tick(): number;
  readonly active: boolean;
  /** Product of all factors still to be applied. */
  readonly pending: number;
}

export function createZoomTween(defaultFrames = SMOOTH_FRAMES): ZoomTween {
  let queue: { perFrame: number; left: number }[] = [];
  return {
    push(factor, frames = defaultFrames) {
      if (!(factor > 0) || factor === 1) return;
      const n = Math.max(1, Math.round(frames));
      queue.push({ perFrame: Math.log(factor) / n, left: n });
    },
    tick() {
      let ln = 0;
      for (const e of queue) {
        ln += e.perFrame;
        e.left -= 1;
      }
      queue = queue.filter((e) => e.left > 0);
      return Math.exp(ln);
    },
    get active() {
      return queue.length > 0;
    },
    get pending() {
      return Math.exp(queue.reduce((s, e) => s + e.perFrame * e.left, 0));
    },
  };
}

const own = new WeakSet<Event>();

/**
 * Hands a range change to OrbitControls (zoom to cursor, clamping) as a synthetic wheel event
 * that `attachWheelZoom` ignores. `zoomSpeed` must be 1: its scale is 0.95^(|deltaY| / 100).
 */
export function dispatchOwnWheel(
  canvas: EventTarget,
  factor: number,
  clientX: number,
  clientY: number,
): void {
  const deltaY = (100 * Math.log(factor)) / Math.log(0.95);
  // factor < 1 zooms in (negative deltaY); the logs carry the sign the other way, so flip it.
  const e = new WheelEvent("wheel", {
    deltaY: -deltaY,
    deltaMode: 0,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });
  own.add(e);
  canvas.dispatchEvent(e);
}

export interface WheelZoomDeps {
  canvas: HTMLElement;
  /** Current camera range (m). */
  range(): number;
  /** Applies `factor` to the range, zooming towards the screen point. */
  apply(factor: number, clientX: number, clientY: number): void;
  reducedMotion(): boolean;
  minM?: number;
  maxM?: number;
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
}

/** Wires wheel events on `canvas` to the tween; returns a disposer. */
export function attachWheelZoom(d: WheelZoomDeps): () => void {
  const raf = d.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancel = d.cancelRaf ?? ((id) => cancelAnimationFrame(id));
  const tween = createZoomTween();
  let frame = 0;
  let at = { x: 0, y: 0 };
  const pump = () => {
    frame = 0;
    const f = tween.tick();
    if (f !== 1) d.apply(f, at.x, at.y);
    if (tween.active) frame = raf(pump);
  };
  const onWheel = (e: WheelEvent) => {
    if (own.has(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = normaliseDelta(e.deltaY, e.deltaMode);
    if (!dy) return;
    at = { x: e.clientX, y: e.clientY };
    const reduced = d.reducedMotion();
    const target = d.range() * tween.pending;
    const next = zoomStep(target, dy, d.minM, d.maxM);
    tween.push(next / target, reduced ? 1 : SMOOTH_FRAMES);
    if (reduced) {
      pump();
      return;
    }
    if (!frame) frame = raf(pump);
  };
  d.canvas.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => {
    d.canvas.removeEventListener("wheel", onWheel, { capture: true });
    if (frame) cancel(frame);
  };
}
