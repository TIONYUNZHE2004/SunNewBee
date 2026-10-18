import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CesiumComponentRef, useCesium, Viewer } from "resium";
import { useLayer, useSite } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { useTheme } from "../../../ui/theme";
import { useTripPick } from "../../day/tripPickStore";
import { usePanel } from "../../main/panelStore";
import { isWide } from "../../main/usePanelReserve";
import { frustumXOffset, mapPanelOverlapPx } from "../../main/viewport";
import { InSlot } from "../../map-ui/mapSlots";
import { pickedFloodEdgeId, pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { useMapStyle } from "../useMapStyle";
import { useCameraIntents } from "./camera";
import { CameraControls, handleMapKey } from "./controls/CameraControls";
import { trackHeading } from "./controls/cameraHeadingStore";
import { type CameraOps, createCameraOps, frameNow } from "./controls/cameraOps";
import { configureControls } from "./controls/configureControls";
import { movedInputs } from "./controls/movedInputs";
import { patchCameraPickRay, patchFrustumClone } from "./frustumClone";
import { DEFAULT_FOV_DEG, framingFor, homeView, shouldReframe } from "./home";
import { AccessLayer, FloodLayer, WasteLayer } from "./layers";
import { PerfOverlay, SlowBanner } from "./PerfOverlay";
import { setupRealistic } from "./realistic";
import { applyCesiumTime, cesiumTimeStyle, type TimeOps } from "./timeOfDay";

const TIME_OPS: TimeOps = {
  color: (css) => Cesium.Color.fromCssColorString(css),
  shader: (b) =>
    new Cesium.CustomShader({
      uniforms: { u_brightness: { type: Cesium.UniformType.FLOAT, value: b } },
      fragmentShaderText:
        "void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material){ material.diffuse *= u_brightness; }",
    }),
};

const PICK_PX = 8;

// The panel reserve sets frustum.xOffset: without these the camera never equals its (offset-less)
// clone, so requestRenderMode renders every frame, and pick rays ignore the offset that rendering
// applies (see frustumClone.ts).
patchFrustumClone(Cesium.PerspectiveFrustum);
patchCameraPickRay(Cesium.Camera);

// Module-level: resium compares read-only Viewer props by reference and recreates the viewer on a
// new object, so an inline literal would rebuild the WebGL context on every render.
const CONTEXT_OPTIONS = { webgl: { alpha: true } } as const;

/** Child of <Viewer>: mounts only after resium has created the viewer. */
function SceneSetup({
  onNoDraping,
  onTilesFailed,
  onOps,
}: {
  onNoDraping: () => void;
  onTilesFailed: () => void;
  onOps?: (ops: CameraOps | null) => void;
}) {
  const { viewer } = useCesium();
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const access = useLayer("access", profile, scenarioId);
  const theme = useTheme((s) => s.theme);
  const { style, settled } = useMapStyle();
  const tilesRef = useRef<Cesium.Cesium3DTileset | undefined>(undefined);
  const placesRef = useRef(new Map<string, [number, number]>());
  placesRef.current = new Map(pointFeatures(access.data).map((p) => [p.id, p.coord]));
  const focusPoint = useCallback((id: string) => placesRef.current.get(id) ?? null, []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (!Cesium.GroundPolylinePrimitive.isSupported(viewer.scene)) onNoDraping();
  }, [viewer, onNoDraping]);

  // Realistic photos. MapStage sends only Realistic here (Three.js draws Stylised); the style guard
  // keeps any other style from creating a billable tileset. Wait until the buildings request
  // settles so the default style is known first.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !settled || style !== "realistic") return;
    const stop = setupRealistic(Cesium, viewer, ENV, {
      onTilesFailed,
      onTiles: (tiles) => {
        tilesRef.current = tiles;
        applyCesiumTime(viewer, tiles, cesiumTimeStyle(useTheme.getState().theme), TIME_OPS);
      },
    });
    applyCesiumTime(viewer, undefined, cesiumTimeStyle(useTheme.getState().theme), TIME_OPS);
    return () => {
      tilesRef.current = undefined;
      stop();
    };
  }, [viewer, settled, style, onTilesFailed]);

  // Day/night lighting (display-only). Re-applies on theme change; the tiles effect applies it on
  // load.
  useEffect(() => {
    if (style !== "realistic") return;
    applyCesiumTime(viewer, tilesRef.current, cesiumTimeStyle(theme), TIME_OPS);
  }, [viewer, theme, style]);

  // Frame the home view (separate from the tiles effect: no tileset reload). Frame at once with
  // the constants so a slow/failed /site never leaves the whole-globe view, then re-frame to the
  // site's home until the user touches the camera.
  const siteData = useSite().data;
  const framing = useRef({ moved: false, reframed: false });
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    framing.current = { moved: false, reframed: false };
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const onMove = () => {
      framing.current.moved = true;
    };
    for (const [type, modifier] of movedInputs(Cesium)) {
      handler.setInputAction(onMove, type, modifier);
    }
    return () => handler.destroy();
  }, [viewer]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !shouldReframe(framing.current)) return;
    frameNow(Cesium, viewer, framingFor(homeView(siteData)));
    // Locked once the real inputs are in (site data + the settled buildings request). After that
    // the camera keeps whatever it shows, e.g. a fly-to the assistant just made.
    if (siteData && settled) framing.current.reframed = true;
  }, [viewer, siteData, settled]);

  // Click a place marker (entity id = place id) to open its card, or a flood path (instance id) for "Why this path?".
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      // Choosing a trip end on the map ("Rehearse my trip") takes the click first.
      const picking = useTripPick.getState().picking;
      if (picking) {
        const at =
          (viewer.scene.pickPositionSupported && viewer.scene.pickPosition(e.position)) ||
          viewer.camera.pickEllipsoid(e.position);
        if (at) {
          const c = Cesium.Cartographic.fromCartesian(at);
          useTripPick
            .getState()
            .setPoint(picking, [
              Cesium.Math.toDegrees(c.longitude),
              Cesium.Math.toDegrees(c.latitude),
            ]);
        }
        return;
      }
      // Thin ground polylines: pick a small window (8 px) so near misses still hit.
      const hits: { id?: unknown }[] = viewer.scene.drillPick(e.position, 5, PICK_PX, PICK_PX);
      for (const h of hits) {
        const key =
          h.id instanceof Cesium.Entity ? h.id.properties?.placeId?.getValue() : undefined;
        if (typeof key === "string") {
          useScene.getState().selectPlace(key); // place markers keep priority
          return;
        }
      }
      for (const h of hits) {
        const edgeId = pickedFloodEdgeId(h);
        if (edgeId) {
          useScene.getState().selectFloodEdge(edgeId);
          return;
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [viewer]);

  const onIntentMoved = useCallback(() => {
    framing.current.moved = true;
  }, []);
  useCameraIntents(focusPoint, onIntentMoved);

  // Field of view (Cesium's fov is the horizontal angle on landscape canvases).
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const f = viewer.camera.frustum;
    if (!(f instanceof Cesium.PerspectiveFrustum)) return;
    f.fov = Cesium.Math.toRadians(DEFAULT_FOV_DEG);
    viewer.scene.requestRender();
  }, [viewer]);

  // Shift the projection so the look point sits in the middle of the map area left of the panel.
  // Runs after the fov effect above (declared first), so `f.fov` is current.
  const panelOpen = usePanel((s) => s.open);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const apply = () => {
      const f = viewer.camera.frustum;
      if (!(f instanceof Cesium.PerspectiveFrustum)) return;
      const w = viewer.canvas.clientWidth;
      const h = viewer.canvas.clientHeight;
      const panel = mapPanelOverlapPx(panelOpen, isWide(), innerWidth); // phones use the sheet
      f.xOffset = frustumXOffset(panel / 2, w, f.near, f.fov ?? 0, h);
      viewer.scene.requestRender();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(viewer.canvas);
    return () => ro.disconnect();
  }, [viewer, panelOpen]);

  // The compass follows the heading through its own store, so camera moves never re-render the
  // Viewer subtree (only the compass subscribes).
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    return trackHeading(viewer.camera);
  }, [viewer]);

  // Camera actions (buttons, keyboard, double-click) and the mouse/touch mapping with limits.
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;
  const framingRef = useRef(framingFor(homeView(siteData)));
  framingRef.current = framingFor(homeView(siteData));
  const bboxRef = useRef<[number, number, number, number]>([101.46, 3.15, 101.53, 3.24]);
  if (siteData?.bbox?.length === 4)
    bboxRef.current = siteData.bbox as [number, number, number, number];
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const ops = createCameraOps(
      Cesium,
      viewer,
      () => framingRef.current,
      () => bboxRef.current,
      () => {
        framing.current.moved = true;
      },
    );
    const undo = configureControls(Cesium, viewer, ops, () => bboxRef.current);
    onOpsRef.current?.(ops);
    return () => {
      onOpsRef.current?.(null);
      undo();
    };
  }, [viewer]);
  return null;
}

export default function CesiumScene({ onOps }: { onOps?: (ops: CameraOps | null) => void } = {}) {
  const ref = useRef<CesiumComponentRef<Cesium.Viewer>>(null);
  const [noDraping, setNoDraping] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const onTilesFailed = useCallback(() => setTilesFailed(true), []);
  const onNoDraping = useCallback(() => setNoDraping(true), []);
  const { style } = useMapStyle();
  const [ops, setOpsState] = useState<CameraOps | null>(null);
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;
  const setOps = useCallback((o: CameraOps | null) => {
    setOpsState(o);
    onOpsRef.current?.(o);
  }, []);
  return (
    <section
      className="relative h-full w-full"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the 3D map takes keyboard focus for WASD/QE/RF
      tabIndex={0}
      aria-label="3D map. Arrow keys or WASD move, Q and E rotate, R and F tilt, plus and minus zoom, N faces north."
      onKeyDown={(e) => handleMapKey(e, ops)}
    >
      {tilesFailed && style === "realistic" && (
        <p
          role="status"
          className="absolute right-2 top-2 z-10 rounded-md border border-line bg-surface/95 px-2 py-1 text-xs text-fg"
        >
          Photoreal tiles unavailable — showing basic globe
        </p>
      )}
      {noDraping && (
        <InSlot name="notes">
          <p role="note" className="glass rounded-md px-2 py-1 text-xs text-fg">
            Paths shown without terrain draping
          </p>
        </InSlot>
      )}
      <Viewer
        ref={ref}
        full={false}
        style={{ width: "100%", height: "100%" }}
        requestRenderMode
        contextOptions={CONTEXT_OPTIONS}
        onUpdate={() => {
          const v = ref.current?.cesiumElement;
          if (v && !v.isDestroyed()) v.scene.requestRender();
        }}
        baseLayerPicker={false}
        // No Ion imagery by default: the realistic setup adds the world imagery itself.
        baseLayer={false}
        timeline={false}
        animation={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        infoBox={false}
        selectionIndicator={false}
        fullscreenButton={false}
      >
        <SceneSetup onNoDraping={onNoDraping} onTilesFailed={onTilesFailed} onOps={setOps} />
        <AccessLayer />
        <FloodLayer />
        <WasteLayer />
      </Viewer>
      <CameraControls ops={ops} />
      <PerfOverlay />
      <SlowBanner />
    </section>
  );
}
