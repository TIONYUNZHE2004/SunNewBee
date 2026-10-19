import { useEffect } from "react";
import * as THREE from "three";
import { fitCost, fitFor, overviewPose, rangeNeededM } from "../cameraFit";
import { createHeroLab, type HeroLab } from "../characters/heroLab";
import type { Engine } from "../engine";
import { dressingFadeProbe } from "../fadeProbe";
import type { LocalFrame } from "../frame";
import { createFrameStats, type PerfSample } from "../frameStats";
import { type Boundary, insideBoundary, outsideBy, type P } from "../ground/boundary";
import { pickAt } from "../pick";

/**
 * Test-only window hook for the acceptance harness (`apps/web/acceptance`). Exposed as
 * `window.__tlAcceptance` only in dev builds (`import.meta.env.DEV`) or when the page is loaded
 * with `?acceptance=1`. It reads the scene and moves the camera; it never changes data, intents
 * or settings.
 */
export const ACCEPTANCE_GLOBAL = "__tlAcceptance";

export function acceptanceEnabled(dev: boolean, search: string): boolean {
  return dev || new URLSearchParams(search).get("acceptance") === "1";
}

/** What a screen pixel shows, for pick masks. `other`: a sign or decorative pick (resident). */
export type MaskKind = "sky" | "ground" | "road" | "building" | "other";
const CODES: Record<MaskKind, string> = {
  sky: ".",
  ground: "g",
  road: "r",
  building: "b",
  other: "o",
};
export const maskCode = (k: MaskKind): string => CODES[k];

/** Frame gaps over this are idle time under render-on-demand (as in `frameStats.ts`). */
const IDLE_GAP_MS = 500;

export interface FrameSummary {
  frames: number;
  medianFps: number;
  meanFps: number;
  p95FrameMs: number;
}

/** Median / mean fps and p95 frame time from frame gaps (ms); idle gaps are dropped. */
export function frameSummary(dts: readonly number[]): FrameSummary {
  const d = dts.filter((t) => t > 0 && t <= IDLE_GAP_MS).sort((a, b) => a - b);
  if (d.length === 0) return { frames: 0, medianFps: 0, meanFps: 0, p95FrameMs: 0 };
  const mid = d.length / 2;
  const median =
    d.length % 2
      ? (d[Math.floor(mid)] as number)
      : ((d[mid - 1] as number) + (d[mid] as number)) / 2;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const p95 = d[Math.min(d.length - 1, Math.ceil(d.length * 0.95) - 1)] as number;
  return { frames: d.length, medianFps: 1000 / median, meanFps: 1000 / mean, p95FrameMs: p95 };
}

export interface GeoPose {
  lon: number;
  lat: number;
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
}

export interface Measurement extends FrameSummary {
  /** The last throttled sample from `three/frameStats.ts` (as on the perf line). */
  perf: Partial<PerfSample> | null;
}

export interface PoseLogRow {
  t: number;
  x: number;
  z: number;
  lon: number;
  lat: number;
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
  fov: number;
  inside: boolean | null;
  fitReady: boolean;
}

export interface AcceptanceApi {
  setPose(p: GeoPose): void;
  getPose(): GeoPose;
  /** Canvas size in CSS pixels. */
  size(): [number, number];
  /** Rendered frame count (render on demand). */
  frames(): number;
  /** One mask code per cell, row-major, sampled at cell centres every `step` CSS pixels. */
  pickGrid(step: number): { step: number; cols: number; rows: number; codes: string };
  /**
   * Frame stats over `seconds`, orbiting the target at `orbitDegPerSec` (0: still camera; every
   * frame is then forced so the frame loop runs).
   */
  measure(seconds: number, orbitDegPerSec: number): Promise<Measurement>;
  /**
   * Uncapped frame time (headroom): `frames` frames rendered back to back with `renderNow` and a
   * `gl.finish()` each (CPU + GPU time, no vsync wait), turning `orbitDegPerFrame` per frame. Blocks
   * the main thread. The pose is restored afterwards, as it is after `measure`.
   */
  measureUncapped(frames: number, orbitDegPerFrame: number): UncappedMeasurement;
  /** C-T4 hero test scene (H5-H7, H11): a footway and bench at the camera target with the GLB hero. */
  heroLab(): HeroLab;
  /** Vertices in the visible road-surface meshes: the streamed road layer has arrived when > 0. */
  roadVertices(): number;
  /** The scene's live fog (colour as #rrggbb sRGB, distances in metres) and background colour; null when fog is off. */
  fog(): { color: string; near: number; far: number; background: string } | null;
  /** Lamp-pool centres on screen (page-independent canvas CSS pixels), those inside the canvas only. */
  lampPoints(): { x: number; y: number }[];
  /** AC-B9: the decorative dressing's current fade level (largest drawn weight, 0..1) and drawn count. */
  dressingFade(): { maxW: number; decor: number };
  /**
   * Shows or hides the data-overlay scene (access lines, flood tint: `pickView().roots[0]`) so a capture
   * can measure the surface under them. Display only; the lines' own fade is A-T2's.
   */
  setOverlaysVisible(visible: boolean): void;
  /**
   * Decorative agents that currently have instance matrices (inside the frustum plus the layer's
   * 50 m margin): one row per instance with its kit, variant, LOD bucket, distance, display scale,
   * projected head and feet (canvas CSS pixels) and whether a pickable surface (building, tree)
   * lies between the camera and the head. `planned` counts the agents the layer was built with.
   */
  crowd(): CrowdReport;
  /**
   * Test-only: draws the line batches of `renderOrder` always on top (depthTest false) or restores
   * depth testing. Returns the batches changed. For on-top vs depth-tested comparisons.
   */
  linesOnTop(renderOrder: number, on: boolean): number;
  /** The unmasked WebGL vendor and renderer (WEBGL_debug_renderer_info), else the masked ones. */
  gpu(): { vendor: string; renderer: string };
  /** Which post effects run now (B-T5 AC-B5): tilt-shift depth of field and AO. */
  effects(): { dof: boolean; ao: boolean };
  /** The depth-of-field focus point on the canvas (CSS px), null behind the camera (AC-B4). */
  focusScreen(): { x: number; y: number } | null;
  /** The building-clearance grid in use (A-T7), or null before the city arrives. Read-only. */
  clearance(): { count: number; clearanceM: number; maxTopM: number } | null;
  /** Top of the tallest drawn footprint containing local (x, z), 0 when none, null without a grid. */
  footprintTop(x: number, z: number): number | null;
  /** The camera position in the local frame (x east, y up, z = -north). */
  cameraLocal(): [number, number, number];
  /** Starts logging the camera against the footprint lookup on every rendered frame (AC-A8). */
  startCameraLog(): void;
  /** Stops the log and returns its summary (zeros when no log was running). */
  stopCameraLog(): CameraLog;
  /** Metres the building clearance lifts the camera above its base pose now (0: none). */
  liftM(): number;
  /** Local frame conversions (metres: x east, z = -north). */
  toLocal(lon: number, lat: number): [number, number];
  toLonLat(x: number, z: number): [number, number];
  /** True when local (x, z) lies inside the slab outline (A-T5 camera bound); null without a slab. */
  insideOutline(x: number, z: number): boolean | null;
  /** The camera's current vertical field of view (deg): it widens towards max range (A-T5). */
  fovDeg(): number;
  /**
   * Starts logging the base camera pose on every rendered engine frame (inside the engine's own
   * frame callback, so no sampling-order artefacts): A-T5 flight / landing smoothness checks.
   */
  startPoseLog(): void;
  /** Stops the pose log and returns its rows (local x, z; deg; ms on the performance clock). */
  stopPoseLog(): PoseLogRow[];
  /** The overview derived from the slab outline (`cameraFit.ts` overviewPose); null without a slab. */
  overviewPose(): GeoPose | null;
  /** The slab camera fit's reports (A-T5): fov the max-range window needs, range needed to fit. */
  fitReport(): { axisHeadingDeg: number; costDeg: number; rangeNeededM: number } | null;
  /** Test-only: the camera fit computed synchronously once (ms), for the long-task report; null without a slab. */
  timeFitSyncMs(): number | null;
  /** A rig flight to a pose (as the app's fly-to intents do). */
  flyTo(p: GeoPose, durationMs: number): void;
  /**
   * Independent of the clearance grid: the highest drawn building surface (extruded city,
   * archetype instances, landmarks, decorative ones included) under local (x, z), by a vertical
   * ray from above against the meshes themselves; 0 when the ray hits none.
   */
  roofHitAt(x: number, z: number): number;
  /**
   * Independent check of the grid against the drawn instances: for up to `maxSamples` archetype /
   * landmark instances, the world AABB of the instance's geometry (covers glb centring and scale)
   * against the grid's roof at the AABB centre. A fail: grid roof < AABB top − 0.01 m.
   */
  instanceAudit(maxSamples: number): InstanceAudit;
  /**
   * The diorama slab's top outline (A-T4) projected to canvas CSS pixels, one array per ring, with
   * the local position of each vertex; null when no slab is drawn. `inFront`: in front of the camera.
   */
  slabOutline():
    | {
        x: number;
        y: number;
        lx: number;
        lz: number;
        inFront: boolean;
        /** The outer bottom corner of the soil section below this vertex, projected. */
        foot: { x: number; y: number };
      }[][]
    | null;
  /**
   * AC-A5 live audit: how far outside the slab outline (m) the drawn display geometry of the main
   * scene reaches. Every used vertex of each visible mesh (world xz) and every visible instance's
   * origin is measured; the slab itself, the sky, the hidden base plane and the data overlays
   * (overlay scene, flood ground slot) are left out. null when no slab is drawn.
   */
  displayAudit(): DisplayAudit | null;
}

export interface DisplayAudit {
  meshes: number;
  vertices: number;
  instances: number;
  /** Worst distance outside (m) over mesh vertices, and over instance origins. */
  worstVertexM: number;
  worstInstanceM: number;
  /** The objects with anything more than 5 m outside: name and worst distance. */
  over: { name: string; outsideM: number }[];
}

const AUDIT_SKIP = new Set(["slab", "sky", "base-plane", "flood-ground-slot"]);

function displayAudit(engine: Engine): DisplayAudit | null {
  const v = engine.pickView();
  const slab = slabOf(v.roots);
  const b = slab?.userData.boundary as Boundary | undefined;
  if (!b) return null;
  const main = v.roots[v.roots.length - 1]!;
  main.updateMatrixWorld(true);
  const out: DisplayAudit = {
    meshes: 0,
    vertices: 0,
    instances: 0,
    worstVertexM: 0,
    worstInstanceM: 0,
    over: [],
  };
  const p = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const visit = (o: THREE.Object3D, path: string) => {
    if (!o.visible || AUDIT_SKIP.has(o.name)) return;
    const name = `${path}/${o.name || o.type}`;
    let worst = 0;
    const im = o as THREE.InstancedMesh;
    const mesh = o as THREE.Mesh;
    if (im.isInstancedMesh) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        // A hidden instance has a zero-scale matrix (decompose would report scale 1 for it).
        const e = m.elements;
        if (e[0] === 0 && e[1] === 0 && e[2] === 0 && e[5] === 0 && e[10] === 0) continue;
        m.premultiply(im.matrixWorld).decompose(p, q, sc);
        out.instances++;
        worst = Math.max(worst, outsideBy(b, p.x, p.z));
      }
      out.worstInstanceM = Math.max(out.worstInstanceM, worst);
    } else if (mesh.isMesh) {
      const pos = mesh.geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (pos) {
        out.meshes++;
        const idx = mesh.geometry.getIndex();
        const seen = idx ? new Uint8Array(pos.count) : null;
        const n = idx ? idx.count : pos.count;
        for (let k = 0; k < n; k++) {
          const i = idx ? idx.getX(k) : k;
          if (seen) {
            if (seen[i]) continue;
            seen[i] = 1;
          }
          p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          out.vertices++;
          worst = Math.max(worst, outsideBy(b, p.x, p.z));
        }
        out.worstVertexM = Math.max(out.worstVertexM, worst);
      }
    }
    if (worst > 5) out.over.push({ name, outsideM: worst });
    for (const c of o.children) visit(c, name);
  };
  for (const c of main.children) visit(c, "");
  out.over.sort((x, y) => y.outsideM - x.outsideM);
  out.over = out.over.slice(0, 20);
  return out;
}

export interface CrowdRow {
  kind: "person" | "vehicle";
  variant: string;
  lod: number;
  distM: number;
  scale: number;
  /** Model height (m) from the manifest times the display scale. */
  heightM: number;
  head: { x: number; y: number } | null;
  feet: { x: number; y: number } | null;
  /** Head to feet in canvas pixels; null when behind the camera. */
  heightPx: number | null;
  inCanvas: boolean;
  /** A raycast camera -> head hits a non-decorative surface before the head. */
  occluded: boolean;
  /** Feet position (local metres; crowd people only): P10's bubble census around the hero. */
  x?: number;
  z?: number;
}

export interface CrowdReport {
  planned: { person: number; vehicle: number };
  rows: CrowdRow[];
}

export interface InstanceAudit {
  meshes: number;
  checked: number;
  fails: number;
  /** Largest AABB top above the grid roof (m); negative when every instance is under it. */
  worstM: number;
  /** Up to 10 fails: [x, z, aabbTop, gridTop, mesh name]. */
  samples: [number, number, number, number, string][];
}

/** Every rendered frame's camera checked against the footprint lookup (AC-A8). */
export interface CameraLog {
  frames: number;
  /** Frames whose camera was over a footprint (top > 0). */
  overRoof: number;
  /** Frames inside a footprint below roof + clearance. */
  violations: number;
  /** Largest shortfall below roof + clearance (m); 0 without violations. */
  worstDeficitM: number;
  /** Smallest height above roof + clearance over the frames over a roof (m); null when none. */
  minMarginM: number | null;
  minY: number;
  maxY: number;
  /** Up to 20 violating frames: [x, y, z, top]. */
  samples: [number, number, number, number][];
  /** Largest per-frame change of camera y (m), any cause (user input included). */
  maxDyM: number;
  /** Largest per-frame change of the clearance lift (m): the smoothness of the clearance itself. */
  maxLiftStepM: number;
  /** Frames the clearance lifted the camera (lift > 0). */
  liftedFrames: number;
  /** Mesh raycast checks (every RAY_EVERY frames, independent of the grid). */
  ray: RayLog;
  lastY: number | null;
  lastLiftM: number | null;
}

export interface RayLog {
  /** Frames checked by a vertical ray against the drawn building meshes. */
  checked: number;
  /** Checked frames whose ray hit a building surface under the camera. */
  hits: number;
  /** Hits where the camera was below the hit surface + clearance. */
  violations: number;
  /** Hits where the drawn surface was more than 1 cm above the grid's roof there. */
  gridBelowMesh: number;
  /** Largest drawn surface above the grid roof (m); negative when never above. */
  worstGridBelowM: number;
  /** Up to 10 ray violations: [x, y, z, hitY, gridTop]. */
  samples: [number, number, number, number, number][];
}

/** One mesh raycast every this many logged frames. */
export const RAY_EVERY = 30;

/** Folds one frame into a camera log (pure; `top` is the footprint lookup at the camera). */
export function logCameraFrame(
  log: CameraLog,
  pos: readonly [number, number, number],
  top: number,
  clearanceM: number,
  liftM = 0,
): void {
  log.frames++;
  log.minY = Math.min(log.minY, pos[1]);
  log.maxY = Math.max(log.maxY, pos[1]);
  if (log.lastY !== null) log.maxDyM = Math.max(log.maxDyM, Math.abs(pos[1] - log.lastY));
  if (log.lastLiftM !== null)
    log.maxLiftStepM = Math.max(log.maxLiftStepM, Math.abs(liftM - log.lastLiftM));
  log.lastY = pos[1];
  log.lastLiftM = liftM;
  if (liftM > 0) log.liftedFrames++;
  if (top <= 0) return;
  log.overRoof++;
  const margin = pos[1] - (top + clearanceM);
  log.minMarginM = log.minMarginM === null ? margin : Math.min(log.minMarginM, margin);
  // A float hair under the floor (lookAt round-off) is not a violation.
  if (margin < -1e-6) {
    log.violations++;
    log.worstDeficitM = Math.max(log.worstDeficitM, -margin);
    if (log.samples.length < 20) log.samples.push([pos[0], pos[1], pos[2], top]);
  }
}

/** Folds one mesh raycast into the log: `hitY` the drawn surface under the camera (0: none). */
export function logRoofRay(
  log: CameraLog,
  pos: readonly [number, number, number],
  hitY: number,
  gridTop: number,
  clearanceM: number,
): void {
  const r = log.ray;
  r.checked++;
  if (hitY <= 0) return;
  r.hits++;
  r.worstGridBelowM = Math.max(r.worstGridBelowM, hitY - gridTop);
  if (hitY > gridTop + 0.01) r.gridBelowMesh++;
  if (pos[1] < hitY + clearanceM - 1e-3) {
    r.violations++;
    if (r.samples.length < 10) r.samples.push([pos[0], pos[1], pos[2], hitY, gridTop]);
  }
}

export const emptyCameraLog = (): CameraLog => ({
  frames: 0,
  overRoof: 0,
  violations: 0,
  worstDeficitM: 0,
  minMarginM: null,
  minY: Number.POSITIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  samples: [],
  maxDyM: 0,
  maxLiftStepM: 0,
  liftedFrames: 0,
  ray: {
    checked: 0,
    hits: 0,
    violations: 0,
    gridBelowMesh: 0,
    worstGridBelowM: Number.NEGATIVE_INFINITY,
    samples: [],
  },
  lastY: null,
  lastLiftM: null,
});

const BUILDING_KINDS = new Set(["building", "landmark"]);

/** Visible building and landmark meshes (extruded city, archetype instances, landmarks). */
export function buildingMeshes(roots: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const kind = (o.userData.pick as { kind?: string } | undefined)?.kind;
    if ((o as THREE.Mesh).isMesh && kind && BUILDING_KINDS.has(kind)) out.push(o as THREE.Mesh);
    for (const c of o.children) visit(c);
  };
  for (const r of roots) visit(r);
  return out;
}

const _down = new THREE.Raycaster();
const _probe = new THREE.Mesh();
const _inst = new THREE.Matrix4();

/** Highest building surface hit by a vertical ray at (x, z); per instance, no scene state touched. */
export function roofHit(roots: THREE.Object3D[], x: number, z: number): number {
  _down.set(new THREE.Vector3(x, 10_000, z), new THREE.Vector3(0, -1, 0));
  _down.far = 20_000;
  const hits: THREE.Intersection[] = [];
  for (const m of buildingMeshes(roots)) {
    const im = m as THREE.InstancedMesh;
    if (!im.isInstancedMesh) {
      // Decorative meshes opt out of raycasting (`raycast` is a no-op): call the Mesh raycast.
      THREE.Mesh.prototype.raycast.call(m, _down, hits);
      continue;
    }
    _probe.geometry = im.geometry;
    _probe.material = im.material;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, _inst);
      _probe.matrixWorld.multiplyMatrices(im.matrixWorld, _inst);
      THREE.Mesh.prototype.raycast.call(_probe, _down, hits);
    }
  }
  let top = 0;
  for (const h of hits) if (h.point.y > top) top = h.point.y;
  return top;
}

export interface UncappedMeasurement {
  frames: number;
  medianFrameMs: number;
  p95FrameMs: number;
  /** 1000 / median frame ms: what the frame could reach without vsync. */
  fps: number;
}

/** Median and p95 of uncapped frame times (ms); zeros when empty. */
export function uncappedSummary(ms: readonly number[]): UncappedMeasurement {
  const d = [...ms].sort((a, b) => a - b);
  if (d.length === 0) return { frames: 0, medianFrameMs: 0, p95FrameMs: 0, fps: 0 };
  const mid = d.length / 2;
  const median =
    d.length % 2
      ? (d[Math.floor(mid)] as number)
      : ((d[mid - 1] as number) + (d[mid] as number)) / 2;
  const p95 = d[Math.min(d.length - 1, Math.ceil(d.length * 0.95) - 1)] as number;
  return { frames: d.length, medianFrameMs: median, p95FrameMs: p95, fps: 1000 / median };
}

const _ray = new THREE.Raycaster();
const _cm = new THREE.Matrix4();
const _cp = new THREE.Vector3();
const _cs = new THREE.Vector3();
const _cq = new THREE.Quaternion();
const _ch = new THREE.Vector3();

/** Kit model heights (m) by `kind/variant`, from the manifest-sized geometry bounding boxes. */
function modelHeight(mesh: THREE.InstancedMesh): number {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  return bb ? bb.max.y - bb.min.y : 0;
}

function crowdReport(engine: Engine): CrowdReport {
  const v = engine.pickView();
  const [w, h] = v.size;
  const planned = { person: 0, vehicle: 0 };
  const rows: CrowdRow[] = [];
  const blockers: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o.userData.decorative) return;
    // Fat lines (access / flood overlays) are not surfaces and their raycast needs a camera.
    if (
      (o as THREE.Mesh).isMesh &&
      o.visible &&
      !(o as { isLineSegments2?: boolean }).isLineSegments2
    )
      blockers.push(o);
    for (const c of o.children) visit(c);
  };
  for (const r of v.roots) visit(r);
  const seenVariant = new Set<string>();
  const proj = (p: THREE.Vector3) => {
    const q = _ch.copy(p).project(v.camera);
    if (q.z < -1 || q.z > 1) return null;
    return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h };
  };
  const walk = (o: THREE.Object3D) => {
    const bm = o as THREE.BatchedMesh;
    if (bm.isBatchedMesh && o.userData.crowd) {
      // The crowd renderer (C-T7): slot i is instance i on both LOD meshes.
      const lod = Number(o.userData.lod);
      const ids = o.userData.lookIds as string[];
      const heights = o.userData.heights as number[];
      if (lod === 0) planned.person += ids.length;
      for (let i = 0; i < ids.length; i++) {
        if (!o.visible || !bm.getVisibleAt(i)) continue;
        bm.getMatrixAt(i, _cm);
        _cm.decompose(_cp, _cq, _cs);
        const hM = heights[i] ?? 0;
        const feet = proj(_cp);
        const headW = _cp.clone().setY(_cp.y + hM * _cs.y);
        const head = proj(headW);
        const dist = v.camera.position.distanceTo(headW);
        _ray.set(v.camera.position, headW.clone().sub(v.camera.position).normalize());
        _ray.far = dist - 0.3;
        _ray.camera = v.camera;
        rows.push({
          kind: "person",
          variant: ids[i] ?? "",
          lod,
          distM: dist,
          scale: _cs.y,
          heightM: hM * _cs.y,
          head,
          feet,
          heightPx: head && feet ? Math.abs(feet.y - head.y) : null,
          inCanvas: !!head && head.x >= 0 && head.x <= w && head.y >= 0 && head.y <= h,
          occluded: _ray.intersectObjects(blockers, false).length > 0,
          x: _cp.x,
          z: _cp.z,
        });
      }
      return;
    }
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && o.name.startsWith("motion__")) {
      const [, asset, variant, lodTag] = o.name.split("__") as [string, string, string, string];
      const kind = asset === "people" ? "person" : "vehicle";
      const lod = Number(lodTag.replace("LOD", ""));
      const key = `${kind}/${variant}`;
      if (!seenVariant.has(key)) {
        seenVariant.add(key);
        planned[kind] += im.instanceMatrix.count;
      }
      const hM = modelHeight(im);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, _cm);
        _cm.decompose(_cp, _cq, _cs);
        const feet = proj(_cp);
        const headW = _cp.clone().setY(_cp.y + hM * _cs.y);
        const head = proj(headW);
        const dist = v.camera.position.distanceTo(headW);
        _ray.set(v.camera.position, headW.clone().sub(v.camera.position).normalize());
        _ray.far = dist - 0.3;
        _ray.camera = v.camera;
        const occluded = _ray.intersectObjects(blockers, false).length > 0;
        rows.push({
          kind,
          variant,
          lod,
          distM: dist,
          scale: _cs.y,
          heightM: hM * _cs.y,
          head,
          feet,
          heightPx: head && feet ? Math.abs(feet.y - head.y) : null,
          inCanvas: !!head && head.x >= 0 && head.x <= w && head.y >= 0 && head.y <= h,
          occluded,
        });
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const r of v.roots) walk(r);
  return { planned, rows };
}
const _ndc = new THREE.Vector2();

/** Road surface meshes (decorative, so the scene picker skips them). */
function roadMeshes(roots: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if ((o as THREE.Mesh).isMesh && o.userData.groundBand === "roads") out.push(o as THREE.Mesh);
    for (const c of o.children) visit(c);
  };
  for (const r of roots) visit(r);
  return out;
}

function classify(
  engine: Engine,
  ndc: { x: number; y: number },
  screen: { x: number; y: number },
  roads: THREE.Mesh[],
  camera: THREE.Camera,
  roots: THREE.Object3D[],
): MaskKind {
  // Mesh kinds only (zero viewport): markers and flood lines are overlays, not surfaces.
  const hit = pickAt(ndc, camera, roots, 0, { width: 0, height: 0 });
  if (hit?.kind === "building" || hit?.kind === "landmark") return "building";
  if (hit) return "other";
  _ray.setFromCamera(_ndc.set(ndc.x, ndc.y), camera);
  const hits: THREE.Intersection[] = [];
  // The road meshes opt out of raycasting (`raycast` is a no-op): call the Mesh raycast directly.
  for (const m of roads) THREE.Mesh.prototype.raycast.call(m, _ray, hits);
  if (hits.length > 0) return "road";
  const g = engine.rig.pick(screen);
  if (!g) return "sky";
  // With the diorama slab (A-T4) the ground ends at the outline: the plane beyond it is void (the
  // slab's soil edge or the background), not ground.
  const b = slabOf(roots)?.userData.boundary as Boundary | undefined;
  return b && !insideBoundary(b, g[0], g[1]) ? "sky" : "ground";
}

/** The visible slab group (`ground/slab.ts`), if any. */
function slabOf(roots: THREE.Object3D[]): THREE.Object3D | null {
  for (const r of roots) {
    const s = r.getObjectByName("slab");
    if (s?.visible) return s;
  }
  return null;
}

export function createAcceptanceApi(engine: Engine, frame: LocalFrame): AcceptanceApi {
  let camLog: { log: CameraLog; off: () => void } | null = null;
  let poseLog: { rows: PoseLogRow[]; off: (() => void) | null } = { rows: [], off: null };
  let lab: HeroLab | null = null;
  const camPos = (): [number, number, number] => {
    const p = engine.pickView().camera.position;
    return [p.x, p.y, p.z];
  };
  return {
    clearance() {
      const c = engine.clearance?.() ?? null;
      return c ? { count: c.count, clearanceM: c.clearanceM, maxTopM: c.maxTopM } : null;
    },
    footprintTop(x, z) {
      const c = engine.clearance?.() ?? null;
      return c ? c.topAt(x, z) : null;
    },
    cameraLocal: camPos,
    startCameraLog() {
      camLog?.off();
      const log = emptyCameraLog();
      const off = engine.onFrame(() => {
        const c = engine.clearance?.() ?? null;
        const pos = camPos();
        const top = c ? c.topAt(pos[0], pos[2]) : 0;
        const cm = c?.clearanceM ?? 0;
        logCameraFrame(log, pos, top, cm, engine.clearanceLiftM?.() ?? 0);
        // A camera above every roof (+ clearance + 5 m of glb slack) cannot be inside one: no ray.
        const high = !c || pos[1] > c.maxTopM + cm + 5;
        if (log.frames % RAY_EVERY === 0 && !high)
          logRoofRay(log, pos, roofHit(engine.pickView().roots, pos[0], pos[2]), top, cm);
      });
      camLog = { log, off };
    },
    flyTo(p, durationMs) {
      engine.rig.flyTo(
        {
          target: frame.toLocal(p.lon, p.lat),
          rangeM: p.rangeM,
          pitchDeg: p.pitchDeg,
          headingDeg: p.headingDeg,
        },
        durationMs,
      );
      engine.requestRender();
    },
    liftM: () => engine.clearanceLiftM?.() ?? 0,
    toLocal: (lon, lat) => frame.toLocal(lon, lat),
    insideOutline: (x, z) => {
      const fit = engine.cameraFit?.();
      return fit ? insideBoundary(fit.boundary, x, z) : null;
    },
    fovDeg: () => (engine.pickView().camera as THREE.PerspectiveCamera).fov,
    startPoseLog() {
      poseLog.off?.();
      const rows: PoseLogRow[] = [];
      const off = engine.onFrame((_dt, info) => {
        const p = engine.rig.get();
        const [lon, lat] = frame.toLonLat(p.target[0], p.target[1]);
        const fit = engine.cameraFit?.() ?? null;
        rows.push({
          // The tick's clock, not now: a long render would otherwise time-shift the pose.
          t: info.at ?? performance.now(),
          x: p.target[0],
          z: p.target[1],
          lon,
          lat,
          rangeM: p.rangeM,
          pitchDeg: p.pitchDeg,
          headingDeg: p.headingDeg,
          fov: (engine.pickView().camera as THREE.PerspectiveCamera).fov,
          inside: fit ? insideBoundary(fit.boundary, p.target[0], p.target[1]) : null,
          fitReady: !!fit,
        });
      });
      poseLog = { rows, off };
    },
    stopPoseLog() {
      poseLog.off?.();
      const rows = poseLog.rows;
      poseLog = { rows: [], off: null };
      return rows;
    },
    overviewPose: () => {
      const fit = engine.cameraFit?.();
      if (!fit) return null;
      const p = overviewPose(fit);
      const [lon, lat] = frame.toLonLat(p.target[0], p.target[1]);
      return { lon, lat, rangeM: p.rangeM, pitchDeg: p.pitchDeg, headingDeg: p.headingDeg };
    },
    timeFitSyncMs: () => {
      const fit = engine.cameraFit?.();
      if (!fit) return null;
      const t0 = performance.now();
      fitFor(fit.boundary);
      return performance.now() - t0;
    },
    fitReport: () => {
      const fit = engine.cameraFit?.();
      return fit
        ? {
            axisHeadingDeg: fit.axisHeadingDeg,
            costDeg: fitCost(fit),
            rangeNeededM: rangeNeededM(fit),
          }
        : null;
    },
    toLonLat: (x, z) => {
      const [lon, lat] = frame.toLonLat(x, z);
      return [lon, lat];
    },
    roofHitAt: (x, z) => roofHit(engine.pickView().roots, x, z),
    instanceAudit(maxSamples) {
      const c = engine.clearance?.() ?? null;
      const out: InstanceAudit = {
        meshes: 0,
        checked: 0,
        fails: 0,
        worstM: -Infinity,
        samples: [],
      };
      if (!c) return out;
      // The extruded city mesh (`userData.faces`) is checked by vitest against buildCityGeometry.
      const meshes = buildingMeshes(engine.pickView().roots).filter((m) => !m.userData.faces);
      out.meshes = meshes.length;
      let total = 0;
      for (const m of meshes)
        total += (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      const stride = Math.max(1, Math.ceil(total / Math.max(1, maxSamples)));
      const boxes = new Map<THREE.BufferGeometry, THREE.Box3>();
      const box = new THREE.Box3();
      const world = new THREE.Matrix4();
      const centre = new THREE.Vector3();
      let n = 0;
      for (const m of meshes) {
        let local = boxes.get(m.geometry);
        if (!local) {
          local = new THREE.Box3().setFromBufferAttribute(
            m.geometry.getAttribute("position") as THREE.BufferAttribute,
          );
          boxes.set(m.geometry, local);
        }
        const im = m as THREE.InstancedMesh;
        const count = im.isInstancedMesh ? im.count : 1;
        for (let i = 0; i < count; i++, n++) {
          if (n % stride !== 0) continue;
          if (im.isInstancedMesh) {
            im.getMatrixAt(i, _inst);
            world.multiplyMatrices(m.matrixWorld, _inst);
          } else world.copy(m.matrixWorld);
          box.copy(local).applyMatrix4(world);
          box.getCenter(centre);
          const top = c.topAt(centre.x, centre.z);
          out.checked++;
          const over = box.max.y - top;
          out.worstM = Math.max(out.worstM, over);
          if (over > 0.01) {
            out.fails++;
            if (out.samples.length < 10)
              out.samples.push([centre.x, centre.z, box.max.y, top, m.name]);
          }
        }
      }
      return out;
    },
    stopCameraLog() {
      if (!camLog) return emptyCameraLog();
      camLog.off();
      const { log } = camLog;
      camLog = null;
      return log;
    },
    setPose(p) {
      engine.rig.set({
        target: frame.toLocal(p.lon, p.lat),
        rangeM: p.rangeM,
        pitchDeg: p.pitchDeg,
        headingDeg: p.headingDeg,
      });
      engine.requestLodTick();
      engine.requestRender();
    },
    getPose() {
      const p = engine.rig.get();
      const [lon, lat] = frame.toLonLat(p.target[0], p.target[1]);
      return { lon, lat, rangeM: p.rangeM, pitchDeg: p.pitchDeg, headingDeg: p.headingDeg };
    },
    size() {
      const [w, h] = engine.pickView().size;
      return [w, h];
    },
    frames: () => engine.frames,
    pickGrid(step) {
      const v = engine.pickView();
      const [w, h] = v.size;
      const cols = Math.floor(w / step);
      const rows = Math.floor(h / step);
      const roads = roadMeshes(v.roots);
      let codes = "";
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.5) * step;
          const y = (r + 0.5) * step;
          const ndc = { x: (x / w) * 2 - 1, y: -(y / h) * 2 + 1 };
          codes += CODES[classify(engine, ndc, { x, y }, roads, v.camera, v.roots)];
        }
      return { step, cols, rows, codes };
    },
    roadVertices() {
      let n = 0;
      for (const m of roadMeshes(engine.pickView().roots))
        n += m.geometry.getAttribute("position")?.count ?? 0;
      return n;
    },
    setOverlaysVisible(visible) {
      const root = engine.pickView().roots[0];
      if (root) root.visible = visible;
      engine.requestRender();
    },
    fog() {
      const root = engine.pickView().roots.find((r) => (r as THREE.Scene).fog) as
        | THREE.Scene
        | undefined;
      const f = root?.fog;
      const bg = root?.background;
      if (!(f instanceof THREE.Fog)) return null;
      return {
        color: `#${f.color.getHexString()}`,
        near: f.near,
        far: f.far,
        background: bg instanceof THREE.Color ? `#${bg.getHexString()}` : "",
      };
    },
    dressingFade: () => ({ maxW: dressingFadeProbe.maxW, decor: dressingFadeProbe.decor }),
    lampPoints() {
      const v = engine.pickView();
      const [w, h] = v.size;
      let pools: THREE.InstancedMesh | null = null;
      const visit = (o: THREE.Object3D) => {
        if (!o.visible || pools) return;
        if ((o as THREE.InstancedMesh).isInstancedMesh && o.name === "lamp-pools")
          pools = o as THREE.InstancedMesh;
        for (const c of o.children) visit(c);
      };
      for (const r of v.roots) visit(r);
      const mesh = pools as THREE.InstancedMesh | null;
      if (!mesh) return [];
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld).project(v.camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) continue;
        out.push({ x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h });
      }
      return out;
    },
    crowd() {
      return crowdReport(engine);
    },
    linesOnTop(renderOrder, on) {
      let n = 0;
      const visit = (o: THREE.Object3D) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (
          (o as { isLineSegments2?: boolean }).isLineSegments2 &&
          o.renderOrder === renderOrder &&
          m
        ) {
          m.depthTest = !on;
          m.needsUpdate = true;
          n++;
        }
        for (const c of o.children) visit(c);
      };
      for (const r of engine.pickView().roots) visit(r);
      engine.requestRender();
      return n;
    },
    displayAudit() {
      return displayAudit(engine);
    },
    slabOutline() {
      const v = engine.pickView();
      const s = slabOf(v.roots);
      const outline = s?.userData.outline as P[][] | undefined;
      const foot = s?.userData.foot as [number, number, number][][] | undefined;
      if (!outline || !foot) return null;
      const [w, h] = v.size;
      const q = new THREE.Vector3();
      const px = () => ({ x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h });
      return outline.map((ring, r) =>
        ring.map(([lx, lz], i) => {
          const f = foot[r]![i]!;
          q.set(f[0], f[1], f[2]).project(v.camera);
          const fp = px();
          q.set(lx, 0, lz).project(v.camera);
          return { ...px(), lx, lz, inFront: q.z >= -1 && q.z <= 1, foot: fp };
        }),
      );
    },
    effects() {
      return engine.effects();
    },
    focusScreen() {
      return engine.focusScreen();
    },
    gpu() {
      const gl = engine.gl();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      };
    },
    heroLab() {
      lab ??= createHeroLab(engine);
      return lab;
    },
    measureUncapped(frames, orbitDegPerFrame) {
      const render = engine.renderNow;
      if (!render) throw new Error("engine.renderNow is missing");
      const gl = engine.gl();
      const start = engine.rig.get();
      const ms: number[] = [];
      for (let i = 0; i < frames; i++) {
        const p = engine.rig.get();
        engine.rig.set({ ...p, headingDeg: p.headingDeg + orbitDegPerFrame });
        const t0 = performance.now();
        render.call(engine);
        gl.finish();
        ms.push(performance.now() - t0);
      }
      engine.rig.set(start);
      engine.requestRender();
      return uncappedSummary(ms);
    },
    measure(seconds, orbitDegPerSec) {
      const startPose = engine.rig.get();
      return new Promise((resolve) => {
        const dts: number[] = [];
        let perf: Partial<PerfSample> | null = null;
        const stats = createFrameStats({ frames: () => {}, perf: (p) => (perf = p) });
        const off = engine.onFrame((dt, info) => {
          dts.push(dt);
          stats.frame(engine.frames, dt, info.calls, info.tris);
        });
        const start = performance.now();
        let last = start;
        let raf = 0;
        const tick = (now: number) => {
          const p = engine.rig.get();
          engine.rig.set({
            ...p,
            headingDeg: p.headingDeg + (orbitDegPerSec * (now - last)) / 1000,
          });
          engine.requestRender();
          last = now;
          if (now - start < seconds * 1000) {
            raf = requestAnimationFrame(tick);
            return;
          }
          cancelAnimationFrame(raf);
          off();
          stats.dispose();
          engine.rig.set(startPose);
          engine.requestRender();
          resolve({ ...frameSummary(dts), perf });
        };
        raf = requestAnimationFrame(tick);
      });
    },
  };
}

/** Installs `window.__tlAcceptance` while the engine and frame exist (dev or `?acceptance=1`). */
export function useAcceptanceHook(engine: Engine | null, frame: LocalFrame | null): void {
  useEffect(() => {
    if (!engine || !frame) return;
    if (!acceptanceEnabled(import.meta.env.DEV, location.search)) return;
    const w = window as unknown as Record<string, unknown>;
    const api = createAcceptanceApi(engine, frame);
    w[ACCEPTANCE_GLOBAL] = api;
    return () => {
      if (w[ACCEPTANCE_GLOBAL] === api) delete w[ACCEPTANCE_GLOBAL];
    };
  }, [engine, frame]);
}
