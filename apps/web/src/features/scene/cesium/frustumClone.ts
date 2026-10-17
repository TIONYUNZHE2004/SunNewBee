/**
 * Cesium 1.146 bug workaround: `PerspectiveFrustum.prototype.clone` drops `xOffset`/`yOffset`.
 * The scene compares the camera with a clone every frame (`View.checkForCameraUpdates`), so with a
 * non-zero offset (the panel reserve shifts the look point left of the side panel) the camera never
 * matched its clone and requestRenderMode rendered every frame, idle or not (measured 2026-10-17:
 * 60 renders/s, no requestRender calls). Patched once, idempotently: clones keep both offsets.
 */
interface FrustumClass {
  prototype: {
    clone(this: Offsets, result?: Offsets): Offsets;
  };
}
interface Offsets {
  xOffset: number;
  yOffset: number;
}

const PATCHED = Symbol.for("tl.frustumClonePatched");

export function patchFrustumClone(PerspectiveFrustum: FrustumClass): void {
  const proto = PerspectiveFrustum.prototype as FrustumClass["prototype"] & {
    [PATCHED]?: true;
  };
  if (proto[PATCHED]) return;
  const clone = proto.clone;
  proto.clone = function (this: Offsets, result?: Offsets) {
    const out = clone.call(this, result);
    out.xOffset = this.xOffset;
    out.yOffset = this.yOffset;
    return out;
  };
  proto[PATCHED] = true;
}

type V3 = { x: number; y: number; z: number };
interface PickCamera {
  frustum: {
    xOffset?: number;
    yOffset?: number;
    fov?: number;
    offCenterFrustum?: { left: number; right: number; top: number; bottom: number; near: number };
  };
  positionWC: V3;
  directionWC: V3;
  rightWC: V3;
  upWC: V3;
  _scene: { canvas: { clientWidth: number; clientHeight: number } };
}
interface CameraClass {
  prototype: {
    getPickRay(
      this: PickCamera,
      windowPosition: { x: number; y: number },
      result?: { origin: V3; direction: V3 },
    ): { origin: V3; direction: V3 } | undefined;
  };
}

const PICK_PATCHED = Symbol.for("tl.cameraPickRayPatched");

/**
 * Cesium 1.146 `Camera.getPickRay` builds perspective rays from fovy/aspect only and ignores the
 * frustum's xOffset/yOffset, while rendering (with patchFrustumClone) applies them: double-click
 * glide, zoom-to-cursor and drag anchors would land about half the panel width from the cursor.
 * For a perspective frustum with an offset, the ray is rebuilt through the off-centre frustum's
 * near plane (left/right/top/bottom), the same frustum the projection matrix comes from.
 * Patched once, idempotently; other frustums keep Cesium's ray.
 */
export function patchCameraPickRay(Camera: CameraClass): void {
  const proto = Camera.prototype as CameraClass["prototype"] & { [PICK_PATCHED]?: true };
  if (proto[PICK_PATCHED]) return;
  const getPickRay = proto.getPickRay;
  proto.getPickRay = function (this: PickCamera, windowPosition, result) {
    const ray = getPickRay.call(this, windowPosition, result);
    const f = this.frustum;
    if (!ray || f.fov === undefined || (!f.xOffset && !f.yOffset)) return ray;
    const o = f.offCenterFrustum;
    if (!o) return ray;
    const { clientWidth: w, clientHeight: h } = this._scene.canvas;
    const u = windowPosition.x / w; // 0 at left, 1 at right
    const v = 1 - windowPosition.y / h; // 0 at bottom, 1 at top
    const sx = o.left + (o.right - o.left) * u;
    const sy = o.bottom + (o.top - o.bottom) * v;
    const { directionWC: d, rightWC: r, upWC: up } = this;
    const x = d.x * o.near + r.x * sx + up.x * sy;
    const y = d.y * o.near + r.y * sx + up.y * sy;
    const z = d.z * o.near + r.z * sx + up.z * sy;
    const len = Math.hypot(x, y, z) || 1;
    ray.direction.x = x / len;
    ray.direction.y = y / len;
    ray.direction.z = z / len;
    return ray;
  };
  proto[PICK_PATCHED] = true;
}
