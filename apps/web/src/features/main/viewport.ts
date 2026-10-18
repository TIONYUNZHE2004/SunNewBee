export const PANEL_INSET_PX = 16;
/** Padding around and gap between the frame's rail, map card and assistant card. */
export const FRAME_GAP_PX = 12;

export const panelWidthPx = (viewportW: number) =>
  Math.round(Math.min(420, Math.max(360, viewportW * 0.28)));

/** The assistant docks beside the map card (UI redesign, Oct 2026): it no longer floats over the
 * map, so it covers none of it. */
export const PANEL_DOCKED = true;

/** Map width the assistant panel covers, for the renderers' look-point offset (0 when docked). */
export function mapPanelOverlapPx(panelOpen: boolean, wide: boolean, viewportW: number): number {
  if (PANEL_DOCKED || !wide || !panelOpen) return 0;
  return panelWidthPx(viewportW) + PANEL_INSET_PX * 2;
}

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
