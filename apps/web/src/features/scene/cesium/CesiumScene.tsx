import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CesiumComponentRef, useCesium, Viewer } from "resium";
import { useLayer, useSite } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { useTheme } from "../../../ui/theme";
import { pickedFloodEdgeId, pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { useMapStyle } from "../useMapStyle";
import { useCameraIntents } from "./camera";
import { type HomeView, homeView, stylisedHomeView } from "./home";
import { AccessLayer, FloodLayer, WasteLayer } from "./layers";
import { setupRealistic } from "./realistic";
import { StylisedCity } from "./stylised/StylisedCity";
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

function frameHome(viewer: Cesium.Viewer, { lon, lat, range_m }: HomeView) {
  viewer.camera.lookAt(
    Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range_m),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

/** Child of <Viewer>: mounts only after resium has created the viewer. */
function SceneSetup({
  onNoDraping,
  onTilesFailed,
}: {
  onNoDraping: () => void;
  onTilesFailed: () => void;
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

  // Realistic photos only. The stylised city creates no tileset and no Ion imagery (no billable
  // calls); wait until the buildings request settles so the default style is known first.
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
  // load. The stylised city re-skins itself (palette, sky, light), so skip it there.
  useEffect(() => {
    if (style !== "realistic") return;
    applyCesiumTime(viewer, tilesRef.current, cesiumTimeStyle(theme), TIME_OPS);
  }, [viewer, theme, style]);

  // Frame the home view (separate from the tiles effect: no tileset reload). Frame at once with
  // the constants so a slow/failed /site never leaves the whole-globe view, then re-frame to the
  // site's home (closer for the stylised city) until the user touches the camera.
  const siteData = useSite().data;
  const moved = useRef(false);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    moved.current = false;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const onMove = () => {
      moved.current = true;
    };
    for (const t of [
      Cesium.ScreenSpaceEventType.LEFT_DOWN,
      Cesium.ScreenSpaceEventType.RIGHT_DOWN,
      Cesium.ScreenSpaceEventType.MIDDLE_DOWN,
      Cesium.ScreenSpaceEventType.WHEEL,
      Cesium.ScreenSpaceEventType.PINCH_START,
    ]) {
      handler.setInputAction(onMove, t);
    }
    return () => handler.destroy();
  }, [viewer]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || moved.current) return;
    const home = homeView(siteData);
    frameHome(viewer, style === "stylised" ? stylisedHomeView(home) : home);
  }, [viewer, siteData, style]);

  // Click a place marker (entity id = place id) to open its card, or a flood path (instance id) for "Why this path?".
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
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

  useCameraIntents(focusPoint);
  return null;
}

export default function CesiumScene() {
  const ref = useRef<CesiumComponentRef<Cesium.Viewer>>(null);
  const [noDraping, setNoDraping] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const onTilesFailed = useCallback(() => setTilesFailed(true), []);
  const onNoDraping = useCallback(() => setNoDraping(true), []);
  const { style } = useMapStyle();
  return (
    <section className="relative h-full w-full">
      {tilesFailed && style === "realistic" && (
        <p
          role="status"
          className="absolute right-2 top-2 z-10 rounded-md border border-line bg-surface/95 px-2 py-1 text-xs text-fg"
        >
          Photoreal tiles unavailable — showing basic globe
        </p>
      )}
      {noDraping && (
        <p
          role="note"
          className="absolute bottom-8 left-2 z-10 rounded-md border border-line bg-surface/95 px-2 py-1 text-xs text-fg"
        >
          Paths shown without terrain draping
        </p>
      )}
      <Viewer
        ref={ref}
        full={false}
        style={{ width: "100%", height: "100%" }}
        requestRenderMode
        onUpdate={() => {
          const v = ref.current?.cesiumElement;
          if (v && !v.isDestroyed()) v.scene.requestRender();
        }}
        baseLayerPicker={false}
        // No Ion imagery by default: the stylised city needs none (no billable request), and the
        // realistic setup adds the world imagery itself.
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
        <SceneSetup onNoDraping={onNoDraping} onTilesFailed={onTilesFailed} />
        {style === "stylised" && <StylisedCity />}
        <AccessLayer />
        <FloodLayer />
        <WasteLayer />
      </Viewer>
    </section>
  );
}
