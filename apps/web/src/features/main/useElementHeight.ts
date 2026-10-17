import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Rendered height (px) of `ref`'s element, kept current with a ResizeObserver (0 while hidden).
 * `0` until measured or where ResizeObserver is missing. A change of `key` (e.g. the element's
 * hidden state) re-measures in a layout effect, before paint, instead of waiting a frame for the
 * observer.
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>, key?: unknown) {
  const [h, setH] = useState(0);
  // Layout effect: measured before the first paint, so the controls never flash over the strip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` only triggers a re-measure
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const measure = () => setH(Math.ceil(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref, key]);
  return h;
}
