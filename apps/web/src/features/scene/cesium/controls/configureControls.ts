import type * as Cesium from "cesium";
import { clampPitch, clampToBounds, LIMITS } from "./cameraMath";
import type { CameraOps } from "./cameraOps";

type Bbox = [number, number, number, number];

/** Shift+wheel tilt: radians per wheel unit (a notch is ~100-120). */
const WHEEL_TILT = 0.0015;

/**
 * Mouse/touch mapping agreed with the owner:
 *   left-drag  = constant-height pan, grabbed point stays under the cursor (Cesium 3D "rotate")
 *   right-drag, middle-drag, ctrl+left-drag, two-finger = orbit about the point under the cursor
 *   wheel / pinch = zoom towards the cursor; shift+wheel = tilt; double-click = glide in.
 * Limits are enforced every frame so a drag stops at them (no snap back).
 */
export function configureControls(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  ops: CameraOps,
  getBbox: () => Bbox,
): () => void {
  const { scene } = viewer;
  const ssc = scene.screenSpaceCameraController;
  const E = C.CameraEventType;
  const K = C.KeyboardEventModifier;
  ssc.rotateEventTypes = E.LEFT_DRAG;
  ssc.tiltEventTypes = [
    E.RIGHT_DRAG,
    E.MIDDLE_DRAG,
    E.PINCH,
    { eventType: E.LEFT_DRAG, modifier: K.CTRL },
  ];
  ssc.zoomEventTypes = [E.WHEEL, E.PINCH];
  ssc.lookEventTypes = undefined as unknown as Cesium.CameraEventType;
  ssc.minimumZoomDistance = LIMITS.minRangeM;
  ssc.maximumZoomDistance = LIMITS.maxRangeM;
  ssc.enableCollisionDetection = true;

  // The viewer's default double-click tracks entities; replace it with "glide in".
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  );
  const handler = new C.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction(
    (delta: number) => ops.orbit(0, -delta * WHEEL_TILT),
    C.ScreenSpaceEventType.WHEEL,
    K.SHIFT,
  );
  handler.setInputAction(
    (e: { position: Cesium.Cartesian2 }) => ops.glideTo(e.position),
    C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  );

  const camera = scene.camera;
  const offLimits = scene.preUpdate.addEventListener(() => {
    const p = clampPitch(camera.pitch);
    const g = camera.positionCartographic;
    const lon = C.Math.toDegrees(g.longitude);
    const lat = C.Math.toDegrees(g.latitude);
    const [cl, ca] = clampToBounds(lon, lat, getBbox(), LIMITS.boundsMarginM);
    const moved = cl !== lon || ca !== lat;
    if (p === camera.pitch && !moved) return;
    camera.setView({
      destination: moved
        ? C.Cartesian3.fromRadians(C.Math.toRadians(cl), C.Math.toRadians(ca), g.height)
        : undefined,
      orientation: { heading: camera.heading, pitch: p, roll: 0 },
    });
  });

  return () => {
    offLimits();
    if (!handler.isDestroyed?.()) handler.destroy();
  };
}
