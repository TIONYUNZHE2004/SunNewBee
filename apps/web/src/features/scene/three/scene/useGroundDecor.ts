import { useEffect, useMemo, useRef } from "react";
import type { Tier } from "../../shared/quality";
import type { Engine } from "../engine";
import { createGroundDecorLayer, type GroundDecorParts } from "../ground/groundDecor";
import type { Site } from "../props/construction";
import { type ActiveTile, timed, UNION_MEASURE } from "../stream/streamer";
import { mergeQueueOf } from "./idle";

/** The engine decor slot holding the streamed ground decor (verges + construction ground, one mesh). */
export const GROUND_DECOR_SLOT = "ground-decor";

interface Parts extends GroundDecorParts {
  strips: Float32Array[];
  tracks: Float32Array[];
  gravel: Site[];
}

/** The active tiles' verge strips, track lists and (deduplicated) gravel sites; null at Low or when empty. */
export function groundDecorPartsOf(active: ActiveTile[], tier: Tier): Parts | null {
  if (tier === "low") return null;
  const strips: Float32Array[] = [];
  const skirts: Float32Array[] = [];
  const tracks: Float32Array[] = [];
  const gravel = new Map<string, Site>();
  for (const a of active) {
    const c = a.content;
    const s = c.verges?.strips;
    if (s && s.length > 0) strips.push(s);
    const k = c.verges?.skirts;
    if (k && k.length > 0) skirts.push(k);
    if (c.tracks && c.tracks.length > 0) tracks.push(c.tracks);
    for (const g of c.gravel ?? []) if (!gravel.has(g.id)) gravel.set(g.id, g);
  }
  if (strips.length + tracks.length + gravel.size === 0) return null;
  return { strips, skirts, tracks, gravel: [...gravel.values()] };
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameParts = (a: Parts | null, b: Parts | null) =>
  a === b ||
  (!!a &&
    !!b &&
    sameList(a.strips, b.strips) &&
    sameList(a.skirts ?? [], b.skirts ?? []) &&
    sameList(a.tracks, b.tracks) &&
    sameList(a.gravel, b.gravel));

/**
 * Ground decor of the active tiles (decorative): grass verges (Task 9) and construction ground
 * (gravel tint and earth tracks, Task 10) merged into ONE mesh in the `decor` ground band (with
 * land cover, parks, water, roads and markings: 6 ground draws, ruling P4-X). Rebuilt only when the
 * set of planned lists changes (by identity), so it follows the streamer's merge coalescing and a
 * re-published active list with the same plans keeps the mesh. Low draws none (stale content
 * included); beyond 1500 m `farView` carries none. Verge shrubs, parked cars and construction props
 * are kits (`unionKits`), never this layer; stall lines ride the road markings (`useRoads`).
 */
export function useGroundDecor({
  engine,
  active,
  tier,
}: {
  engine: Engine | null;
  active: ActiveTile[];
  tier: Tier;
}) {
  const fresh = useMemo(
    () => timed(UNION_MEASURE, () => groundDecorPartsOf(active, tier)),
    [active, tier],
  );
  const kept = useRef<Parts | null>(null);
  if (!sameParts(kept.current, fresh)) kept.current = fresh;
  const parts = kept.current;

  useEffect(() => {
    if (!engine) return;
    if (!parts) {
      engine.setDecor(GROUND_DECOR_SLOT, null);
      return;
    }
    // setDecor disposes the replaced layer and requests a render; sliced once merges are slow.
    return mergeQueueOf(engine).run(GROUND_DECOR_SLOT, () =>
      engine.setDecor(
        GROUND_DECOR_SLOT,
        timed("tl:stream-ground-decor", () => createGroundDecorLayer(parts, engine.motion.uTime)),
      ),
    );
  }, [engine, parts]);
  useEffect(() => {
    if (!engine) return;
    return () => engine.setDecor(GROUND_DECOR_SLOT, null);
  }, [engine]);

  return { decorOn: !!engine && !!parts };
}
