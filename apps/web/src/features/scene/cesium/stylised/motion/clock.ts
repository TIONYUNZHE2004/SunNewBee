export const motionActive = (s: {
  enabled: boolean;
  visible: boolean;
  onScreen: boolean;
  reduced: boolean;
}) => s.enabled && s.visible && s.onScreen && !s.reduced;

/**
 * One loop for all decorative motion. The viewer keeps requestRenderMode; this asks for at most
 * `fps` renders a second while active and nothing otherwise.
 */
export function createMotionClock({
  fps = 30,
  requestRender,
  onTick,
  now = () => performance.now(),
  raf = (cb: () => void) => requestAnimationFrame(cb),
  caf = (id: number) => cancelAnimationFrame(id),
}: {
  fps?: number;
  requestRender: () => void;
  onTick: (seconds: number) => void;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
}) {
  const t0 = now();
  const minDt = 1000 / fps - 0.5;
  let last = -Infinity;
  let id = 0;
  let active = false;
  const frame = () => {
    if (!active) return;
    const t = now();
    if (t - last >= minDt) {
      last = t;
      onTick((t - t0) / 1000);
      requestRender();
    }
    id = raf(frame);
  };
  return {
    setActive(a: boolean) {
      if (a === active) return;
      active = a;
      if (a) id = raf(frame);
      else caf(id);
    },
    time: () => (now() - t0) / 1000,
    destroy() {
      active = false;
      caf(id);
    },
  };
}
