import * as THREE from "three";
import { buildingIdOf } from "./assets/cityInstances";
import { faceBuildingId } from "./cityMesh";
import { markerIdAt } from "./overlays/markers";
import { residentIdAt } from "./overlays/residents";
import { signIdAt } from "./signs/signLayer";

export type PickHit =
  | { kind: "place"; id: string }
  | { kind: "evac"; id: string }
  | { kind: "waste"; id: string }
  | { kind: "sign"; id: string }
  | { kind: "landmark"; id: string }
  | { kind: "resident"; id: string }
  | { kind: "floodEdge"; id: string }
  | { kind: "building"; id: string };
type Kind = PickHit["kind"];

/** First wins. */
export const PICK_PRIORITY: readonly Kind[] = [
  "place",
  "evac",
  "waste",
  "sign",
  "landmark",
  "resident",
  "floodEdge",
  "building",
];
/** A flood edge is hit within this many CSS pixels of its line. */
export const LINE_PICK_PX = 8;
/** Slack around a marker disc (its radius plus the 2 px outline), in CSS pixels. */
export const MARKER_SLACK_PX = 3;
const MARKER_OUTLINE_PX = 2;
/**
 * Main-scene picks (sign, landmark, building) are depth tested against each other: a sign or
 * landmark more than this far behind the nearest pickable surface is hidden by it. A sign on its
 * own facade (a few centimetres out) still wins over the building by priority.
 */
export const OCCLUDE_TOLERANCE_M = 1;
const MAIN_KINDS = new Set<Kind>(["sign", "landmark", "building"]);
const KINDS = new Set<string>(PICK_PRIORITY);

interface Candidate {
  id: string;
  /** Depth in metres (meshes) or screen distance in px (markers, lines); lower is better. */
  score: number;
  depth: number | null;
}

const ray = new THREE.Raycaster();
const _v4 = new THREE.Vector4();
const _v4b = new THREE.Vector4();
const _vp = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/** Clip-space projection of a world point to CSS pixels; null when it is behind the camera. */
function toScreen(
  p: THREE.Vector3,
  out: THREE.Vector4,
  view: { width: number; height: number },
): THREE.Vector4 | null {
  out.set(p.x, p.y, p.z, 1).applyMatrix4(_vp);
  if (out.w <= 0) return null;
  out.set(((out.x / out.w + 1) * view.width) / 2, ((1 - out.y / out.w) * view.height) / 2, 0, 1);
  return out;
}

function segDistance(px: number, py: number, a: THREE.Vector4, b: THREE.Vector4): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** The id behind a mesh intersection, through the object's batch table. */
function meshId(kind: Kind, obj: THREE.Object3D, hit: THREE.Intersection): string | null {
  const own = (obj.userData.pick as { id?: unknown }).id;
  if (typeof own === "string") return own;
  if (kind === "sign") return signIdAt(obj, hit.faceIndex);
  if (kind === "resident")
    return hit.instanceId === undefined ? null : residentIdAt(obj, hit.instanceId);
  if (kind === "building") {
    if (hit.instanceId !== undefined) {
      const unit = (obj.userData.ids as string[] | undefined)?.[hit.instanceId];
      return unit ? buildingIdOf(unit) : null;
    }
    return faceBuildingId(obj.userData.faces, hit.faceIndex);
  }
  return null;
}

/**
 * Priority (first wins): place > evac > waste > sign > landmark > resident > floodEdge (within 8 px)
 * > building. Only objects tagged `userData.pick = { kind }` are tested; objects with
 * userData.decorative (and everything under them) are never hit, and hidden subtrees are skipped.
 * Batched hits resolve through their tables: markers by index (screen distance to the disc), flood
 * edges by segment (screen distance to the line), signs by face, residents and instanced buildings
 * by instance (`#i` stripped), the extruded city by face. Overlay-scene data (markers, residents,
 * flood edges) is drawn on top, so no building ever occludes it. `viewport` is the canvas size in
 * CSS pixels (the NDC to pixel scale for markers and lines); without one (or at zero size) the
 * screen-space kinds (markers, flood edges) are not tested at all, never all hit.
 */
export function pickAt(
  ndc: { x: number; y: number },
  camera: THREE.Camera,
  roots: THREE.Object3D[],
  linePickPx: number = LINE_PICK_PX,
  viewport: { width: number; height: number } = { width: 0, height: 0 },
): PickHit | null {
  const screenOk = viewport.width > 0 && viewport.height > 0;
  camera.updateMatrixWorld();
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const cx = ((ndc.x + 1) * viewport.width) / 2;
  const cy = ((1 - ndc.y) * viewport.height) / 2;
  const best = new Map<Kind, Candidate>();
  const offer = (kind: Kind, c: Candidate) => {
    const prev = best.get(kind);
    if (!prev || c.score < prev.score) best.set(kind, c);
  };
  let nearestMain = Number.POSITIVE_INFINITY;

  const visit = (obj: THREE.Object3D) => {
    if (!obj.visible || obj.userData.decorative) return;
    const kind = (obj.userData.pick as { kind?: unknown } | undefined)?.kind;
    if (typeof kind === "string" && KINDS.has(kind)) test(obj, kind as Kind);
    for (const c of obj.children) visit(c);
  };

  const test = (obj: THREE.Object3D, kind: Kind) => {
    const points = obj as THREE.Points;
    if (points.isPoints) {
      if (!screenOk) return;
      const pos = points.geometry.getAttribute("position");
      const u = (points.material as THREE.ShaderMaterial).uniforms;
      const size = (u?.uSize?.value as number | undefined) ?? 0;
      const radius = size / 2 + MARKER_OUTLINE_PX + MARKER_SLACK_PX;
      for (let i = 0; i < pos.count; i++) {
        _p.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        const s = toScreen(_p, _v4, viewport);
        if (!s) continue;
        const d = Math.hypot(s.x - cx, s.y - cy);
        const id = d <= radius ? markerIdAt(obj, i) : null;
        if (id) offer(kind, { id, score: d, depth: null });
      }
      return;
    }
    const seg = obj.userData.segPos as Float32Array | undefined;
    if (seg) {
      if (!screenOk) return;
      const ids = obj.userData.segIds as string[] | undefined;
      for (let i = 0; i * 6 < seg.length; i++) {
        _p.set(
          seg[i * 6] as number,
          seg[i * 6 + 1] as number,
          seg[i * 6 + 2] as number,
        ).applyMatrix4(obj.matrixWorld);
        _q.set(
          seg[i * 6 + 3] as number,
          seg[i * 6 + 4] as number,
          seg[i * 6 + 5] as number,
        ).applyMatrix4(obj.matrixWorld);
        const a = toScreen(_p, _v4, viewport);
        const b = a && toScreen(_q, _v4b, viewport);
        if (!a || !b) continue;
        const d = segDistance(cx, cy, a, b);
        const id = d <= linePickPx ? ids?.[i] : undefined;
        if (id) offer(kind, { id, score: d, depth: null });
      }
      return;
    }
    if (!(obj as THREE.Mesh).isMesh) return;
    for (const hit of ray.intersectObject(obj, false)) {
      const id = meshId(kind, obj, hit);
      if (!id) continue;
      if (MAIN_KINDS.has(kind)) nearestMain = Math.min(nearestMain, hit.distance);
      offer(kind, { id, score: hit.distance, depth: hit.distance });
    }
  };

  for (const r of roots) {
    r.updateMatrixWorld();
    visit(r);
  }
  for (const kind of PICK_PRIORITY) {
    const c = best.get(kind);
    if (!c) continue;
    if (
      (kind === "sign" || kind === "landmark") &&
      c.depth !== null &&
      c.depth > nearestMain + OCCLUDE_TOLERANCE_M
    )
      continue;
    return { kind, id: c.id };
  }
  return null;
}

/** The scene-store actions a pick dispatches to. */
export interface PickActions {
  selectPlace(id: string): void;
  selectFloodEdge(id: string): void;
  selectSign(id: string): void;
  selectBuilding(id: string): void;
  setDay(d: { focus: string }): void;
}

/**
 * A hit to its card or spotlight: place, flood edge and sign open their cards; a building or a
 * landmark opens the building card; a resident becomes the Day spotlight. An evacuation centre or
 * waste point opens the place card only when its id is a place (`isPlace`), else nothing.
 */
export function applyPick(hit: PickHit, a: PickActions, isPlace: (id: string) => boolean): void {
  switch (hit.kind) {
    case "place":
      a.selectPlace(hit.id);
      return;
    case "evac":
    case "waste":
      if (isPlace(hit.id)) a.selectPlace(hit.id);
      return;
    case "floodEdge":
      a.selectFloodEdge(hit.id);
      return;
    case "sign":
      a.selectSign(hit.id);
      return;
    case "building":
    case "landmark":
      a.selectBuilding(hit.id);
      return;
    case "resident":
      a.setDay({ focus: hit.id });
      return;
  }
}
