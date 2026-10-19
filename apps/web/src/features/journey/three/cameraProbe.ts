import * as THREE from "three";
import type { Clearance, Vec3 } from "../../scene/three/clearance";
import { buildingMeshes, roofHit } from "../../scene/three/scene/useAcceptanceHook";
import type { Rect } from "../cardPlacement";
import { boxOnScreen, heroBodyBox } from "./heroScreen";
import { projectToScreen } from "./project";

/**
 * What the journey camera shows, for the AC-D8 / AC-D9 acceptance sampling (`__journey.camera()`).
 * Test probe only: it is computed when asked, never per frame.
 */
export interface CameraProbe {
  driven: boolean;
  /** The journey t the drawn camera was computed for (null when not driven). */
  cameraT: number | null;
  camera: Vec3;
  /** The camera's view direction (unit). */
  forward: Vec3;
  /** The map area left of the side panel (CSS px): the frame the criteria use. */
  frame: { w: number; h: number };
  /** Her body and walker on screen (ground ring excluded), or null when behind the camera. */
  heroBox: Rect | null;
  /** The box inside the frame with a 10 % margin on every side. */
  heroInFrame: boolean;
  /** Metres from the camera to her body box (a lower bound of the distance to her mesh). */
  heroDistM: number | null;
  /** Building meshes between the camera and her chest / head / knees (grid pre-check, mesh raycast). */
  blocked: { chest: boolean; head: boolean; low: boolean };
  /**
   * She stands inside (or on the wall of) a building footprint: only where the planned route itself
   * crosses one (Harmoni 1 at the start, the Sales Gallery at ~831 m; coordinator ruling).
   */
  heroInFootprint: boolean;
  /** The camera inside a building: under the grid's roof where a drawn roof is above it. */
  insideBuilding: boolean;
  gridRoofM: number;
  meshRoofM: number | null;
  /** The current hold's element on screen (CSS px) and whether it is inside the frame. */
  element: { index: number; kind: string; x: number; y: number; inFrame: boolean } | null;
}

const _ray = new THREE.Raycaster();
const _probe = new THREE.Mesh();
const _inst = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

/** True when a drawn building or landmark mesh lies on the segment a -> b (per instance). */
export function meshBlocks(roots: THREE.Object3D[], a: Vec3, b: Vec3): boolean {
  _from.set(...a);
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  if (len < 1e-6) return false;
  _ray.set(_from, _dir.multiplyScalar(1 / len));
  _ray.near = 0;
  _ray.far = len;
  const hits: THREE.Intersection[] = [];
  for (const m of buildingMeshes(roots)) {
    const im = m as THREE.InstancedMesh;
    if (!im.isInstancedMesh) {
      // decorative meshes opt out of raycasting (`raycast` no-op): call the Mesh raycast
      THREE.Mesh.prototype.raycast.call(m, _ray, hits);
      if (hits.length) return true;
      continue;
    }
    _probe.geometry = im.geometry;
    _probe.material = im.material;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, _inst);
      _probe.matrixWorld.multiplyMatrices(im.matrixWorld, _inst);
      THREE.Mesh.prototype.raycast.call(_probe, _ray, hits);
      if (hits.length) return true;
    }
  }
  return false;
}

/**
 * The line of sight a -> b: clear when the footprint grid sees no building on it (the grid's
 * columns contain every drawn building, A-T7), else decided by a raycast of the drawn meshes.
 */
export function sightBlocked(
  c: Clearance | null,
  roots: THREE.Object3D[],
  a: Vec3,
  b: Vec3,
): boolean {
  if (c && !c.segmentHitsBuilding(a, b)) return false;
  return meshBlocks(roots, a, b);
}

export function probeCamera(opts: {
  camera: THREE.PerspectiveCamera;
  driven: boolean;
  cameraT: number | null;
  canvas: [number, number];
  frame: { w: number; h: number };
  hero: THREE.Object3D | null;
  roots: THREE.Object3D[];
  clearance: Clearance | null;
  element: { index: number; kind: string; point: Vec3 } | null;
}): CameraProbe {
  const cam = opts.camera;
  cam.updateMatrixWorld();
  const p: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
  const { w, h } = opts.frame;
  const box = opts.hero ? heroBodyBox(opts.hero) : null;
  const heroBox = box ? boxOnScreen(box, cam, opts.canvas) : null;
  const heroInFrame =
    !!heroBox &&
    heroBox.x >= 0.1 * w &&
    heroBox.x + heroBox.w <= 0.9 * w &&
    heroBox.y >= 0.1 * h &&
    heroBox.y + heroBox.h <= 0.9 * h;
  let blocked = { chest: false, head: false, low: false };
  let heroInFootprint = false;
  if (box) {
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const at = (k: number): Vec3 => [cx, box.min.y + (box.max.y - box.min.y) * k, cz];
    const root = opts.hero?.getWorldPosition(new THREE.Vector3());
    heroInFootprint = !!root && (opts.clearance?.maxRoofNear(root.x, root.z, 0.5) ?? 0) > 0;
    blocked = {
      chest: sightBlocked(opts.clearance, opts.roots, p, at(0.6)),
      head: sightBlocked(opts.clearance, opts.roots, p, at(0.95)),
      low: sightBlocked(opts.clearance, opts.roots, p, at(0.2)),
    };
  }
  const gridRoofM = opts.clearance?.topAt(p[0], p[2]) ?? 0;
  // the grid contains every drawn building: only under a grid roof can a drawn roof be above
  const meshRoofM = gridRoofM > p[1] ? roofHit(opts.roots, p[0], p[2]) : null;
  const insideBuilding = meshRoofM !== null && meshRoofM > p[1];
  let element: CameraProbe["element"] = null;
  if (opts.element) {
    const s = projectToScreen(cam, opts.element.point, opts.canvas);
    element = {
      index: opts.element.index,
      kind: opts.element.kind,
      x: s?.x ?? Number.NaN,
      y: s?.y ?? Number.NaN,
      inFrame: !!s && s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h,
    };
  }
  return {
    driven: opts.driven,
    cameraT: opts.cameraT,
    camera: p,
    forward: cam.getWorldDirection(new THREE.Vector3()).toArray() as Vec3,
    frame: { w, h },
    heroBox,
    heroInFrame,
    heroDistM: box ? box.distanceToPoint(cam.position) : null,
    blocked,
    heroInFootprint,
    insideBuilding,
    gridRoofM,
    meshRoofM,
    element,
  };
}
