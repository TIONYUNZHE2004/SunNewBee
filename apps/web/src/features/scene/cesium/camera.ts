import * as Cesium from "cesium";
import { useEffect } from "react";
import { useCesium } from "resium";
import { useScene } from "../sceneStore";

export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function go(viewer: Cesium.Viewer, sphere: Cesium.BoundingSphere, rangeM?: number) {
  const offset = new Cesium.HeadingPitchRange(
    0,
    Cesium.Math.toRadians(-45),
    rangeM ?? Math.max(sphere.radius * 2.5, 300),
  );
  // Reduced motion: jump (viewBoundingSphere is the setView equivalent) instead of flying.
  if (prefersReducedMotion()) viewer.camera.viewBoundingSphere(sphere, offset);
  else viewer.camera.flyToBoundingSphere(sphere, { offset, duration: 1.8 });
  viewer.scene.requestRender();
}

/** Subscribes to scene-intent state and moves the camera. Reduced motion: no animation. */
export function useCameraIntents(
  focusPoint: (id: string) => [number, number] | null,
  /** Called when an intent moved the camera, so the home re-frame rule leaves it alone. */
  onMoved?: () => void,
) {
  const { viewer } = useCesium();
  useEffect(() => {
    const move = (fn: (v: Cesium.Viewer) => void) => {
      const v = viewer;
      if (v && !v.isDestroyed()) {
        onMoved?.();
        fn(v);
      }
    };
    return useScene.subscribe((s, prev) => {
      if (s.route && s.route !== prev.route) {
        const pts = s.route.geojson.coordinates.map((c) =>
          Cesium.Cartesian3.fromDegrees(c[0] as number, c[1] as number),
        );
        if (pts.length) move((v) => go(v, Cesium.BoundingSphere.fromPoints(pts)));
      } else if (s.focusPlaceId && s.focusPlaceId !== prev.focusPlaceId) {
        const c = focusPoint(s.focusPlaceId);
        if (c)
          move((v) =>
            go(v, new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(c[0], c[1]), 1), 400),
          );
      } else if (s.camera && s.camera !== prev.camera) {
        const cam = s.camera;
        move((v) =>
          go(
            v,
            new Cesium.BoundingSphere(
              Cesium.Cartesian3.fromDegrees(cam.center[0], cam.center[1]),
              1,
            ),
            cam.rangeM,
          ),
        );
      }
    });
  }, [viewer, focusPoint, onMoved]);
}
