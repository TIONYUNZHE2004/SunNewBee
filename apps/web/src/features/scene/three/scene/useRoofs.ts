import { useEffect, useRef, useState } from "react";
import type { Tier } from "../../cesium/stylised/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { createRoofLayer, type TileRoofs } from "../facade/roofLayer";
import { type ActiveTile, measure } from "../stream/streamer";
import { whenIdle } from "./idle";
import { ASSET_WARN } from "./useCityAssets";

/** The engine decor slot that holds the roof layer (rooftop units, skylights, bands, podium deck). */
export const ROOF_SLOT = "roofs";
/** User Timing name of one roof layer build (idle callback, after a ring 0-1 change). */
export const ROOF_MEASURE = "tl:stream-roofs";

/** The roof plans of the ring 0-1 tiles whose plan carries roofs (non-empty plans only). */
export function nearRoofs(active: ActiveTile[]): TileRoofs[] {
  const out: TileRoofs[] = [];
  for (const a of active) {
    const r = a.ring <= 1 ? a.content.roofs : undefined;
    if (r && r.items.length + r.decks.length > 0) out.push(r);
  }
  return out;
}

const samePlans = (a: TileRoofs[], b: TileRoofs[]) =>
  a.length === b.length && a.every((p, i) => p === b[i]);

/**
 * Dressed roofs (decorative, Task 8), streamed per tile like the facades: one roof layer for the
 * large roofs (and the Kanopi podium deck) in the tiles at ring <= 1 of the camera target. It is
 * rebuilt only when that set of tile plans changes, in an idle callback, so it follows the
 * streamer's merge coalescing (`active` is published at most every MERGE_INTERVAL_MS while
 * filling). The old layer stays until the new one replaces it. Never casts shadows; Low draws none.
 */
export function useRoofs({
  engine,
  active,
  tier,
  roleUniforms,
}: {
  engine: Engine | null;
  active: ActiveTile[];
  tier: Tier;
  roleUniforms: RoleUniforms;
}) {
  const plansRef = useRef<TileRoofs[]>([]);
  const next = tier === "low" ? [] : nearRoofs(active);
  if (!samePlans(next, plansRef.current)) plansRef.current = next;
  const plans = plansRef.current;
  const [roofsOn, setRoofsOn] = useState(false);

  useEffect(() => {
    if (!engine) return;
    if (plans.length === 0) {
      engine.setDecor(ROOF_SLOT, null);
      setRoofsOn(false);
      return;
    }
    return whenIdle(() => {
      let layer: ReturnType<typeof createRoofLayer>;
      const t0 = performance.now();
      try {
        layer = createRoofLayer(
          plans.flatMap((p) => p.items),
          roleUniforms,
          tier,
          plans.flatMap((p) => p.decks),
        );
        measure(ROOF_MEASURE, t0);
      } catch (err) {
        // Decorative only: the plain roofs stay drawn without it.
        console.warn(`${ASSET_WARN}: roofs: ${String(err)}`);
        engine.setDecor(ROOF_SLOT, null);
        setRoofsOn(false);
        return;
      }
      engine.setDecor(ROOF_SLOT, layer);
      setRoofsOn(layer.group.children.length > 0);
    });
  }, [engine, plans, tier, roleUniforms]);
  // An engine switch or unmount clears the slot.
  useEffect(() => {
    if (!engine) return;
    return () => {
      engine.setDecor(ROOF_SLOT, null);
      setRoofsOn(false);
    };
  }, [engine]);

  return { roofsOn };
}
