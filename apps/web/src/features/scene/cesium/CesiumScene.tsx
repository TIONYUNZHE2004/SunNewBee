import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CesiumComponentRef, useCesium, Viewer } from "resium";
import { useLayer, useSite } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { pickedFloodEdgeId, pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { useCameraIntents } from "./camera";
import { type HomeView, homeView, shouldReframe } from "./home";
import { AccessLayer, FloodLayer, WasteLayer } from "./layers";

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
  const placesRef = useRef(new Map<string, [number, number]>());
  placesRef.current = new Map(pointFeatures(access.data).map((p) => [p.id, p.coord]));
  const focusPoint = useCallback((id: string) => placesRef.current.get(id) ?? null, []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (!Cesium.GroundPolylinePrimitive.isSupported(viewer.scene)) onNoDraping();
    let cancelled = false;
    let tiles: Cesium.Cesium3DTileset | undefined;
    const removers: (() => void)[] = [];
    (async () => {
      try {
        if (ENV.cesiumToken) Cesium.Ion.defaultAccessToken = ENV.cesiumToken;
        if (ENV.googleKey) {
          // Display-only: no height sampling, tracing or caching of Google tiles.
          tiles = await Cesium.createGooglePhotorealistic3DTileset({
            key: ENV.googleKey,
            onlyUsingWithGoogleGeocoder: true,
          });
        } else if (ENV.cesiumToken) {
          viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
          tiles = await Cesium.createOsmBuildingsAsync();
        }
        if (tiles) {
          if (cancelled || viewer.isDestroyed()) {
            tiles.destroy();
            tiles = undefined;
          } else {
            viewer.scene.primitives.add(tiles);
            // requestRenderMode does not render on tile loads: request frames as tiles stream in.
            const render = () => {
              if (!viewer.isDestroyed()) viewer.scene.requestRender();
            };
            removers.push(
              tiles.loadProgress.addEventListener(render),
              tiles.allTilesLoaded.addEventListener(render),
            );
            if (ENV.googleKey) viewer.scene.globe.show = false;
          }
        }
      } catch (err) {
        // Tileset failed (bad key/quota/offline): keep the base globe and overlays. Never log the key.
        console.warn("3D tiles unavailable:", err instanceof Error ? err.message : "unknown error");
        if (!cancelled) onTilesFailed();
      }
      if (cancelled || viewer.isDestroyed()) return;
      viewer.scene.requestRender();
    })();
    return () => {
      cancelled = true;
      for (const r of removers) r();
      if (tiles && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(tiles); // removes and destroys
        if (ENV.googleKey) viewer.scene.globe.show = true;
        viewer.scene.requestRender();
      }
    };
  }, [viewer, onNoDraping, onTilesFailed]);

  // Frame the home view once per viewer (separate from the tiles effect: no tileset reload).
  // Frame at once with the constants so a slow/failed /site never leaves the whole-globe view,
  // then re-frame once to the site's home if the user has not touched the camera yet.
  const siteData = useSite().data;
  const framing = useRef({ moved: false, reframed: false });
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    framing.current = { moved: false, reframed: false };
    frameHome(viewer, homeView(undefined));
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const moved = () => {
      framing.current.moved = true;
    };
    for (const t of [
      Cesium.ScreenSpaceEventType.LEFT_DOWN,
      Cesium.ScreenSpaceEventType.RIGHT_DOWN,
      Cesium.ScreenSpaceEventType.MIDDLE_DOWN,
      Cesium.ScreenSpaceEventType.WHEEL,
      Cesium.ScreenSpaceEventType.PINCH_START,
    ]) {
      handler.setInputAction(moved, t);
    }
    return () => handler.destroy();
  }, [viewer]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !siteData) return;
    const f = framing.current;
    if (!shouldReframe(f)) return;
    f.reframed = true;
    frameHome(viewer, homeView(siteData));
  }, [viewer, siteData]);

  // Click a place marker (entity id = place id) to open its card, or a flood path (instance id) for "Why this path?".
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(e.position);
      const id = picked?.id;
      const key = id instanceof Cesium.Entity ? id.properties?.placeId?.getValue() : undefined;
      if (typeof key === "string") {
        useScene.getState().selectPlace(key);
        return;
      }
      const edgeId = pickedFloodEdgeId(picked);
      if (edgeId) useScene.getState().selectFloodEdge(edgeId);
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
  return (
    <section className="relative h-full w-full" aria-label="3D map of Elmina">
      {tilesFailed && (
        <p
          role="status"
          className="absolute right-2 top-2 z-10 rounded-md border border-line bg-white/95 px-2 py-1 text-xs"
        >
          Photoreal tiles unavailable — showing basic globe
        </p>
      )}
      {noDraping && (
        <p
          role="note"
          className="absolute bottom-8 left-2 z-10 rounded-md border border-line bg-white/95 px-2 py-1 text-xs"
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
        <AccessLayer />
        <FloodLayer />
        <WasteLayer />
      </Viewer>
    </section>
  );
}
