import * as THREE from "three";

/**
 * Split-screen layout for the navigation compare (demo polish B8, spec §5.3, AC-N2): the visible
 * map (the canvas less the side panel's overlap `panelPx`) is cut into two halves of equal width
 * (±1 px). Each half is drawn by its own camera through the one composer, so both render rects
 * have the same size (`renderW` × h): the right one runs on under the panel, the left one starts
 * left of the canvas (a negative viewport x) when there is a panel. A view offset puts each
 * camera's centre on the middle of its visible half. Pure (CSS px).
 */
export interface SplitSide {
  /** Visible half: x and width in canvas CSS px. */
  x: number;
  w: number;
  /** Render rect (renderer.setViewport) x; its width is the layout's `renderW`. */
  vx: number;
  /** View offset x of the side camera inside its render rect (0 without a panel). */
  offX: number;
}

export interface SplitLayout {
  /** Canvas CSS size. */
  size: [number, number];
  /** Width of each render rect (the composer's width while split). */
  renderW: number;
  left: SplitSide;
  right: SplitSide;
}

export function splitLayout(w: number, h: number, panelPx = 0): SplitLayout {
  const W = Math.max(2, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const vis = Math.max(2, Math.min(W, Math.round(W - Math.max(0, panelPx))));
  const half = Math.round(vis / 2);
  const renderW = W - half;
  // the right rect [half, W] shows [half, vis]: its principal point moves left by (renderW - wR)/2
  const wR = vis - half;
  return {
    size: [W, H],
    renderW,
    left: { x: 0, w: half, vx: half - renderW, offX: (half - renderW) / 2 },
    right: { x: half, w: wR, vx: half, offX: (renderW - wR) / 2 },
  };
}

/** The visible halves as the overlay reads them (`CompareScreen.viewports`). */
export function splitViewports(l: SplitLayout) {
  return { left: { x: l.left.x, w: l.left.w }, right: { x: l.right.x, w: l.right.w } };
}

/** Which half a canvas x (CSS px) falls in. */
export function sideAt(l: SplitLayout, x: number): "left" | "right" {
  return x < l.right.x ? "left" : "right";
}

/** Gives `cam` the projection it is drawn with in `side`'s render rect (aspect, view offset). */
export function applySideProjection(
  cam: THREE.PerspectiveCamera,
  l: SplitLayout,
  side: "left" | "right",
): void {
  const s = l[side];
  const h = l.size[1];
  cam.aspect = l.renderW / h;
  if (s.offX !== 0) cam.setViewOffset(l.renderW, h, s.offX, 0, l.renderW, h);
  else cam.clearViewOffset();
  cam.updateProjectionMatrix();
}

/**
 * A camera whose projection maps the WHOLE canvas the way `side` is drawn: whole-canvas NDC picked
 * through it hit what that half shows (the shared picker computes NDC over the canvas). Canvas px X
 * is render-rect px X - vx, i.e. virtual px X - vx + offX of the side camera's frame.
 */
export function pickCameraFor(
  src: THREE.PerspectiveCamera,
  l: SplitLayout,
  side: "left" | "right",
  out = new THREE.PerspectiveCamera(),
): THREE.PerspectiveCamera {
  const s = l[side];
  const [W, H] = l.size;
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.fov = src.fov;
  out.near = src.near;
  out.far = src.far;
  out.aspect = l.renderW / H;
  out.setViewOffset(l.renderW, H, s.offX - s.vx, 0, W, H);
  out.updateProjectionMatrix();
  out.updateMatrixWorld(true);
  return out;
}

/**
 * Culling for two views at once: a box or sphere is in view when either camera's frustum holds it
 * (the instanced city and the decorative agents cull against the engine's frustum).
 */
export class UnionFrustum extends THREE.Frustum {
  readonly a = new THREE.Frustum();
  readonly b = new THREE.Frustum();
  override intersectsBox(box: THREE.Box3): boolean {
    return this.a.intersectsBox(box) || this.b.intersectsBox(box);
  }
  override intersectsSphere(s: THREE.Sphere): boolean {
    return this.a.intersectsSphere(s) || this.b.intersectsSphere(s);
  }
  override containsPoint(p: THREE.Vector3): boolean {
    return this.a.containsPoint(p) || this.b.containsPoint(p);
  }
  override intersectsObject(o: THREE.Object3D): boolean {
    return this.a.intersectsObject(o) || this.b.intersectsObject(o);
  }
  override intersectsSprite(s: THREE.Sprite): boolean {
    return this.a.intersectsSprite(s) || this.b.intersectsSprite(s);
  }
}
