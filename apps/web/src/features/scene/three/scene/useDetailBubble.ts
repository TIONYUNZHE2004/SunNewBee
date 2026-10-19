import { useEffect } from "react";
import { journeyHero, useJourney } from "../../../journey/journeyStore";
import { bubbleFocus } from "../detailBubble";
import type { Engine } from "../engine";
import type { SceneBus } from "./sceneBus";

/** Beyond this camera range street-level detail is too small to see: the bubble is cleared. */
export const BUBBLE_MAX_RANGE_M = 1500;

/**
 * Drives the view's detail bubble (B-T8, `bus.getState().bubble`) on the engine's LOD ticks: its
 * focus is the rendered hero in follow mode (`journeyHero`, D-T6 seam) while a journey is loaded,
 * else the orbit target; cleared beyond `BUBBLE_MAX_RANGE_M`. Trees inside it are drawn at LOD0
 * (`setDetailBubble` on the city instances). The dressing and the crowd register on the bubble.
 */
export function useDetailBubble({
  engine,
  bus,
  setDetailBubble,
  showroom = false,
}: {
  engine: Engine | null;
  bus: SceneBus;
  setDetailBubble?: (b: { x: number; z: number; r: number } | null) => void;
  showroom?: boolean;
}): void {
  useEffect(() => {
    if (!engine || showroom) return;
    const bubble = bus.getState().bubble;
    const off = engine.onLodTick((t) => {
      const j = useJourney.getState();
      bubble.setFocus(
        t.rangeM > BUBBLE_MAX_RANGE_M
          ? null
          : bubbleFocus({
              camMode: j.camMode,
              playing: !!j.plan,
              hero: journeyHero.current,
              target: t.target,
            }),
      );
      return false;
    });
    engine.requestLodTick();
    return () => {
      off();
      bubble.setFocus(null);
    };
  }, [engine, bus, showroom]);

  useEffect(() => {
    if (!setDetailBubble) return;
    const bubble = bus.getState().bubble;
    const off = bubble.register((s) =>
      setDetailBubble(s.focus ? { x: s.focus[0], z: s.focus[1], r: s.radiusM } : null),
    );
    return () => {
      off();
      setDetailBubble(null);
    };
  }, [bus, setDetailBubble]);
}
