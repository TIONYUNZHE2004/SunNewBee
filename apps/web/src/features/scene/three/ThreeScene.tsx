import { useMemo, useRef } from "react";
import { useBuildings, useLayer, useSite } from "../../../lib/api";
import { JourneyMount } from "../../journey/JourneyMount";
import { InSlot } from "../../map-ui/mapSlots";
import { CameraControls, handleMapKey } from "../cesium/controls/CameraControls";
import type { CameraOps } from "../cesium/controls/cameraOps";
import { homeView } from "../cesium/home";
import { PerfOverlay, SlowBanner } from "../cesium/PerfOverlay";
import { type LonLat, pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { createRoleUniforms } from "./assets/roleMaterial";
import { createEngine } from "./engine";
import { createFrame } from "./frame";
import { boundaryOf } from "./ground/boundary";
import { clipLayer } from "./ground/clipLayer";
import { useSceneBus } from "./scene/sceneBus";
import { useAcceptanceHook } from "./scene/useAcceptanceHook";
import { useCameraOps } from "./scene/useCameraOps";
import { useCityAssets } from "./scene/useCityAssets";
import { useDecor } from "./scene/useDecor";
import { useEngine } from "./scene/useEngine";
import { useFacades } from "./scene/useFacades";
import { useGround, useRoads } from "./scene/useGround";
import { useGroundDecor } from "./scene/useGroundDecor";
import { useMood } from "./scene/useMood";
import { useMotion } from "./scene/useMotion";
import { useOverlays } from "./scene/useOverlays";
import { usePicking } from "./scene/usePicking";
import { useRoofs } from "./scene/useRoofs";
import { useSlab } from "./scene/useSlab";
import { useMergeMeasure, useStream } from "./scene/useStream";

export const DECORATIVE_NOTE = "Decorative details are illustrative.";

/**
 * Shown whenever any decorative layer is drawn (props, people, vehicles, birds, cloud shadows,
 * lamp pools, ground tints, decorative landmarks): none of it is data.
 */
function DecorativeChip() {
  return (
    <InSlot name="notes">
      <p
        role="note"
        aria-label={DECORATIVE_NOTE}
        className="rounded-full border border-edge bg-surface/95 px-3 py-1 text-xs text-fg shadow-md"
      >
        {DECORATIVE_NOTE}
      </p>
    </InSlot>
  );
}

const SHOWROOM_LABEL = "Model showroom — not the city";

/** `?showroom=1` replaces the city with a grid of every model: say so while it is shown. */
function ShowroomChip() {
  return (
    <InSlot name="notes">
      <p
        role="note"
        aria-label={SHOWROOM_LABEL}
        className="rounded-full border border-edge bg-surface/95 px-3 py-1 text-xs font-medium text-fg shadow-md"
      >
        {SHOWROOM_LABEL}
      </p>
    </InSlot>
  );
}

/**
 * Three.js stylised city (the default Stylised renderer). All WebGL lives in `engine.ts`; each concern
 * is a hook in `scene/`. Cross-hook data passes through hook return values, except the mood /
 * ambient / driver cycle, which shares one per-view `useSceneBus()` store.
 */
export default function ThreeScene({
  onOps,
  createEngineFn = createEngine,
}: {
  onOps?: (ops: CameraOps | null) => void;
  createEngineFn?: typeof createEngine;
} = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const bus = useSceneBus();
  const roleUniforms = useMemo(createRoleUniforms, []);
  // `?assets=0` keeps the extruded city only; `?showroom=1` lays out every asset for owner review.
  const [assetsOn, showroom] = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return [q.get("assets") !== "0", q.get("showroom") === "1"];
  }, []);

  const site = useSite().data;
  const rawBuildingsQ = useBuildings();
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const access = useLayer("access", profile, scenarioId);

  const center = site?.center;
  const frame = useMemo(
    () =>
      center && Number.isFinite(center[0]) && Number.isFinite(center[1])
        ? createFrame([center[0] as number, center[1] as number])
        : null,
    [center],
  );
  const bbox = site?.bbox;
  // A-T4: the Elmina outline (display only). Every stylised layer is cut to it once here (and each
  // streamed tile passes its vertex guard); routing, the API data and the data overlays are not.
  const boundaryGeom = site?.boundary?.geometry;
  const boundary = useMemo(
    () => (frame && boundaryGeom ? boundaryOf(boundaryGeom, frame) : null),
    [frame, boundaryGeom],
  );
  const rawBuildings = rawBuildingsQ.data;
  const buildings = useMemo(
    () =>
      rawBuildings && boundary && frame
        ? clipLayer(rawBuildings, boundary, frame).layer
        : rawBuildings,
    [rawBuildings, boundary, frame],
  );
  const buildingsQ = useMemo(
    () => ({ data: buildings, isError: rawBuildingsQ.isError, isSuccess: rawBuildingsQ.isSuccess }),
    [buildings, rawBuildingsQ.isError, rawBuildingsQ.isSuccess],
  );

  // Same place lookup as CesiumScene: place ids to coordinates from the access layer.
  // Memoised on the data: Day playback re-renders this component at ~10 Hz.
  const places = useMemo(
    () => new Map<string, LonLat>(pointFeatures(access.data).map((p) => [p.id, p.coord])),
    [access.data],
  );

  const { engine, failure, tier, frames } = useEngine({
    createEngineFn,
    hostRef,
    sectionRef,
    frame,
    bbox,
  });
  const city = useCityAssets({
    engine,
    frame,
    buildings,
    tier,
    assetsOn,
    showroom,
    roleUniforms,
    boundary,
  });
  const { assetsState, loaded } = city;
  useSlab({ engine, boundary: showroom ? null : boundary });
  const { detailsOn, walk, landcover } = useGround({
    engine,
    frame,
    buildingsQ,
    accessData: access.data,
    tier,
    boundary,
  });
  // Township streaming: the 250 m tiles around the camera target feed every decorative layer.
  const { active, centre, mergeStart } = useStream({
    engine,
    frame,
    tier,
    detailsOn,
    walk,
    buildings,
    loaded,
    showroom,
    facadeSrc: city.facadeSrc,
    roofSrc: city.roofSrc,
    boundary,
  });
  const { roads, stalls } = useRoads({ engine, active, tier });
  // Verges and construction ground: one ground-decor mesh (stall lines ride the road markings).
  const { decorOn } = useGroundDecor({ engine, active, tier });
  const { facadesOn } = useFacades({
    engine,
    active,
    tier,
    roleUniforms,
    baseBytes: city.baseBytes,
  });
  const { roofsOn } = useRoofs({ engine, active, tier, roleUniforms });
  const { kits } = useDecor({
    engine,
    frame,
    tier,
    active,
    centre,
    showroom,
    roleUniforms,
    setKits: city.setKits,
    kitJob: city.kitJob,
    bus,
    boundary,
  });
  const { running, onScreen, agents } = useMotion({
    engine,
    tier,
    active,
    loaded,
    showroom,
    roleUniforms,
    sectionRef,
    bus,
  });
  // After every hook that merges `active`: times the merge (`tl:stream-merge`).
  useMergeMeasure(active, mergeStart);
  const { ops } = useCameraOps({ engine, frame, bbox, places, hostRef, onOps });
  const { routeOn, markerCount } = useOverlays({
    engine,
    frame,
    accessData: access.data,
    onScreen,
    running,
  });
  const home = homeView(site);
  const { initialBackground } = useMood({ engine, roleUniforms, sectionRef, home, bus });
  usePicking({ engine, hostRef, places });
  // Test-only camera / pick / frame-stats hook (dev builds or `?acceptance=1`).
  useAcceptanceHook(engine, frame);

  // Any decorative layer in the scene: city assets (kits, decorative landmarks), facades, roofs, ground
  // decor (verges, construction ground), stall lines, props, agents, the ground layer (land-cover
  // tints, road surfaces) or the ambient birds and clouds.
  const decorativeShown =
    city.decorAssets ||
    facadesOn ||
    roofsOn ||
    decorOn ||
    (!!engine && stalls.length > 0) ||
    kits.size > 0 ||
    agents.length > 0 ||
    (!!engine && (roads.length > 0 || !!landcover?.getAttribute("position")?.count)) ||
    (!!engine && !!frame && !showroom && tier !== "low");

  // To the renderer error boundary (MapStage falls back to Mapbox or List).
  if (failure) throw failure;
  return (
    <section
      ref={sectionRef}
      data-testid="three-scene"
      data-frames={frames}
      data-tier={tier}
      data-route={routeOn ? "on" : "off"}
      data-assets={assetsState}
      data-instances={city.instances}
      data-markers={markerCount}
      data-tiles={active.length}
      data-fallback={city.fallback.join(",")}
      className="relative h-full w-full"
      style={{ background: initialBackground }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the 3D map takes keyboard focus for WASD/QE/RF
      tabIndex={0}
      aria-label="3D map. Arrow keys or WASD move, Q and E rotate, R and F tilt, plus and minus zoom, N faces north."
      onKeyDown={(e) => handleMapKey(e, ops)}
    >
      <div ref={hostRef} className="absolute inset-0" />
      <CameraControls ops={ops} />
      <PerfOverlay />
      <SlowBanner />
      {decorativeShown && <DecorativeChip />}
      {/* Resident journey: ribbon, markers, label, HUD, mini-map and event cards (D-T7). */}
      <JourneyMount
        engine={engine}
        frame={frame}
        hostRef={hostRef}
        places={places}
        footprints={buildings?.buildings}
      />
      {showroom && (assetsState === "loading" || assetsState === "ready") && <ShowroomChip />}
    </section>
  );
}
