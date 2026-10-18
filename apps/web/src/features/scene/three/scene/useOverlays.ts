import { useEffect, useMemo, useState } from "react";
import { useEvacCentres, useGaps, useLayer, useScenarioWater } from "../../../../lib/api";
import { gapsActive } from "../../../gaps/gapModel";
import { type LonLat, pointFeatures } from "../../geo";
import { useScene } from "../../sceneStore";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createOverlayLayer, type OverlayLayer } from "../overlays/accessLayers";
import { useResidents } from "../overlays/useResidents";
import { lineToLocal } from "../routeLine";
import type { LayerData } from "./useGround";

/**
 * The overlay pass: access / gaps / route / what-if lines, flood tint, waste points, place markers
 * and evacuation centres (one layer per engine and frame, owned by the engine), plus the Elmina Day
 * and rollout residents riding the same layer.
 */
export function useOverlays({
  engine,
  frame,
  accessData,
  onScreen,
  running,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  accessData: LayerData | undefined;
  onScreen: boolean;
  running: boolean;
}) {
  const route = useScene((s) => s.route);
  // While a journey plays, its own ribbon (features/journey) draws the trip's route by status; the
  // blue overlay line would sit on top of it (overlay pass), so it steps aside.
  const journeyOn = useScene((s) => !!s.journey);
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const accessVisible = useScene((s) => s.lensVisible.access);
  const gapsOn = useScene((s) => gapsActive(s.gapsVisible, s.profile));
  const whatIf = useScene((s) => s.whatIf);
  const gapsQ = useGaps(profile, gapsOn && accessVisible);
  // Flood tint, waste points, place markers and evacuation centres share the overlay pass.
  const floodLens = useScene((s) => s.lensVisible.flood);
  const wasteLens = useScene((s) => s.lensVisible.waste);
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const floodOn = !!scenarioId && floodLens;
  const waterQ = useScenarioWater(floodOn ? scenarioId : null);
  const floodQ = useLayer("flood", profile, scenarioId, floodOn);
  const wasteQ = useLayer("waste", profile, scenarioId, wasteLens);
  const evacQ = useEvacCentres(floodOn ? scenarioId : null, profile);
  /** Place markers built into the overlay (honest count of the access layer's points). */
  const [markerCount, setMarkerCount] = useState(0);

  const routePositions = useMemo(
    () => (route && frame ? lineToLocal(route.geojson.coordinates as LonLat[], frame) : null),
    [route, frame],
  );
  const routeOn = !!engine && !!routePositions && routePositions.length >= 6;

  // Access / gaps / route / what-if lines: one layer per engine and frame, owned by the engine.
  const [overlay, setOverlay] = useState<OverlayLayer | null>(null);
  useEffect(() => {
    if (!engine || !frame) return;
    const layer = createOverlayLayer(frame);
    engine.setOverlays(layer);
    setOverlay(layer);
    return () => {
      engine.setOverlays(null); // disposes the layer
      setOverlay(null);
    };
  }, [engine, frame]);
  useEffect(() => {
    if (!engine || !overlay) return;
    overlay.update({
      access: accessData ?? null,
      accessVisible,
      gaps: gapsQ.data ?? null,
      gapsOn,
      route: routeOn && !journeyOn ? (route?.geojson ?? null) : null,
      whatIf,
      water: waterQ.data ?? null,
      floodEdges: floodQ.data ?? null,
      floodOn,
      waste: wasteQ.data ?? null,
      wasteOn: wasteLens,
      evac: evacQ.data ?? null,
      focusPlaceId,
    });
    setMarkerCount(accessVisible ? pointFeatures(accessData).length : 0);
    engine.requestRender();
  }, [
    engine,
    overlay,
    accessData,
    accessVisible,
    gapsQ.data,
    gapsOn,
    routeOn,
    journeyOn,
    route,
    whatIf,
    waterQ.data,
    floodQ.data,
    floodOn,
    wasteQ.data,
    wasteLens,
    evacQ.data,
    focusPlaceId,
  ]);
  // Elmina Day and rollout residents ride the same overlay layer.
  useResidents(engine, overlay, frame, { onScreen, clockRunning: running });

  return { routeOn, markerCount };
}
