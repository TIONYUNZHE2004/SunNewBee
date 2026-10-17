import { diffLines } from "../../whatif/whatifModel";
import type { LonLat } from "../geo";
import type { SceneState } from "../sceneStore";
import { createFrame } from "./frame";

export interface CameraGoal {
  centre: LonLat;
  rangeM: number;
}

export type IntentSlice = Pick<
  SceneState,
  "route" | "focusRouteRequest" | "whatIf" | "focusPlaceId" | "camera"
>;

const MIN_RANGE_M = 300;
const PLACE_RANGE_M = 400;

/** Centre of the bounding circle (in the local frame); rangeM = max(radius x 2.5, 300). */
export function boundsGoal(points: LonLat[]): CameraGoal | null {
  const pts = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const centre: LonLat = [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
  const frame = createFrame(centre);
  let radius = 0;
  for (const p of pts) {
    const [x, z] = frame.toLocal(p[0], p[1]);
    radius = Math.max(radius, Math.hypot(x, z));
  }
  return { centre, rangeM: Math.max(radius * 2.5, MIN_RANGE_M) };
}

/** Same precedence as cesium/camera.ts: new route, route re-focus, new what-if, new place focus, new camera. */
export function intentGoal(
  s: IntentSlice,
  prev: IntentSlice,
  focusPoint: (id: string) => LonLat | null,
): CameraGoal | null {
  if (s.route && s.route !== prev.route) {
    return boundsGoal(s.route.geojson.coordinates as LonLat[]);
  }
  if (
    s.focusRouteRequest &&
    s.focusRouteRequest !== prev.focusRouteRequest &&
    s.route?.id === s.focusRouteRequest
  ) {
    return boundsGoal(s.route.geojson.coordinates as LonLat[]);
  }
  if (s.whatIf && s.whatIf !== prev.whatIf) {
    const lines = diffLines(s.whatIf.geojson as never);
    return boundsGoal([...lines.after, ...lines.before, ...lines.touched].flat() as LonLat[]);
  }
  if (s.focusPlaceId && s.focusPlaceId !== prev.focusPlaceId) {
    const c = focusPoint(s.focusPlaceId);
    return c ? { centre: c, rangeM: PLACE_RANGE_M } : null;
  }
  if (s.camera && s.camera !== prev.camera) {
    return { centre: s.camera.center, rangeM: s.camera.rangeM };
  }
  return null;
}
