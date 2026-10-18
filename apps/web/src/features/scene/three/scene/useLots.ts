import { useEffect, useMemo, useRef } from "react";
import type { Tier } from "../../cesium/stylised/quality";
import type { Engine } from "../engine";
import { createLotLayer, type LotParts } from "../ground/lotLayer";
import type { Site } from "../props/construction";
import type { ActiveTile } from "../stream/streamer";

/** The engine decor slot holding the streamed stall markings and construction ground. */
export const LOTS_SLOT = "lots";

/** The active tiles' stall lists, track lists and (deduplicated) gravel sites; null at Low. */
export function lotPartsOf(active: ActiveTile[], tier: Tier): LotParts | null {
  if (tier === "low") return null;
  const stalls: Float32Array[] = [];
  const tracks: Float32Array[] = [];
  const gravel = new Map<string, Site>();
  for (const a of active) {
    const c = a.content;
    if (c.parking && c.parking.stalls.length > 0) stalls.push(c.parking.stalls);
    if (c.tracks && c.tracks.length > 0) tracks.push(c.tracks);
    for (const s of c.gravel ?? []) if (!gravel.has(s.id)) gravel.set(s.id, s);
  }
  if (stalls.length + tracks.length + gravel.size === 0) return null;
  return { stalls, tracks, gravel: [...gravel.values()] };
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameParts = (a: LotParts | null, b: LotParts | null) =>
  a === b ||
  (!!a &&
    !!b &&
    sameList(a.stalls, b.stalls) &&
    sameList(a.tracks, b.tracks) &&
    sameList(a.gravel, b.gravel));

/**
 * Task 10: stall markings and construction ground (gravel tint, earth tracks) of the active tiles,
 * merged into one decorative layer of at most two draws in the `lots` decor slot. Rebuilt only when
 * the set of planned lists changes (a merge that leaves them alone keeps the layer). Parked cars
 * and construction props are kits (useDecor's union), never this layer. Low draws none of it; the
 * streamer's far view (beyond 1500 m) carries none.
 */
export function useLots({
  engine,
  active,
  tier,
}: {
  engine: Engine | null;
  active: ActiveTile[];
  tier: Tier;
}) {
  const fresh = useMemo(() => lotPartsOf(active, tier), [active, tier]);
  const kept = useRef<LotParts | null>(null);
  if (!sameParts(kept.current, fresh)) kept.current = fresh;
  const parts = kept.current;
  useEffect(() => {
    if (!engine || !parts) return;
    engine.setDecor(LOTS_SLOT, createLotLayer(parts));
    return () => engine.setDecor(LOTS_SLOT, null);
  }, [engine, parts]);
  return { lotsOn: !!engine && !!parts };
}
