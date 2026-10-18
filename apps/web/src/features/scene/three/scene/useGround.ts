import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildingsLayer, useLayer } from "../../../../lib/api";
import type { Tier } from "../../cesium/stylised/quality";
import { HERO_CENTRE, HERO_RADIUS_M } from "../bookmarks";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createGroundLayer } from "../ground/groundLayer";
import { landcoverMesh } from "../ground/landcover";
import { ribbonsFromWalk } from "../ground/ribbons";

const EMPTY_FC = { type: "FeatureCollection", features: [] };
/** A `/layers/{lens}` payload (the access layer: walk LineStrings and place points). */
export type LayerData = ReturnType<typeof useLayer>["data"];

/**
 * The ground: land cover over the whole township and road ribbons clipped to the hero radius
 * (display only), plus the gate the other details wait on (`detailsOn`, the city's first frame)
 * and the latched walk LineStrings they are planned from.
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

  // Land cover covers the whole township; roads are clipped to the hero radius (display only).
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
  const roads = useMemo(
    () =>
      frame && detailsOn && walk
        ? ribbonsFromWalk(walk as unknown as GeoJSON.FeatureCollection, frame, {
            clipCentre: HERO_CENTRE,
            clipRadiusM: HERO_RADIUS_M,
          })
        : [],
    [frame, detailsOn, walk],
  );
  useEffect(() => {
    if (!engine || !landcover) return;
    // The layer owns (and disposes) its land-cover geometry, so each layer gets a clone.
    engine.setGround(createGroundLayer(roads, landcover.clone(), tier, engine.motion.uTime));
    return () => engine.setGround(null);
  }, [engine, landcover, roads, tier]);
  useEffect(() => () => landcover?.dispose(), [landcover]);

  return { detailsOn, walk, roads, landcover };
}
