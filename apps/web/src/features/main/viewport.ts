export const PANEL_INSET_PX = 16;

export const panelWidthPx = (viewportW: number) =>
  Math.round(Math.min(440, Math.max(360, viewportW * 0.3)));

export function visibleViewport(widthPx: number, panelPx: number, open: boolean) {
  const right = open ? widthPx - panelPx - PANEL_INSET_PX * 2 : widthPx;
  return { left: 0, right, centerX: right / 2 };
}

/**
 * PerspectiveFrustum.xOffset that moves the image so the camera's look point lands `shiftPx`
 * pixels LEFT of the canvas centre (the centre of the visible area when the panel is open).
 * Cesium's fov is horizontal when width > height, else vertical.
 */
export function frustumXOffset(
  shiftPx: number,
  widthPx: number,
  near: number,
  fovRad: number,
  heightPx: number,
): number {
  if (shiftPx === 0 || widthPx <= 0) return 0;
  const aspect = widthPx / Math.max(1, heightPx);
  const halfW = aspect >= 1 ? near * Math.tan(fovRad / 2) : near * Math.tan(fovRad / 2) * aspect;
  return (shiftPx / (widthPx / 2)) * halfW;
}
