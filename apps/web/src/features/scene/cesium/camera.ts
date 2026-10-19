import * as Cesium from "cesium";
import { useEffect } from "react";
import { useCesium } from "resium";
import { parseTrip, tripCoords, tripIdentity } from "../../day/tripModel";
import { diffLines } from "../../whatif/whatifModel";
import { type SceneState, useScene } from "../sceneStore";
import { DEFAULT_PITCH_DEG } from "./home";

export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function go(viewer: Cesium.Viewer, sphere: Cesium.BoundingSphere, rangeM?: number, jump = false) {
  const offset = new Cesium.HeadingPitchRange(
    0,
    Cesium.Math.toRadians(DEFAULT_PITCH_DEG),
    rangeM ?? Math.max(sphere.radius * 2.5, 300),
  );
  // Jump instead of flying on a re-frame at mount or with reduced motion (viewBoundingSphere is the
  // setView equivalent).
  if (jump || prefersReducedMotion()) viewer.camera.viewBoundingSphere(sphere, offset);
  else viewer.camera.flyToBoundingSphere(sphere, { offset, duration: 1.8 });
  viewer.scene.requestRender();
}

type IntentState = Pick<
  SceneState,
  "route" | "focusRouteRequest" | "myTrip" | "whatIf" | "focusPlaceId" | "camera"
>;

/** No intent at all: diffing against it yields the intent standing in the store. */
const NO_INTENT: IntentState = {
  route: null,
  focusRouteRequest: null,
  myTrip: null,
  whatIf: null,
  focusPlaceId: null,
  camera: null,
};

const sphereOf = (coords: number[][]) => {
  const pts = coords.map((c) => Cesium.Cartesian3.fromDegrees(c[0] as number, c[1] as number));
  return pts.length ? Cesium.BoundingSphere.fromPoints(pts) : null;
};

/**
 * Pure: where the camera should go for the intent that changed from `prev` to `s`, or null. Against
 * `NO_INTENT` it is the standing intent, in the same precedence (route, route re-focus, own trip,
 * what-if, place, camera.fly_to).
 */
export function intentTarget(
  s: IntentState,
  prev: IntentState,
  focusPoint: (id: string) => [number, number] | null,
): { sphere: Cesium.BoundingSphere; rangeM?: number } | null {
  if (s.route && s.route !== prev.route) {
    const sphere = sphereOf(s.route.geojson.coordinates);
    return sphere && { sphere };
  }
  if (
    s.focusRouteRequest &&
    s.focusRouteRequest !== prev.focusRouteRequest &&
    s.route?.id === s.focusRouteRequest
  ) {
    const sphere = sphereOf(s.route.geojson.coordinates);
    return sphere && { sphere };
  }
  if (s.myTrip && tripIdentity(s.myTrip.geojson) !== tripIdentity(prev.myTrip?.geojson)) {
    // Frame a resident's own rehearsed trip when a new trip arrives (another departure of the
    // same trip keeps the view the resident is looking at).
    const sphere = sphereOf(tripCoords(parseTrip(s.myTrip.geojson)));
    return sphere && { sphere };
  }
  if (s.whatIf && s.whatIf !== prev.whatIf) {
    // Frame the imagined diff (changed journeys and imagined changes) when it arrives.
    const lines = diffLines(s.whatIf.geojson as never);
    const sphere = sphereOf([...lines.after, ...lines.before, ...lines.touched].flat());
    return sphere && { sphere };
  }
  if (s.focusPlaceId && s.focusPlaceId !== prev.focusPlaceId) {
    const c = focusPoint(s.focusPlaceId);
    if (!c) return null;
    return {
      sphere: new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(c[0], c[1]), 1),
      rangeM: 400,
    };
  }
  if (s.camera && s.camera !== prev.camera) {
    const cam = s.camera;
    return {
      sphere: new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(cam.center[0], cam.center[1]),
        1,
      ),
      rangeM: cam.rangeM,
    };
  }
  return null;
}

/**
 * Moves the camera for scene intents. On mount (e.g. after a style switch) it re-frames on the
 * intent standing in the store, without animation; then it follows changes. Reduced motion: no
 * animation.
 */
export function useCameraIntents(
  focusPoint: (id: string) => [number, number] | null,
  /** Called when an intent moved the camera, so the home re-frame rule leaves it alone. */
  onMoved?: () => void,
) {
  const { viewer } = useCesium();
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const standing = intentTarget(useScene.getState(), NO_INTENT, focusPoint);
    if (standing) {
      onMoved?.();
      go(viewer, standing.sphere, standing.rangeM, true);
    }
    return useScene.subscribe((s, prev) => {
      const t = intentTarget(s, prev, focusPoint);
      if (t && !viewer.isDestroyed()) {
        onMoved?.();
        go(viewer, t.sphere, t.rangeM);
      }
    });
  }, [viewer, focusPoint, onMoved]);
}
