import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { useCallback, useEffect, useRef } from "react";
import { type CesiumComponentRef, Viewer } from "resium";
import { useLayer } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { useCameraIntents } from "./camera";
import { AccessLayer, FloodLayer, WasteLayer } from "./layers";

export default function CesiumScene() {
  const ref = useRef<CesiumComponentRef<Cesium.Viewer>>(null);
  const { profile, scenarioId } = useScene();
  const access = useLayer("access", profile, scenarioId);
  const placesRef = useRef(new Map<string, [number, number]>());
  placesRef.current = new Map(pointFeatures(access.data).map((p) => [p.id, p.coord]));
  const focusPoint = useCallback((id: string) => placesRef.current.get(id) ?? null, []);

  useEffect(() => {
    const viewer = ref.current?.cesiumElement;
    if (!viewer) return;
    let cancelled = false;
    (async () => {
      try {
        if (ENV.cesiumToken) Cesium.Ion.defaultAccessToken = ENV.cesiumToken;
        if (ENV.googleKey) {
          // Display-only: no height sampling, tracing or caching of Google tiles.
          const tiles = await Cesium.createGooglePhotorealistic3DTileset({ key: ENV.googleKey });
          if (cancelled || viewer.isDestroyed()) return;
          viewer.scene.primitives.add(tiles);
          viewer.scene.globe.show = false;
        } else if (ENV.cesiumToken) {
          viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
          const osm = await Cesium.createOsmBuildingsAsync();
          if (cancelled || viewer.isDestroyed()) return;
          viewer.scene.primitives.add(osm);
        }
      } catch {
        // Tileset failed (bad key/quota/offline): keep the base globe and overlays.
      }
      if (cancelled || viewer.isDestroyed()) return;
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(101.5099, 3.1813, 4500),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
      });
      viewer.scene.requestRender();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useCameraIntents(ref, focusPoint);

  return (
    <section className="h-full w-full" aria-label="3D map of Elmina">
      <Viewer
        ref={ref}
        full={false}
        style={{ width: "100%", height: "100%" }}
        requestRenderMode
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
        <AccessLayer />
        <FloodLayer />
        <WasteLayer />
      </Viewer>
    </section>
  );
}
