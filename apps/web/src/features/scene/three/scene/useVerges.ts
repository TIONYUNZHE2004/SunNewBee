import { useEffect, useRef } from "react";
import type { Tier } from "../../cesium/stylised/quality";
import type { Engine } from "../engine";
import { createVergeLayer } from "../ground/vergeLayer";
import type { ActiveTile } from "../stream/streamer";

/** The engine decor slot holding the streamed grass verges (one merged mesh). */
export const VERGE_SLOT = "verges";

const NO_STRIPS: Float32Array[] = [];
const sameStrips = (a: Float32Array[], b: Float32Array[]) =>
  a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * Grass verges of the active tiles (Task 9, decorative): every tile's strips merged into ONE mesh
 * in the verges ground band (with land cover, parks, water, roads and markings: at most 6 ground
 * draws). Rebuilt only when the set of strip arrays changes, so it follows the streamer's merge
 * coalescing and a re-published active list with the same plans keeps the mesh. Low draws none
 * (stale content included); beyond 1500 m `farView` carries no verges. The verge shrubs ride the
 * kit buckets (`unionKits`).
 */
export function useVerges({
  engine,
  active,
  tier,
}: {
  engine: Engine | null;
  active: ActiveTile[];
  tier: Tier;
}) {
  const stripsRef = useRef<Float32Array[]>(NO_STRIPS);
  const next: Float32Array[] = [];
  if (tier !== "low")
    for (const a of active) {
      const s = a.content.verges?.strips;
      if (s && s.length > 0) next.push(s);
    }
  if (!sameStrips(next, stripsRef.current)) stripsRef.current = next.length ? next : NO_STRIPS;
  const strips = stripsRef.current;
  const vergesOn = strips.length > 0;

  useEffect(() => {
    if (!engine) return;
    // setDecor disposes the replaced layer and requests a render.
    engine.setDecor(VERGE_SLOT, createVergeLayer(strips, engine.motion.uTime));
    return () => engine.setDecor(VERGE_SLOT, null);
  }, [engine, strips]);

  return { vergesOn };
}
