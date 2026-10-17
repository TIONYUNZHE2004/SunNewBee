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
