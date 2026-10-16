import type * as Cesium from "cesium";
import type { Framing } from "../home";
import { moveVector, orbitStep, STEP } from "./cameraMath";

export interface CameraOps {
  orbit(dHeading: number, dPitch: number): void;
  move(right: number, forward: number): void;
  zoom(factor: number): void;
  faceNorth(): void;
  home(): void;
  whole(): void;
  headingRad(): number;
}

type Bbox = [number, number, number, number];

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Camera actions shared by the buttons, the keyboard and double-click. */
export function createCameraOps(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  getFraming: () => Framing,
  getBbox: () => Bbox,
): CameraOps {
  const { scene } = viewer;
  const camera = scene.camera;

  /** Ground point at the screen centre, else straight below the camera. */
  const pivot = (): Cesium.Cartesian3 => {
    const c = scene.canvas;
    const hit = camera.pickEllipsoid(new C.Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
    if (hit) return hit;
    const g = camera.positionCartographic;
    return C.Cartesian3.fromRadians(g.longitude, g.latitude, 0);
  };

  const orbitAbout = (dHeading: number, dPitch: number, zoomFactor = 1) => {
    const target = pivot();
    const range = C.Cartesian3.distance(camera.position, target);
    const next = orbitStep(
      { heading: camera.heading, pitch: camera.pitch, range },
      dHeading,
      dPitch,
      zoomFactor,
    );
    camera.lookAt(target, new C.HeadingPitchRange(next.heading, next.pitch, next.range));
    camera.lookAtTransform(C.Matrix4.IDENTITY);
    scene.requestRender();
  };

  const frame = (f: Framing, fly: boolean) => {
    const target = C.Cartesian3.fromDegrees(f.lon, f.lat, 0);
    const offset = new C.HeadingPitchRange(0, C.Math.toRadians(f.pitchDeg), f.range_m);
    const sphere = new C.BoundingSphere(target, 1);
    if (fly && !reducedMotion()) camera.flyToBoundingSphere(sphere, { offset, duration: 1.2 });
    else camera.viewBoundingSphere(sphere, offset);
    camera.lookAtTransform(C.Matrix4.IDENTITY);
    scene.requestRender();
  };

  return {
    orbit: (dh, dp) => orbitAbout(dh, dp),
    zoom: (factor) => orbitAbout(0, 0, factor),
    move(right, forward) {
      const h = camera.positionCartographic.height;
      const step = Math.max(10, h * STEP.moveShare);
      const [e, n] = moveVector(camera.heading, right * step, forward * step);
      const enu = C.Transforms.eastNorthUpToFixedFrame(camera.position);
      const dir = C.Matrix4.multiplyByPointAsVector(
        enu,
        new C.Cartesian3(e, n, 0),
        new C.Cartesian3(),
      );
      const len = C.Cartesian3.magnitude(dir);
      if (len > 0) camera.move(C.Cartesian3.normalize(dir, dir), len);
      scene.requestRender();
    },
    faceNorth: () => orbitAbout(-camera.heading, 0),
    home: () => frame(getFraming(), true),
    whole() {
      const [w, s, e, n] = getBbox();
      const dest = C.Rectangle.fromDegrees(w, s, e, n);
      const orientation = { heading: 0, pitch: C.Math.toRadians(-50), roll: 0 };
      if (reducedMotion()) camera.setView({ destination: dest, orientation });
      else camera.flyTo({ destination: dest, orientation, duration: 1.2 });
      scene.requestRender();
    },
    headingRad: () => camera.heading,
  };
}

/** Frame without animation (initial home view). */
export function frameNow(C: typeof Cesium, viewer: Cesium.Viewer, f: Framing) {
  viewer.camera.lookAt(
    C.Cartesian3.fromDegrees(f.lon, f.lat, 0),
    new C.HeadingPitchRange(0, C.Math.toRadians(f.pitchDeg), f.range_m),
  );
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}
