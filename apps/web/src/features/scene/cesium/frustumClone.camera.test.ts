import * as Cesium from "cesium";
import { describe, expect, it } from "vitest";
import { patchCameraPickRay, patchFrustumClone } from "./frustumClone";

/** Enough of a scene for Cesium's Camera (no WebGL). */
function camera(xOffset: number, yOffset = 0) {
  const scene = {
    canvas: { clientWidth: 1200, clientHeight: 800 },
    drawingBufferWidth: 1200,
    drawingBufferHeight: 800,
    mapProjection: new Cesium.GeographicProjection(),
    mapMode2D: Cesium.MapMode2D.INFINITE_SCROLL,
    ellipsoid: Cesium.Ellipsoid.WGS84,
  };
  const cam = new Cesium.Camera(scene as never);
  const f = cam.frustum as Cesium.PerspectiveFrustum;
  f.fov = 0.8;
  f.aspectRatio = 1.5;
  f.near = 0.1;
  f.far = 1e7;
  f.xOffset = xOffset;
  f.yOffset = yOffset;
  cam.setView({
    destination: Cesium.Cartesian3.fromDegrees(101.5, 3.17, 700),
    orientation: { heading: 0.3, pitch: Cesium.Math.toRadians(-35), roll: 0 },
  });
  return { cam, scene };
}

/** Where `p` lands on the canvas through the camera's view and (offset) projection matrices. */
function project(cam: Cesium.Camera, p: Cesium.Cartesian3, w: number, h: number) {
  const view = Cesium.Matrix4.multiplyByPoint(cam.viewMatrix, p, new Cesium.Cartesian3());
  const clip = Cesium.Matrix4.multiplyByVector(
    cam.frustum.projectionMatrix,
    new Cesium.Cartesian4(view.x, view.y, view.z, 1),
    new Cesium.Cartesian4(),
  );
  return new Cesium.Cartesian2(
    ((clip.x / clip.w + 1) / 2) * w,
    (1 - (clip.y / clip.w + 1) / 2) * h,
  );
}

describe("patchCameraPickRay", () => {
  it("with an x/y offset the pick ray through a pixel hits the point rendered at that pixel", () => {
    patchFrustumClone(Cesium.PerspectiveFrustum as never);
    patchCameraPickRay(Cesium.Camera as never);
    const { cam } = camera(0.0149, -0.004);
    const target = Cesium.Cartesian3.fromDegrees(101.503, 3.18, 0);
    const px = project(cam, target, 1200, 800);
    expect(px.x).toBeGreaterThan(0);
    expect(px.x).toBeLessThan(1200);
    const ray = cam.getPickRay(px)!;
    const toTarget = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(target, ray.origin, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    expect(Cesium.Cartesian3.angleBetween(ray.direction, toTarget)).toBeLessThan(1e-6);
  });

  it("without an offset Cesium's own ray is kept", () => {
    patchCameraPickRay(Cesium.Camera as never);
    const { cam } = camera(0);
    const target = Cesium.Cartesian3.fromDegrees(101.503, 3.18, 0);
    const ray = cam.getPickRay(project(cam, target, 1200, 800))!;
    const toTarget = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(target, ray.origin, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    expect(Cesium.Cartesian3.angleBetween(ray.direction, toTarget)).toBeLessThan(1e-6);
  });

  it("is idempotent", () => {
    patchCameraPickRay(Cesium.Camera as never);
    const once = Cesium.Camera.prototype.getPickRay;
    patchCameraPickRay(Cesium.Camera as never);
    expect(Cesium.Camera.prototype.getPickRay).toBe(once);
  });
});
