import { type RefObject, useEffect, useState } from "react";
import { usePanel } from "../main/panelStore";
import type { CardViewport } from "./cardPlacement";

/** CSS px of an inherited custom property at `el` (e.g. `--panel-w: 360px`); 0 when unset. */
function cssPx(el: Element, name: string): number {
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
}

const same = (a: CardViewport, b: CardViewport) =>
  a.w === b.w &&
  a.h === b.h &&
  a.top === b.top &&
  JSON.stringify(a.avoid ?? []) === JSON.stringify(b.avoid ?? []);

/** The map area event cards may use, measured at `host` (see `CardViewport`). */
export function measureMapArea(host: HTMLElement): CardViewport {
  const r = host.getBoundingClientRect();
  const doc = host.ownerDocument;
  const stack = doc.querySelector('[data-testid="top-stack"]');
  const mini = doc.querySelector('[data-testid="journey-minimap"]');
  const m = mini?.getBoundingClientRect();
  return {
    // The side panel and the phone sheet cover the map: cards stay clear of them.
    w: Math.max(1, Math.round(r.width - cssPx(host, "--panel-w"))),
    h: Math.max(1, Math.round(r.height - cssPx(host, "--sheet-h") - cssPx(host, "--attr-h"))),
    top: stack ? Math.max(0, Math.round(stack.getBoundingClientRect().bottom - r.top)) : 0,
    avoid:
      m && m.width > 0
        ? [
            {
              x: Math.round(m.left - r.left),
              y: Math.round(m.top - r.top),
              w: m.width,
              h: m.height,
            },
          ]
        : [],
  };
}

/**
 * The card area for the map at `hostRef`, kept current with a ResizeObserver on the map, the top
 * stack and the mini-map, and re-measured when the side panel opens or closes (`--panel-w` is a
 * CSS variable, invisible to the observer). Nothing is read during render.
 */
export function useMapInsets(
  hostRef: RefObject<HTMLElement | null> | undefined,
  active: boolean,
  fallback: () => [number, number],
): CardViewport {
  const [vp, setVp] = useState<CardViewport>(() => {
    const [w, h] = fallback();
    return { w, h, top: 0, avoid: [] };
  });
  const panelOpen = usePanel((s) => s.open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: panelOpen re-measures (CSS variable change)
  useEffect(() => {
    const host = hostRef?.current;
    if (!active || !host) return;
    const measure = () => {
      const next = measureMapArea(host);
      setVp((v) => (same(v, next) ? v : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const doc = host.ownerDocument;
    for (const sel of ['[data-testid="top-stack"]', '[data-testid="journey-minimap"]']) {
      const el = doc.querySelector(sel);
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [hostRef, active, panelOpen]);
  return vp;
}
