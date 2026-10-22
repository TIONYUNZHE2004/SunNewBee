import { useEffect, useMemo, useState } from "react";
import {
  useEvacCentres,
  useFloodImpact,
  useGaps,
  useLayer,
  useRoadLabels,
  useScenarioWater,
} from "../../../../lib/api";
import { closureFeatures } from "../../../closures/closureSimModel";
import { useMarathonPlay } from "../../../closures/marathonPlayStore";
import { useDevsim } from "../../../devsim/devsimStore";
import { floodWaterFrame, useFloodStory } from "../../../flood/floodStoryStore";
import { floodStateAt } from "../../../flood/floodTimeline";
import { impactSummary } from "../../../flood/impactModel";
import { gapsActive } from "../../../gaps/gapModel";
import { useCompare } from "../../../journey/compareStore";
import { isPlayableCompare } from "../../../journey/compareTypes";
import { useJourney } from "../../../journey/journeyStore";
import { type LonLat, pointFeatures } from "../../geo";
import { parseLayer } from "../../list/listModel";
import { useSceneSettings } from "../../sceneSettingsStore";
import { useScene } from "../../sceneStore";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import type { Boundary } from "../ground/boundary";
import { createOverlayLayer, type OverlayLayer } from "../overlays/accessLayers";
import { createMarathonRunners } from "../overlays/marathonRunners";
import { createRoadLabels } from "../overlays/roadLabels";
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
  boundary = null,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  accessData: LayerData | undefined;
  onScreen: boolean;
  running: boolean;
  /** The Elmina outline: place markers outside it are hidden (display only). */
  boundary?: Boundary | null;
}) {
  const route = useScene((s) => s.route);
  // While a journey plays, its own ribbon (features/journey) draws the trip's route by status; the
  // blue overlay line would sit on top of it (overlay pass), so it steps aside.
  const journeyOn = useJourney((s) => !!s.plan);
  // The same while the compare playback plays (V2 fix N-a): its own ribbons draw both routes in the
  // compare colours, in both halves; the answer's route line would cover them.
  const compareOn = useCompare((s) => isPlayableCompare(s.payload));
  // A Development Simulation runs its own camera beats: the place markers stay off its stage.
  const devsimOn = useDevsim((s) => s.status !== "idle");
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const accessVisible = useScene((s) => s.lensVisible.access);
  const pathStatus = useSceneSettings((s) => s.pathStatus);
  const waterMotion = useSceneSettings((s) => s.motion);
  const gapsOn = useScene((s) => gapsActive(s.gapsVisible, s.profile));
  const whatIf = useScene((s) => s.whatIf);
  const closureResult = useScene((s) => s.closureSim);
  const roadNames = useSceneSettings((s) => s.roadNames);
  const roadLabels = useRoadLabels(roadNames);
  // the closure answer's course and detours, drawn on the access layer's own edge geometry
  const closureSim = useMemo(
    () =>
      closureResult && accessData
        ? { geojson: closureFeatures(closureResult.result, parseLayer(accessData).edges) }
        : null,
    [closureResult, accessData],
  );
  const gapsQ = useGaps(profile, gapsOn && accessVisible);
  // Flood tint, waste points, place markers and evacuation centres share the overlay pass.
  const floodLens = useScene((s) => s.lensVisible.flood);
  const wasteLens = useScene((s) => s.lensVisible.waste);
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const selectedPlaceId = useScene((s) => s.selectedPlaceId);
  const vrs = useJourney((s) => s.vrs);
  const journeyLine = useJourney((s) => s.plan?.polyline ?? null);
  const journeyEvents = useJourney((s) => s.plan?.events ?? null);
  // Never hide what the user is being shown (A-T5 fix round 2): the selected place, places a
  // verification request targets (the focused place is added by the layer), and the ends of the
  // current route and journey.
  // While a trip is loaded only these are drawn (gate §9.1 F5), so its event places are kept too.
  const keepPlaceIds = useMemo(
    () => [
      ...(selectedPlaceId ? [selectedPlaceId] : []),
      ...vrs.map((v) => v.element_id),
      ...(journeyEvents ?? []).flatMap((e) => (e.element_id ? [e.element_id] : [])),
    ],
    [selectedPlaceId, vrs, journeyEvents],
  );
  const keepNear = useMemo(() => {
    const ends: number[][] = [];
    const line = (route?.geojson.coordinates ?? []) as number[][];
    for (const l of [line, (journeyLine ?? []) as number[][]])
      if (l.length) ends.push(l[0] as number[], l[l.length - 1] as number[]);
    return ends;
  }, [route, journeyLine]);
  const floodStory = useFloodStory((s) => s.story);
  const storyStage = useFloodStory((s) => (s.timeline ? floodStateAt(s.t, s.timeline).stage : 0));
  const stageData = floodStory?.stages[storyStage];
  const floodOn = !!floodStory || (!!scenarioId && floodLens);
  const waterQ = useScenarioWater(floodOn && !floodStory ? scenarioId : null);
  const floodQ = useLayer("flood", profile, scenarioId, floodOn && !floodStory);
  const wasteQ = useLayer("waste", profile, scenarioId, wasteLens);
  const evacQ = useEvacCentres(floodOn && !floodStory ? scenarioId : null, profile);
  const impactQ = useFloodImpact(floodOn && !floodStory ? scenarioId : null);
  const waterData = stageData?.water ?? waterQ.data;
  const impact = useMemo(
    () => impactSummary(stageData?.affected ?? impactQ.data)?.markers ?? null,
    [stageData, impactQ.data],
  );
  /**
   * Place markers drawn (`data-markers`): the access layer's points minus those hidden off the slab
   * (A-T5); without an outline, every point.
   */
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
  // Road names (T-028): their own label child; the roads an answer closes or a course uses are
  // always shown, highlighted
  const highlightKey = (closureResult?.roads ?? []).join("|");
  useEffect(() => {
    if (!engine || !overlay || !frame || !roadNames || !roadLabels.data?.length) return;
    const child = createRoadLabels(
      roadLabels.data,
      frame,
      new Set(highlightKey ? highlightKey.split("|") : []),
    );
    const detach = overlay.attach(child);
    engine.requestRender();
    return detach;
  }, [engine, overlay, frame, roadNames, roadLabels.data, highlightKey]);
  // "Watch the marathon" (T-028): runners and sample cars ride the overlay pass while it plays
  const marathon = useMarathonPlay((s) => s.result);
  useEffect(() => {
    if (!engine || !overlay || !frame || !marathon) return;
    const detach = overlay.attach(
      createMarathonRunners(marathon, frame, () => useMarathonPlay.getState().t),
    );
    // a frame per playback tick (the engine renders on request)
    const unsub = useMarathonPlay.subscribe(() => engine.requestRender());
    engine.requestRender();
    return () => {
      unsub();
      detach();
      engine.requestRender();
    };
  }, [engine, overlay, frame, marathon]);
  useEffect(() => {
    if (!engine || !overlay) return;
    overlay.update({
      access: accessData ?? null,
      accessVisible: accessVisible && !floodStory,
      pathStatus,
      gaps: gapsQ.data ?? null,
      gapsOn,
      route: routeOn && !journeyOn && !compareOn && !floodStory ? (route?.geojson ?? null) : null,
      whatIf: floodStory ? null : whatIf,
      closureSim: floodStory ? null : closureSim,
      water: waterData ?? null,
      floodFrame: floodStory ? floodWaterFrame : undefined,
      floodEdges: floodStory ? null : (floodQ.data ?? null),
      floodOn,
      waste: wasteQ.data ?? null,
      wasteOn: wasteLens,
      evac: floodStory
        ? floodStory.resident
          ? [floodStory.resident.centre]
          : null
        : (evacQ.data ?? null),
      impact,
      focusPlaceId,
      boundary,
      keepPlaceIds,
      keepNear,
      tripOnly: journeyOn || compareOn || devsimOn,
    });
    setMarkerCount(accessVisible ? overlay.drawnPlaces() : 0);
    engine.requestRender();
  }, [
    engine,
    overlay,
    accessData,
    accessVisible,
    pathStatus,
    gapsQ.data,
    gapsOn,
    routeOn,
    journeyOn,
    compareOn,
    devsimOn,
    route,
    whatIf,
    closureSim,
    waterData,
    floodStory,
    floodQ.data,
    floodOn,
    wasteQ.data,
    wasteLens,
    evacQ.data,
    impact,
    focusPlaceId,
    boundary,
    keepPlaceIds,
    keepNear,
  ]);
  // Water ripples need frames even when decorative motion is paused.
  useEffect(() => {
    if (!engine || !floodOn || !waterData || !waterMotion || floodStory) return;
    let id = 0;
    const draw = () => {
      engine.requestRender();
      id = requestAnimationFrame(draw);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [engine, floodOn, waterData, waterMotion, floodStory]);
  // Elmina Day and rollout residents ride the same overlay layer.
  useResidents(engine, overlay, frame, { onScreen, clockRunning: running });

  return { routeOn, markerCount };
}
