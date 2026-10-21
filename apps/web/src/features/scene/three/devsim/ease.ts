/** Smoothstep easing and spans shared by the devsim scene (prototype `ease`, `span`, `dayness`). */
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
export const ease = (u: number) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** 0 at night, 1 by day, from the sun elevation (prototype units: > 0 up). */
export const dayness = (e: number) => ease(span(e, -0.08, 0.22));
