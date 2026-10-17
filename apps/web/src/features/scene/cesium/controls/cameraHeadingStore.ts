import { create } from "zustand";

/** Camera heading for the compass. Written from Cesium's camera listener, read only by the compass,
 * so a camera move never re-renders the Viewer subtree. */
export const useCameraHeading = create<{ heading: number }>(() => ({ heading: 0 }));

interface HeadingCamera {
  heading: number;
  percentageChanged: number;
  changed: { addEventListener(cb: () => void): () => void };
}

/** Pushes the camera heading into the store now and on every camera change; returns the unsubscribe. */
export function trackHeading(camera: HeadingCamera): () => void {
  camera.percentageChanged = 0.01;
  const push = () => useCameraHeading.setState({ heading: camera.heading });
  push();
  return camera.changed.addEventListener(push);
}
