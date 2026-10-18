import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BuildingsLayer, useLayer } from "../../../../lib/api";
import type { Tier } from "../../cesium/stylised/quality";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createGroundLayer } from "../ground/groundLayer";
import { landcoverMesh } from "../ground/landcover";
import type { Ribbon } from "../ground/ribbons";
import type { ActiveTile } from "../stream/streamer";

const EMPTY_FC = { type: "FeatureCollection", features: [] };
/** A `/layers/{lens}` payload (the access layer: walk LineStrings and place points). */
export type LayerData = ReturnType<typeof useLayer>["data"];

/** The engine decor slot holding the streamed road surfaces and markings. */
export const ROADS_SLOT = "roads";

/**
 * The ground: land cover over the whole township (display only), plus the gate the other details
 * wait on (`detailsOn`, the city's first frame) and the latched walk LineStrings they are planned
 * from. Road ribbons are streamed per tile (`useRoads`).
 */
export function useGround({
  engine,
  frame,
  buildingsQ,
  accessData,
  tier,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  buildingsQ: { data?: BuildingsLayer | null; isError: boolean; isSuccess: boolean };
  accessData: LayerData | undefined;
  tier: Tier;
}) {
  const buildings = buildingsQ.data;
  // Roads are built only after the first frame with the buildings (or at once when the world has
  // none), so their build never delays the city's first frame. The ribbons need only the walk
  // LineStrings and their `type`, which do not depend on profile or scenario: reuse this query's
  // data (latched once, so a profile switch does not rebuild the ground) instead of a second
  // fetch of the ~5 MB layer under the default key.
  const [cityShown, setCityShown] = useState(false);
  const detailsOn = cityShown || buildingsQ.isError || (buildingsQ.isSuccess && !buildings);
  const walkRef = useRef<LayerData | undefined>(undefined);
  if (!walkRef.current && accessData) walkRef.current = accessData;
  const walk = walkRef.current;

  // First frame after the city is set: the ground details may now load.
  useEffect(() => {
    if (!engine || !buildings || cityShown) return;
    const off = engine.onFrame(() => {
      off();
      setCityShown(true);
    });
    return off;
  }, [engine, buildings, cityShown]);

  // Land cover covers the whole township (display only).
  const landcover = useMemo(
    () =>
      frame
        ? landcoverMesh(
            (buildings?.landcover ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection,
            frame,
          )
        : null,
    [frame, buildings],
  );
  useEffect(() => {
    if (!engine || !landcover) return;
    // The layer owns (and disposes) its land-cover geometry, so each layer gets a clone. Built once
    // per land cover and tier: streamed roads never rebuild it.
    engine.setGround(createGroundLayer([], landcover.clone(), tier, engine.motion.uTime));
    return () => engine.setGround(null);
  }, [engine, landcover, tier]);
  useEffect(() => () => landcover?.dispose(), [landcover]);

  return { detailsOn, walk, landcover };
}

/**
 * Road surfaces and (above Low) markings of the active tiles, merged into one road layer of at most
 * two draws in the `roads` decor slot (with the land cover: at most 3 ground draws). The markings
 * mesh also carries the parking-stall lines (Task 10, folded in by ruling P4-X: six ground draws in
 * all). Rebuilt only when the active set changes. Display only: a road's look says nothing about
 * access; stall lines are decorative.
 */
export function useRoads({
  engine,
  active,
  tier,
}: {
  engine: Engine | null;
  active: ActiveTile[];
  tier: Tier;
}) {
  const roads = useMemo<Ribbon[]>(() => active.flatMap((a) => a.content.ribbons), [active]);
  const stalls = useMemo<Float32Array[]>(
    () =>
      tier === "low"
        ? []
        : active.flatMap((a) => {
            const s = a.content.parking?.stalls;
            return s && s.length > 0 ? [s] : [];
          }),
    [active, tier],
  );
  useEffect(() => {
    if (!engine || roads.length + stalls.length === 0) return;
    engine.setDecor(
      ROADS_SLOT,
      createGroundLayer(roads, new THREE.BufferGeometry(), tier, undefined, stalls),
    );
    return () => engine.setDecor(ROADS_SLOT, null);
  }, [engine, roads, stalls, tier]);
  return { roads };
}
