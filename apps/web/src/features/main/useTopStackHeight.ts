import { type RefObject, useEffect, useState } from "react";

/**
 * Distance in px from the top of `root` to the bottom of the map's TopStack (route tag, flood
 * banner, hint), kept current with a ResizeObserver. The phone sheet's `full` height keeps this
 * much map clear. `null` until measured (CSS falls back to 6rem).
 */
export function useTopStackHeight(root: RefObject<HTMLElement | null>) {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const el = root.current;
    const stack = el?.querySelector<HTMLElement>('[data-testid="top-stack"]');
    if (!el || !stack || typeof ResizeObserver !== "function") return;
    const measure = () =>
      setH(
        Math.max(
          0,
          Math.round(stack.getBoundingClientRect().bottom - el.getBoundingClientRect().top),
        ),
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stack);
    ro.observe(el);
    return () => ro.disconnect();
  }, [root]);
  return h;
}
