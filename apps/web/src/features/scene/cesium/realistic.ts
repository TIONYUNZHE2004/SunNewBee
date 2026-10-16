import type * as Cesium from "cesium";
import { failureBurst } from "./failureBurst";

type C = typeof Cesium;

export interface RealisticEnv {
  googleKey: string;
  cesiumToken: string;
}

export interface RealisticCallbacks {
  /** The tileset was added to the scene (apply day/night to it). */
  onTiles?: (tiles: Cesium.Cesium3DTileset) => void;
  /** The tileset failed to load, or a burst of tile failures after it loaded. */
  onTilesFailed: () => void;
}

/**
 * The "Realistic photos (Google)" scene: Ion world imagery on the globe, Google Photorealistic 3D
 * tiles (else Ion world terrain + Cesium OSM Buildings). Only ever called for the realistic style;
 * the stylised city never calls it, so it makes no billable tile requests. Returns a cleanup that
 * removes everything it added (imagery, terrain, tileset, listeners) and restores the globe, so a
 * switch to the stylised city leaves no stale primitive behind. Display only: no height sampling,
 * tracing or caching of Google tiles.
 */
export function setupRealistic(
  C: C,
  viewer: Cesium.Viewer,
  env: RealisticEnv,
  cb: RealisticCallbacks,
): () => void {
  let cancelled = false;
  let tiles: Cesium.Cesium3DTileset | undefined;
  const removers: (() => void)[] = [];
  const { scene } = viewer;
  if (!env.googleKey && !env.cesiumToken) return () => {};

  if (env.cesiumToken) C.Ion.defaultAccessToken = env.cesiumToken;
  // The Viewer is created without a base layer (no Ion request in the stylised view); add it here.
  const base = C.ImageryLayer.fromWorldImagery({});
  viewer.imageryLayers.add(base, 0);
  let terrainSet = false;
  if (!env.googleKey && env.cesiumToken) {
    scene.setTerrain(C.Terrain.fromWorldTerrain());
    terrainSet = true;
  }

  (async () => {
    try {
      const t = env.googleKey
        ? await C.createGooglePhotorealistic3DTileset({
            key: env.googleKey,
            onlyUsingWithGoogleGeocoder: true,
          })
        : await C.createOsmBuildingsAsync();
      if (cancelled || viewer.isDestroyed()) {
        t.destroy();
        return;
      }
      tiles = t;
      scene.primitives.add(t);
      cb.onTiles?.(t);
      // requestRenderMode does not render on tile loads: request frames as tiles stream in.
      const render = () => {
        if (!viewer.isDestroyed()) scene.requestRender();
      };
      removers.push(
        t.loadProgress.addEventListener(render),
        t.allTilesLoaded.addEventListener(render),
      );
      if (env.googleKey) scene.globe.show = false;
      // A burst of tile failures after the root loaded (quota, key, network): bring the base
      // globe back instead of leaving overlays on black. Single failures are normal.
      const burst = failureBurst(10, 30_000);
      let fellBack = false;
      removers.push(
        t.tileFailed.addEventListener(() => {
          if (fellBack || viewer.isDestroyed() || !burst(Date.now())) return;
          fellBack = true;
          scene.globe.show = true;
          scene.requestRender();
          cb.onTilesFailed();
        }),
      );
    } catch (err) {
      // Bad key/quota/offline: keep the base globe and overlays. Never log the key.
      console.warn("3D tiles unavailable:", err instanceof Error ? err.message : "unknown error");
      if (!cancelled) cb.onTilesFailed();
    }
    if (!cancelled && !viewer.isDestroyed()) scene.requestRender();
  })();

  return () => {
    cancelled = true;
    for (const r of removers) r();
    removers.length = 0;
    if (viewer.isDestroyed()) return;
    if (tiles) scene.primitives.remove(tiles); // removes and destroys
    tiles = undefined;
    scene.globe.show = true;
    viewer.imageryLayers.remove(base, true);
    // Back to the flat ellipsoid: the stylised buildings sit at height 0 and would be buried.
    if (terrainSet)
      scene.setTerrain(new C.Terrain(Promise.resolve(new C.EllipsoidTerrainProvider())));
    scene.requestRender();
  };
}
