import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Rendered height (px) of `ref`'s element, kept current with a ResizeObserver (0 while hidden).
 * `0` until measured or where ResizeObserver is missing.
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>) {
  const [h, setH] = useState(0);
  // Layout effect: measured before the first paint, so the controls never flash over the strip.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const measure = () => setH(Math.ceil(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return h;
}
