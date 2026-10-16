import { lerpPalette, type Palette } from "./palette";

/** Day <-> Dusk fades over 3 s so the lamps visibly come on; every other change takes 2 s. */
export function fadeMs(from: string, to: string): number {
  return (from === "day" && to === "dusk") || (from === "dusk" && to === "day") ? 3000 : 2000;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Fade between two palettes over `ms` (default 2 s), calling `apply(palette, t)` every frame with
 * t in [0, 1]; the last call is exactly `(to, 1)`. Returns a cancel function (no further frames).
 * Reduced motion applies the target once.
 */
export function startCrossfade(
  from: Palette,
  to: Palette,
  apply: (p: Palette, t: number) => void,
  {
    ms = 2000,
    now = () => performance.now(),
    raf = (cb: () => void) => requestAnimationFrame(cb),
    caf = (id: number) => cancelAnimationFrame(id),
    reduced = false,
  }: {
    ms?: number;
    now?: () => number;
    raf?: (cb: () => void) => number;
    caf?: (id: number) => void;
    reduced?: boolean;
  } = {},
): () => void {
  if (reduced || ms <= 0) {
    apply(to, 1);
    return () => {};
  }
  const t0 = now();
  let id = 0;
  let live = true;
  const frame = () => {
    if (!live) return;
    const t = Math.min(1, (now() - t0) / ms);
    apply(t >= 1 ? to : lerpPalette(from, to, ease(t)), t);
    if (t < 1) id = raf(frame);
  };
  apply(from, 0);
  id = raf(frame);
  return () => {
    live = false;
    caf(id);
  };
}
