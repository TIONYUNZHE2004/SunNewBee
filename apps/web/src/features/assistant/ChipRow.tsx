import { type ReactNode, useEffect, useRef, useState } from "react";
import { edgeFades, fadeMask, wheelScrollLeft } from "./chipRowScroll";

/**
 * A horizontal row of chips with its scrollbar hidden. It still scrolls by touch, trackpad and
 * keyboard focus. A vertical mouse wheel scrolls it sideways while it can still move that way, so
 * at either end the panel keeps scrolling; zoom (Ctrl/Meta, pinch) and Shift wheels pass through.
 * The ends fade only while chips are hidden past them; scroll-px-6 keeps a focused chip clear of
 * the 1.5rem fade.
 */
export function ChipRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setFades((f) => {
        const n = edgeFades(el);
        return n.start === f.start && n.end === f.end ? f : n;
      });
    // Not React's onWheel: React registers wheel listeners as passive, so preventDefault is ignored.
    const onWheel = (e: WheelEvent) => {
      const next = wheelScrollLeft(el, e.deltaX, e.deltaY, e.deltaMode, e);
      if (next === null) return;
      e.preventDefault();
      el.scrollLeft = next;
      update();
    };
    update();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  const mask = fadeMask(fades);
  return (
    <div
      ref={ref}
      className={`no-scrollbar -mx-1 mb-2 flex gap-2 overflow-x-auto scroll-px-6 px-1 pt-1 pb-1 ${className}`}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {children}
    </div>
  );
}
