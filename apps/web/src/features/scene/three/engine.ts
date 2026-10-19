import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { reducedMotion } from "../cesium/controls/cameraOps";
import type { Tier } from "../shared/quality";
import { CityGTAOPass } from "./aoPass";
import type { CityInstances } from "./assets/cityInstances";
import { createMotionUniforms, type MotionUniforms } from "./assets/roleMaterial";
import { fitSteps, fogReachM } from "./cameraFit";
import {
  type CameraFit,
  type CameraRig,
  clampPose,
  LIMITS,
  type Pose,
  poseToCamera,
  tweenPose,
  VFOV_DEG,
  vfovFor,
  viewOffsetFor,
  wrap180,
} from "./cameraRig";
import type { CityGeometry } from "./cityMesh";
import { type Clearance, createLift } from "./clearance";
import { cullFrustum, shadowPadM } from "./cull";
import { applyGroundGrade, GROUND_GRADE, groundMaterial } from "./ground/bands";
import type { Boundary } from "./ground/boundary";
import { cityGroundMeshes } from "./ground/cityGround";
import type { GroundLayer } from "./ground/groundLayer";
import { shimmerMaterial } from "./ground/landcover";
import { createSlab, type SlabLayerObject } from "./ground/slab";
import { BLOOM, fitShadowCamera, type LightPreset } from "./lighting";
import { createLodSchedule } from "./lodSchedule";
import { applyFog } from "./mood";
import { createMotionClock, type MotionMode, motionModeFor } from "./motion/motionClock";
import type { MotionLayer } from "./motion/motionLayer";
import type { OverlayLayer } from "./overlays/accessLayers";
import { THREE_TIERS } from "./quality";
import { applyClayTier, CLAY_PALETTE, clayMaterial, setClayTier } from "./shared/clayTokens";
import { createSky } from "./sky";
import { measure, UPLOAD_MEASURE } from "./stream/streamer";
import { attachWheelZoom, dispatchOwnWheel } from "./zoom";

/** Local xz box the camera target may not leave (by more than LIMITS.maxCentreOffsetM). */
export interface Bounds {
  min: [number, number];
  max: [number, number];
}

export interface FrameInfo {
  /** The frame's clock (performance.now() at the tick start): the time its camera pose is for. */
  at?: number;
  /** Draw calls this frame, over all passes. */
  calls: number;
  /** Triangles this frame, over all passes. */
  tris: number;
  moving: boolean;
}

/** What an LOD tick hands its listeners: the orbit target (local xz) and the camera range (m). */
export interface LodTick {
  target: { x: number; z: number };
  rangeM: number;
  nowMs: number;
}

/**
 * The resident-journey layer as the engine sees it (`features/journey/three/journeyLayer.ts`).
 * The ribbon joins the main scene (depth-tested, left out of the AO G-buffer); the markers are a
 * scene of their own, rendered straight to the screen after the composer (spec §6.4: post passes
 * drew the prototype's sprites as black quads).
 */
export interface JourneyOverlay {
  ribbon: THREE.Object3D;
  markers: THREE.Scene;
  setResolution(w: number, h: number): void;
  setMetresPerPixel(mpp: number): void;
  dispose(): void;
}

export interface Engine {
  readonly frames: number;
  /**
   * Bumped whenever a scene layer that can hold ground bands is swapped (city, ground layer, any
   * decor slot such as the streamed `roads`): readers that index the drawn ground (the journey
   * hero's foot planting) re-check their ground meshes when it changes, not every frame.
   */
  readonly groundGeneration: number;
  setCity(g: CityGeometry): void;
  /** Instanced archetypes; replaces and disposes the previous set; null removes it. */
  setAssets(a: CityInstances | null): void;
  /** Land cover, roads and markings; replaces and disposes the previous layer; null removes it. */
  setGround(g: GroundLayer | null): void;
  /**
   * The diorama slab (A-T4): its top (the Elmina outline) replaces the rectangular base plane and
   * its layered soil edge closes the map. null removes it and shows the base plane again. The
   * camera is bound to it (A-T5, `cameraFit.ts`): the target stays inside the outline and the
   * whole slab is in view at max range.
   */
  setSlab(b: Boundary | null): void;
  /** The camera fit of the slab in use, or null (read-only; tests and the acceptance hook). */
  cameraFit?(): CameraFit | null;
  /** The slab's outline as set (before its camera fit lands), or null. */
  slabBoundary?(): Boundary | null;
  /**
   * Called once each time a slab's camera fit lands (it is computed in idle slices after setSlab).
   * The engine then eases the camera into the fit's rules unless a listener started a flight
   * (A-T5 fix round 2). Returns the unsubscribe.
   */
  onFitReady?(cb: (fit: CameraFit) => void): () => void;
  /** Bumped on every user camera input (pointer down or wheel on the map, camera buttons and keys). */
  inputSerial?(): number;
  /** Counts a user camera input made outside MapControls (camera buttons, keyboard). */
  noteInput?(): void;
  /**
   * Decorative extras (lamp pools, birds, cloud shadows) by slot name: replaces and disposes the
   * slot's previous content; null clears it. The group is added to the scene as is.
   */
  setDecor(slot: string, d: { group: THREE.Object3D; dispose(): void } | null): void;
  /**
   * A streamed layer was swapped in outside `setDecor` (the kit buckets): the next frame's render,
   * which uploads its buffers, is timed as `tl:stream-upload` (as after every `setDecor` swap).
   */
  markSwap(): void;
  /** Shared motion clock uniforms: uTime (clock seconds), uSway and uLimb (1 running, 0 at rest). */
  readonly motion: MotionUniforms;
  /**
   * The motion layer and its gate. While running() the loop ticks it once per rAF at High/Medium
   * (display rate; 30 fps after the session's slow-device fallback; never at Low); otherwise no frame
   * is scheduled for motion (render on demand), and the frames that do render tick it at the frozen
   * motion time so its culling follows the camera. Motion time excludes stopped spans, so a resume
   * never jumps. Replaces and disposes the previous layer; null removes it. The caller requests a
   * render when running() flips.
   */
  setMotion(l: MotionLayer | null, running: () => boolean): void;
  /** Camera bounds before the city arrives (the site extent); setCity replaces them. */
  setBounds(b: Bounds): void;
  /**
   * Building clearance (A-T7, `clearance.ts`): applied to the camera every frame after every input
   * (wheel, drag, rotate, set, flyTo) and before the render. Null turns it off.
   */
  setClearance?(c: Clearance | null): void;
  /** The clearance grid in use, or null (read-only; the acceptance hook's footprint lookup). */
  clearance?(): Clearance | null;
  /** Metres the clearance currently lifts the camera above its base pose (0: none). Read-only. */
  clearanceLiftM?(): number;
  /**
   * Access / gaps / route / what-if lines. They live in their own scene, drawn by a pass after the
   * AO pass, so ambient occlusion never darkens them and they sit above every prop. Replaces and
   * disposes the previous layer; null removes it.
   */
  setOverlays(o: OverlayLayer | null): void;
  /**
   * The journey ribbon and event markers (see `JourneyOverlay`). Independent of `setOverlays`, so
   * the ribbon shows with the status lines off. Replaces and disposes the previous layer; null
   * removes it.
   */
  setJourney(j: JourneyOverlay | null): void;
  setLighting(p: LightPreset, keyDir: [number, number, number]): void;
  /** Camera range in metres: fog distances scale with it so the township view is never fogged out. */
  setFogRange(rangeM: number): void;
  setTier(t: Tier): void;
  setViewOffset(panelPx: number): void;
  resize(w: number, h: number): void;
  rig: CameraRig;
  requestRender(): void;
  /**
   * Renders one frame now, synchronously (cancels a pending frame). Test-only: the acceptance
   * harness times uncapped frames with it (`scene/useAcceptanceHook.ts`); the app never calls it.
   */
  renderNow?(): void;
  /**
   * Test only (acceptance hero lab, C-T4/C-T5 screenshots): pins the camera at a free pose for the
   * following frames, below the rig's 30 m minimum range; null hands the camera back to the rig.
   */
  setCameraOverride?(
    pose: {
      position: [number, number, number];
      target: [number, number, number];
      /** Vertical field of view (deg); default: the rig's close-range VFOV_DEG (the follow view). */
      fovDeg?: number;
    } | null,
  ): void;
  onFrame(cb: (dtMs: number, info: FrameInfo) => void): () => void;
  /**
   * Runs `cb` on the instanced-LOD schedule (at most every 250 ms while the camera moves, plus once
   * after it stops), before that frame renders. A listener returns true while it has more work
   * (tiles still to plan): the engine then wakes one more LOD tick an interval later, even with the
   * camera still. Registering asks for a tick at once.
   */
  onLodTick(cb: (t: LodTick) => boolean | undefined): () => void;
  /** Asks for an LOD tick on the next frame (new streaming input, a tier change). */
  requestLodTick(): void;
  /** Unrecoverable runtime failure (context lost, shader compile/link error): the caller falls back. */
  onFatal(cb: (err: Error) => void): () => void;
  gl(): WebGL2RenderingContext;
  /** What the shared picker needs: the camera, the overlay and main scenes, the canvas CSS size. */
  pickView(): { camera: THREE.Camera; roots: THREE.Object3D[]; size: [number, number] };
  dispose(): void;
}

const RAD = Math.PI / 180;
const MOVING_MS = 300;
/** LOD re-bucketing while the camera moves: at most this often, plus once after it stops. */
const LOD_INTERVAL_MS = 250;
/** A bound on pinned shader programs (the scene uses about 32; see `pinPrograms`). */
const MAX_PINNED_PROGRAMS = 96;

export interface RigView {
  camera: THREE.PerspectiveCamera;
  /** The orbit target (MapControls' target). */
  target: THREE.Vector3;
  changed(): void;
  /** Canvas size in CSS pixels. */
  size(): [number, number];
  /** Metres the building clearance lifts the camera now: get() reports the pose without it. */
  liftM?(): number;
  /**
   * An explicit teleport: set(), or flyTo() with no duration (a bookmark jump, a keyboard step).
   * The clearance restarts its eased lift there instead of easing from the old place. Never called
   * for flight frames or controls input, however fast they move.
   */
  teleported?(): void;
}

export interface EngineRig extends CameraRig {
  /** Advances a flight to `now` (performance.now() clock); true while it is still running. */
  step(now: number): boolean;
  /**
   * Re-applies clampPose to the camera as it stands (after MapControls input or a flight frame):
   * keeps a dragged target inside the outline and the long-range rules (A-T5). Not a teleport.
   * True when the camera was moved.
   */
  constrain(): boolean;
  /** True while a flight is running. */
  flying(): boolean;
  /**
   * The slab's camera fit has just landed (A-T5 fix round 2): eases the camera from where it stands
   * to its clamped pose over `ms` (no one-frame snap); 0 applies it at once. constrain() holds off
   * until the landing ends.
   */
  landFit(ms: number): void;
  /**
   * The fit landed while a flight is running (e.g. one started for it): constrain() holds off until
   * that flight ends, so its frames are not snapped by the new rules.
   */
  holdConstrain(): void;
  /** 0 -> 1 across a landing (the eased flight progress), 1 otherwise: blends the field of view. */
  landingWeight(now: number): number;
}

const POSE_EPS = 1e-3;
/** How long the camera eases into the slab fit's rules when the fit lands (ms). */
export const FIT_LAND_MS = 900;
/** The camera-fit search yields to the frame loop after this many ms of a slice. */
const FIT_SLICE_MS = 8;

/** True when two poses differ by more than POSE_EPS (metres or degrees; heading on the circle). */
function poseMoved(a: Pose, b: Pose): boolean {
  const dh = Math.abs(wrap180(a.headingDeg - b.headingDeg));
  return (
    Math.abs(a.target[0] - b.target[0]) > POSE_EPS ||
    Math.abs(a.target[1] - b.target[1]) > POSE_EPS ||
    Math.abs(a.rangeM - b.rangeM) > POSE_EPS ||
    Math.abs(a.pitchDeg - b.pitchDeg) > POSE_EPS ||
    dh > POSE_EPS
  );
}

/**
 * Camera rig over a camera and orbit target. set(), flyTo() and constrain() apply clampPose, with
 * the slab fit when there is one (`fit`, A-T5).
 */
export function createRig(
  view: RigView,
  bounds: () => Bounds,
  fit: () => CameraFit | null = () => null,
): EngineRig {
  let flight: { from: Pose; to: Pose; t0: number; ms: number } | null = null;
  /** A fit landing is running (landFit / holdConstrain): constrain() waits for its flight. */
  let landing = false;
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const apply = (p: Pose) => {
    const c = poseToCamera(p);
    view.camera.position.set(...c.position);
    view.target.set(...c.target);
    view.camera.lookAt(view.target);
    view.changed();
  };
  const get = (): Pose => {
    const off = view.camera.position.clone().sub(view.target);
    off.y -= view.liftM?.() ?? 0;
    const r = off.length() || 1;
    const heading = Math.atan2(-off.x, off.z) / RAD;
    return {
      target: [view.target.x, view.target.z],
      rangeM: r,
      pitchDeg: -Math.asin(Math.max(-1, Math.min(1, off.y / r))) / RAD,
      headingDeg: (heading + 360) % 360,
    };
  };

  return {
    get,
    set(p) {
      flight = null;
      landing = false;
      apply(clampPose(p, bounds(), fit()));
      view.teleported?.();
    },
    flyTo(p, durationMs) {
      landing = false;
      const to = clampPose(p, bounds(), fit());
      if (durationMs <= 0) {
        flight = null;
        apply(to);
        view.teleported?.();
        return;
      }
      flight = { from: get(), to, t0: performance.now(), ms: durationMs };
      view.changed();
    },
    step(now) {
      if (!flight) return false;
      const t = (now - flight.t0) / flight.ms;
      apply(tweenPose(flight.from, flight.to, t));
      if (t < 1) return true;
      flight = null;
      landing = false;
      return false;
    },
    constrain() {
      if (landing) return false;
      const p = get();
      const c = clampPose(p, bounds(), fit());
      if (!poseMoved(p, c)) return false;
      apply(c);
      return true;
    },
    flying: () => flight !== null,
    landFit(ms) {
      const from = get();
      const to = clampPose(from, bounds(), fit());
      if (!poseMoved(from, to)) return;
      if (ms <= 0) {
        flight = null;
        landing = false;
        apply(to);
        return;
      }
      flight = { from, to, t0: performance.now(), ms };
      landing = true;
      view.changed();
    },
    holdConstrain() {
      if (flight) landing = true;
    },
    landingWeight(now) {
      if (!landing || !flight) return 1;
      const t = Math.min(1, Math.max(0, (now - flight.t0) / flight.ms));
      return t * t * (3 - 2 * t);
    },
    pick(screen) {
      const [w, h] = view.size();
      if (w <= 0 || h <= 0) return null;
      view.camera.updateMatrixWorld();
      ray.setFromCamera(
        new THREE.Vector2((screen.x / w) * 2 - 1, -(screen.y / h) * 2 + 1),
        view.camera,
      );
      return ray.ray.intersectPlane(ground, hit) ? [hit.x, hit.z] : null;
    },
  };
}

/**
 * Three.js renderer for the stylised city. Throws when WebGL2 is unavailable; a failure after the
 * renderer exists releases everything created so far (and the context) before rethrowing.
 * Each engine needs its own canvas: dispose() forces the context lost.
 */
export function createEngine(canvas: HTMLCanvasElement, tier: Tier): Engine {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  /** Releases in reverse creation order; filled as things are created. */
  const undo: (() => void)[] = [];
  const release = () => {
    for (const f of undo.splice(0).reverse()) {
      try {
        f();
      } catch {
        /* keep releasing the rest */
      }
    }
    renderer.dispose();
    renderer.forceContextLoss();
  };
  try {
    return build(renderer, canvas, tier, undo, release);
  } catch (err) {
    release();
    throw err;
  }
}

function build(
  renderer: THREE.WebGLRenderer,
  canvas: HTMLCanvasElement,
  tier: Tier,
  undo: (() => void)[],
  release: () => void,
): Engine {
  // Clay materials made from here on follow this tier (B-T1; applyTier keeps it current).
  setClayTier(tier);
  // Neutral, not AgX: AgX desaturated the stylised palette to grey (browser check, Task 7 fix 2);
  // Khronos PBR Neutral keeps base colours.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // three r186 removed PCFSoftShadowMap: it warns once and uses PCFShadowMap. Ask for that directly
  // so the console stays clean.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  let disposed = false;
  const fatalCbs = new Set<(err: Error) => void>();
  const fail = (err: Error) => {
    if (disposed) return;
    for (const cb of fatalCbs) cb(err);
  };
  renderer.debug.onShaderError = (gl, program) => {
    console.error("TownshipLens 3D: shader failed", gl.getProgramInfoLog(program));
    fail(new Error("WebGL shader compile or link failed"));
  };
  const onContextLost = () => fail(new Error("WebGL context lost"));
  canvas.addEventListener("webglcontextlost", onContextLost);
  undo.push(() => canvas.removeEventListener("webglcontextlost", onContextLost));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const sky = createSky();
  scene.add(sky.mesh);
  undo.push(() => sky.dispose());
  const pmrem = new THREE.PMREMGenerator(renderer);
  undo.push(() => pmrem.dispose());
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  undo.push(() => envRT.dispose());
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(VFOV_DEG, 1, 2, 30000);
  const sun = new THREE.DirectionalLight();
  const hemi = new THREE.HemisphereLight();
  scene.add(sun, sun.target, hemi);
  let keyDir: [number, number, number] = [0, 1, 0];
  let lastPreset: LightPreset | null = null;
  let fogRange = 0;

  const buildingMat = clayMaterial("wall", { vertexColors: true, tier });
  const parksMat = groundMaterial("parks", tier);
  const waterMat = groundMaterial("water", tier);
  const motion = createMotionUniforms();
  shimmerMaterial(waterMat, motion.uTime, "all");
  const groundMat = clayMaterial("ground", {
    tier,
    color: CLAY_PALETTE.ground,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  applyGroundGrade(groundMat);
  const city = new THREE.Group();
  scene.add(city);
  /** The rectangular base plane of the last setCity (hidden while a slab is set). */
  let basePlane: THREE.Mesh | null = null;
  let slab: SlabLayerObject | null = null;
  const dropSlab = () => {
    if (!slab) return;
    scene.remove(slab.group);
    slab.dispose();
    slab = null;
    if (basePlane) basePlane.visible = true;
  };
  const disposeCity = () => {
    for (const o of [...city.children]) {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      city.remove(o);
    }
  };
  undo.push(disposeCity);
  undo.push(dropSlab);

  /** Overlay lines (data, not decoration): a scene of their own, see setOverlays. */
  const overlayScene = new THREE.Scene();
  let overlays: OverlayLayer | null = null;
  let overlayPass: RenderPass | null = null;
  let pixelRatio = 1;
  let lastMpp = 0;
  /** Metres per screen pixel at the camera target; dashes follow it (re-set on a > 5 % change). */
  const syncDashes = (force = false) => {
    if (!overlays) return;
    const dist = camera.position.distanceTo(controls.target);
    const mpp = (2 * dist * Math.tan((camera.fov * RAD) / 2)) / Math.max(1, size[1]);
    if (!force && Math.abs(mpp / lastMpp - 1) <= 0.05) return;
    lastMpp = mpp;
    overlays.setMetresPerPixel(mpp);
  };
  const dropOverlays = () => {
    if (!overlays) return;
    overlayScene.remove(overlays.group);
    scene.remove(overlays.groundGroup);
    scene.remove(overlays.lineGroup);
    overlays.dispose();
    overlays = null;
  };
  /** Journey ribbon (main scene) and markers (their own scene, after post-processing). */
  let journey: JourneyOverlay | null = null;
  const dropJourney = () => {
    if (!journey) return;
    scene.remove(journey.ribbon);
    journey.dispose();
    journey = null;
  };
  const renderJourneyMarkers = () => {
    if (!journey || journey.markers.children.length === 0) return;
    // After the OutputPass: straight to the canvas, over the finished image, never through the
    // composer (no AO, bloom or tone mapping on the sprites; their alpha stays alpha).
    renderer.setRenderTarget(null);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(journey.markers, camera);
    renderer.autoClear = autoClear;
  };
  undo.push(() => {
    dropJourney();
    dropOverlays();
    for (const m of [buildingMat, parksMat, waterMat, groundMat]) m.dispose();
    sun.shadow.map?.dispose();
  });

  let motionLayer: MotionLayer | null = null;
  let motionRunning: () => boolean = () => false;
  /**
   * The motion scheduler (Task 12): display rate at High/Medium, the P3 30 fps cadence after the
   * session's < 45 fps fallback, which the clock measures itself from live frame gaps (the one frame
   * monitor for motion; the tier monitor in useEngine is separate). Its `at` is the layers' clock:
   * motion time, frozen while stopped.
   */
  const clock = createMotionClock();
  /** null at Low: motion is off (ruling P4-S), so no frame is ever live and nothing is scheduled. */
  let motionMode: MotionMode | null = motionModeFor(tier);
  /**
   * Motion time = performance.now() - motionOffset. Each resume (Motion on again, tab visible, map
   * back on screen) re-anchors the offset so motion time continues from the frozen `at`: agents
   * never jump by the stopped wall time, and while running motion time is real time.
   */
  let motionOffset = 0;
  /** The last rendered frame was a live motion frame (the engine's view, for the re-anchor). */
  let liveBefore = false;
  const motionNow = (now: number) => now - motionOffset;
  let motionTimer: ReturnType<typeof setTimeout> | undefined;
  /** Reused every frame by the GTAO pass's skip list. */
  const aoSkip: THREE.Object3D[] = [];
  /** The motion timer wakes a frame without marking the scene dirty (see tick). */
  const motionWake = () => {
    motionTimer = undefined;
    schedule();
  };
  /**
   * After a frame: display mode asks for the next rAF (without marking the scene dirty); 30 fps mode
   * arms the timer (the P3 path); a stopped or paused clock schedules nothing (Review Focus 3).
   */
  const wakeMotion = (now: number, live: boolean) => {
    clearTimeout(motionTimer);
    motionTimer = undefined;
    const wake = clock.nextWakeMs(motionNow(now), live);
    if (wake === 0) schedule();
    else if (wake !== null && !raf) motionTimer = setTimeout(motionWake, wake);
  };
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const rest = () => {
    motion.uSway.value = 0;
    motion.uLimb.value = 0;
  };
  rest();
  const dropMotion = () => {
    if (!motionLayer) return;
    scene.remove(motionLayer.group);
    motionLayer.dispose();
    motionLayer = null;
  };
  undo.push(dropMotion);

  let assets: CityInstances | null = null;
  const lod = createLodSchedule(LOD_INTERVAL_MS);
  const lodCbs = new Set<(t: LodTick) => boolean | undefined>();
  /** The instance-culling frustum: the view, padded for shadow casters (P4-I). */
  const cull = new THREE.Frustum();
  const lodTick: LodTick = { target: { x: 0, z: 0 }, rangeM: 0, nowMs: 0 };
  const lodWanted = () => !!assets || lodCbs.size > 0;
  let lodTimer: ReturnType<typeof setTimeout> | undefined;
  const dropAssets = () => {
    if (!assets) return;
    scene.remove(assets.group);
    assets.dispose();
    assets = null;
  };
  undo.push(dropAssets);

  let groundLayer: GroundLayer | null = null;
  let groundGeneration = 0;
  const dropGround = () => {
    if (!groundLayer) return;
    scene.remove(groundLayer.group);
    groundLayer.dispose();
    groundLayer = null;
  };
  undo.push(dropGround);

  const decor = new Map<string, { group: THREE.Object3D; dispose(): void }>();
  /**
   * Replaced decor is disposed after the next render, not at once: its replacement has acquired
   * the same shader programs by then, so three keeps them (a program whose last user is disposed is
   * deleted, and the replacement would compile and link it again in its first render: 50-120 ms
   * of main-thread stall per streamed swap, measured in P5 Task 5).
   */
  let retired: Array<() => void> = [];
  /**
   * Shader programs are pinned once compiled: three deletes a program when its last material is
   * disposed, and streamed layers come and go (beyond 1500 m only trees and roads show, so signs,
   * lamp pools, facades, roofs and agents are dropped on every high fly), which made each reappearance
   * compile and link its programs again on the main thread (40-120 ms, P5 Task 5 trace). The
   * program set is small and fixed by the material cache keys (about 32 programs), so keeping them
   * costs little; the renderer's dispose releases them.
   */
  let compileWarned = false;
  const warnCompileOnce = (err: unknown) => {
    if (compileWarned) return;
    compileWarned = true;
    console.warn("Three.js: compileAsync failed; layers compile on first render.", err);
  };
  const pinned = new Set<object>();
  const pinPrograms = () => {
    const programs = renderer.info.programs as Array<{ usedTimes: number }> | null;
    if (!programs || programs.length === pinned.size) return;
    for (const p of programs)
      if (!pinned.has(p) && pinned.size < MAX_PINNED_PROGRAMS) {
        pinned.add(p);
        p.usedTimes++;
      }
  };
  const flushRetired = () => {
    const list = retired;
    retired = [];
    for (const dispose of list) dispose();
  };
  /** Layers waiting for their shader programs before they are shown (see `setDecor`). */
  const compiling = new Map<string, { group: THREE.Object3D; dispose(): void }>();
  const dropDecor = (slot: string, later = false) => {
    const d = decor.get(slot);
    if (!d) return;
    scene.remove(d.group);
    if (later) retired.push(() => d.dispose());
    else d.dispose();
    decor.delete(slot);
    groundGeneration++;
  };
  undo.push(() => {
    for (const slot of [...decor.keys()]) dropDecor(slot);
    for (const d of compiling.values()) d.dispose();
    compiling.clear();
    flushRetired();
  });

  let raf = 0;
  let dirty = true;
  /** A streamed layer was swapped in since the last render: time that render (its uploads). */
  let swapped = false;
  let idle = true;
  let last = 0;
  let lastMove = Number.NEGATIVE_INFINITY;
  let frames = 0;
  let size: [number, number] = [1, 1];
  let panelPx = 0;
  let bounds: Bounds = { min: [0, 0], max: [0, 0] };
  /** The slab's camera fit (A-T5): set with the slab, null without one (the tiny fixture). */
  let fit: CameraFit | null = null;
  let fitJob = 0;
  let slabBoundary: Boundary | null = null;
  const fitListeners = new Set<(f: CameraFit) => void>();
  let inputSerial = 0;
  /**
   * Computes the slab's camera fit in idle slices of at most FIT_SLICE_MS (fix round 1: the search
   * took about 130 ms, a long task at load). Until it lands the camera keeps the plain clamp. The
   * whole computation is measured as `tl:camera-fit` (wall time, slices included).
   */
  const startFit = (b: Boundary | null) => {
    const job = ++fitJob;
    fit = null;
    if (!b) return;
    const steps = fitSteps(b);
    const t0 = performance.now();
    let slices = 0;
    const idle = (cb: () => void) => {
      const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: object) => number })
        .requestIdleCallback;
      if (ric) ric(cb, { timeout: 500 });
      else setTimeout(cb, 0);
    };
    const run = () => {
      if (disposed || job !== fitJob) return;
      slices++;
      const s0 = performance.now();
      for (;;) {
        const r = steps.next();
        if (r.done) {
          fit = r.value;
          // The fog's far end follows the slab from now on (fogReachM).
          if (lastPreset) applyFog(scene, lastPreset, fogRange, fogReachM(fit, fogRange));
          for (const cb of [...fitListeners]) cb(r.value);
          // No one-frame snap into the new rules: ease there, or let a listener's flight do it.
          if (rig.flying()) rig.holdConstrain();
          else rig.landFit(reducedMotion() ? 0 : FIT_LAND_MS);
          try {
            performance.measure("tl:camera-fit", { start: t0, detail: { slices } });
          } catch {
            /* measure unsupported: ignore */
          }
          requestRender();
          return;
        }
        if (performance.now() - s0 >= FIT_SLICE_MS) break;
      }
      idle(run);
    };
    idle(run);
  };
  const listeners = new Set<(dtMs: number, info: FrameInfo) => void>();
  undo.push(() => {
    disposed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(lodTimer);
    clearTimeout(motionTimer);
  });

  const visible = () => document.visibilityState === "visible";
  const schedule = () => {
    if (raf || disposed || !visible()) return;
    raf = requestAnimationFrame(tick);
  };
  const requestRender = () => {
    if (disposed) return;
    dirty = true;
    schedule();
  };
  const moved = () => {
    lastMove = performance.now();
    lod.moved();
    requestRender();
  };

  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  // Wheel zoom is proportional and smoothed by ./zoom (AC-A7); OrbitControls only applies each
  // frame's share through synthetic wheel events (zoom to cursor, clamping): scale 0.95^(|dy|/100).
  controls.zoomSpeed = 1;
  controls.minDistance = LIMITS.minRangeM;
  controls.maxDistance = LIMITS.maxRangeM;
  controls.minPolarAngle = (90 + LIMITS.minPitchDeg) * RAD;
  controls.maxPolarAngle = (90 + LIMITS.maxPitchDeg) * RAD;
  undo.push(
    attachWheelZoom({
      canvas,
      // The base (unlifted) range: the clearance lift is display state, never zoomed.
      range: () => rig.get().rangeM,
      apply: (factor, x, y) => dispatchOwnWheel(canvas, factor, x, y),
      reducedMotion,
      minM: LIMITS.minRangeM,
      maxM: LIMITS.maxRangeM,
    }),
  );
  controls.addEventListener("change", moved);
  const onInput = () => {
    inputSerial++;
  };
  controls.addEventListener("start", onInput);
  undo.push(() => controls.removeEventListener("start", onInput));
  // MapControls computes zoom-to-cursor rays and pan start points from the camera inside its
  // pointerdown / wheel handlers, before it calls update(): put the camera on its base pose first,
  // in the capture phase on the document (ahead of every canvas listener). A render is requested,
  // so the next tick re-applies the lift before anything is drawn.
  const doc = canvas.ownerDocument;
  const unliftFirst = (e: Event) => {
    if (e.target !== canvas || liftNow() === 0) return;
    unlift();
    requestRender();
  };
  for (const type of ["pointerdown", "wheel"] as const)
    doc.addEventListener(type, unliftFirst, { capture: true, passive: true });
  undo.push(() => {
    for (const type of ["pointerdown", "wheel"] as const)
      doc.removeEventListener(type, unliftFirst, { capture: true });
  });
  // Every update (the tick's and the handlers' own) starts from the base pose, never the lift.
  const controlsUpdate = controls.update.bind(controls);
  controls.update = (deltaTime?: number | null) => {
    unlift();
    return controlsUpdate(deltaTime);
  };
  undo.push(() => {
    controls.removeEventListener("change", moved);
    controls.dispose();
  });

  const rig = createRig(
    {
      camera,
      target: controls.target,
      changed: moved,
      size: () => size,
      liftM: () => liftNow(),
      teleported: () => lift.reset(),
    },
    () => bounds,
    () => fit,
  );
  /**
   * The field of view follows the base pose (A-T5): VFOV_DEG up to FIT.startRangeM, widening
   * towards max range to what the whole slab needs (`vfovFor`).
   */
  const syncFov = (now = performance.now()) => {
    const pose = rig.get();
    const aspect = size[0] / Math.max(1, size[1]);
    const k = rig.landingWeight(now);
    const want =
      k >= 1 ? vfovFor(pose, fit, aspect) : VFOV_DEG + (vfovFor(pose, fit, aspect) - VFOV_DEG) * k;
    if (Math.abs(camera.fov - want) <= 1e-4) return;
    camera.fov = want;
    camera.updateProjectionMatrix();
  };

  let composer = new EffectComposer(renderer);
  let passes: Pass[] = [];
  let bloomPass: UnrealBloomPass | null = null;
  /** Strength from the mood preset; the pass is skipped while it is 0 (day). */
  const syncBloom = () => {
    if (!bloomPass) return;
    bloomPass.strength = lastPreset?.bloom ?? 0;
    bloomPass.enabled = bloomPass.strength > 0;
  };
  undo.push(() => {
    for (const p of passes) p.dispose();
    composer.dispose();
  });
  const applyTier = (t: Tier) => {
    const spec = THREE_TIERS[t];
    // Clay (B-T1): new materials follow the tier; live physical clay drops / regains its sheen.
    setClayTier(t);
    applyClayTier(scene, t);
    // Low: motion off. The next frame is not live, so it rests the pose and schedules nothing.
    motionMode = motionModeFor(t);
    const pr = Math.min(globalThis.devicePixelRatio || 1, spec.maxPixelRatio);
    renderer.setPixelRatio(pr);
    pixelRatio = pr;
    overlays?.setPixelRatio(pr);
    renderer.shadowMap.enabled = spec.shadows;
    sun.castShadow = spec.shadows;
    if (spec.shadows) {
      sun.shadow.mapSize.set(spec.shadowMapSize, spec.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    for (const m of [buildingMat, parksMat, waterMat, groundMat]) m.needsUpdate = true;
    assets?.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.needsUpdate = true;
    });
    for (const p of passes) p.dispose();
    composer.dispose();
    const [w, h] = size;
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(pr);
    passes = [new RenderPass(scene, camera)];
    // AO normal/depth pass without the far LOD2 blocks (I3).
    if (spec.ao)
      // Agents too: small and moving, their AO is invisible and their draws would double.
      passes.push(
        new CityGTAOPass(scene, camera, w, h, () => {
          aoSkip.length = 0;
          if (assets) for (const o of assets.aoExcluded()) aoSkip.push(o);
          if (motionLayer) aoSkip.push(motionLayer.group);
          // The flood tint is data on the ground: AO must not darken it.
          if (overlays) aoSkip.push(overlays.groundGroup, overlays.lineGroup);
          // The journey ribbon is Line2 quads (paint over the ground), not a surface for AO.
          if (journey) aoSkip.push(journey.ribbon);
          return aoSkip;
        }),
      );
    // Markers and residents after the AO pass and before bloom/tone mapping: no occlusion on them,
    // drawn on top. Overlay lines are not here: they draw in the main pass (lineGroup) to depth-test.
    overlayPass = new RenderPass(overlayScene, camera);
    overlayPass.clear = false;
    passes.push(overlayPass);
    bloomPass = null;
    if (spec.bloom) {
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        lastPreset?.bloom ?? 0,
        BLOOM.radius,
        BLOOM.threshold,
      );
      syncBloom();
      passes.push(bloomPass);
    }
    passes.push(new OutputPass());
    for (const p of passes) composer.addPass(p);
    composer.setSize(w, h);
    requestRender();
  };

  const placeLight = () => {
    const t = controls.target;
    const fit = fitShadowCamera([t.x, t.z], camera.position.distanceTo(t) * 1.2, keyDir);
    sun.position.set(...fit.position);
    sun.target.position.set(...fit.target);
    sun.target.updateMatrixWorld();
    const c = sun.shadow.camera;
    c.left = -fit.halfSize;
    c.right = fit.halfSize;
    c.top = fit.halfSize;
    c.bottom = -fit.halfSize;
    c.near = fit.near;
    c.far = fit.far;
    c.updateProjectionMatrix();
  };

  // Building clearance (A-T7). The lift is display state: the camera is put back on its base pose
  // before anything reads it to move: at the start of each tick, and inside every controls.update()
  // (MapControls also calls update() from its pointer, wheel, key and touch handlers between ticks:
  // review A-T7 r2). A camera moved by something else since (rig.set) is the new base. So neither
  // MapControls nor rig flights read the lift; after the inputs the tick re-applies it (floor at
  // once, segment lift eased up and back down, state kept across flight frames).
  let clearance: Clearance | null = null;
  const lift = createLift();
  let clearT = 0;
  let liftM = 0;
  const lifted = new THREE.Vector3(Number.NaN, 0, 0);
  const liftNow = () => (liftM !== 0 && camera.position.equals(lifted) ? liftM : 0);
  const unlift = () => {
    if (liftM !== 0 && camera.position.equals(lifted)) {
      camera.position.y -= liftM;
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
    }
    liftM = 0;
  };
  const clearCamera = (now: number): boolean => {
    const dt = clearT ? now - clearT : 0;
    clearT = now;
    if (!clearance) return false;
    const p = camera.position;
    const t = controls.target;
    const r = lift.step(clearance, [p.x, p.y, p.z], [t.x, t.y, t.z], dt, reducedMotion());
    if (r.liftM !== 0) {
      p.y = r.y;
      camera.lookAt(t);
      lastMove = now;
      lod.moved();
    }
    liftM = r.liftM;
    lifted.copy(p);
    return !r.settled;
  };

  let cameraOverride: {
    position: [number, number, number];
    target: [number, number, number];
    fovDeg?: number;
  } | null = null;
  function tick() {
    raf = 0;
    if (disposed) return;
    const now = performance.now();
    unlift();
    const flying = rig.step(now);
    if (flying) {
      lastMove = now;
      lod.moved();
    }
    const damping = controls.update();
    // Drags, wheel zoom and flight frames stay bound to the slab (A-T5); the lift comes after.
    rig.constrain();
    syncFov(now);
    const lifting = clearCamera(now);
    if (cameraOverride) {
      camera.position.set(...cameraOverride.position);
      camera.lookAt(...cameraOverride.target);
      const fov = cameraOverride.fovDeg ?? VFOV_DEG;
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
    }
    clearTimeout(motionTimer);
    motionTimer = undefined;
    const live = motionMode !== null && !!motionLayer && motionRunning();
    // Resuming: motion time continues from the frozen clock, excluding the stopped span.
    if (live && !liveBefore) motionOffset = now - clock.at;
    liveBefore = live;
    // display: every live frame is a motion tick; 30 fps: a (re)start at once, then one per
    // MOTION_FRAME_MS with a few ms of slack for vsync jitter.
    const due = clock.frame(motionNow(now), live);
    if (live && !due && !dirty && !flying && !damping && !lifting) {
      // 30 fps only: woken by the motion timer too early. Render nothing, wait for the due time.
      wakeMotion(now, live);
      return;
    }
    if (lodWanted() && lod.due(now)) {
      const rangeM = camera.position.distanceTo(controls.target);
      // The shadow box half size is fitShadowCamera's radius (placeLight: range x 1.2).
      if (assets)
        assets.update(
          camera.position,
          cullFrustum(camera, shadowPadM(sun.castShadow, rangeM * 1.2), cull, viewProj),
        );
      lodTick.target.x = controls.target.x;
      lodTick.target.z = controls.target.z;
      lodTick.rangeM = rangeM;
      lodTick.nowMs = now;
      let more = false;
      for (const cb of lodCbs) if (cb(lodTick)) more = true;
      // More tiles to plan: one more LOD tick an interval later (the trailing timer wakes it).
      if (more) lod.moved();
    }
    if (motionLayer) {
      if (due) {
        motion.uTime.value = clock.at / 1000;
        motion.uSway.value = 1;
        motion.uLimb.value = 1;
      } else if (!live) rest();
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      motionLayer.tick(clock.at, camera.position, frustum);
    }
    placeLight();
    renderer.info.reset();
    syncDashes();
    overlays?.setView(camera.position, camera.fov);
    if (overlayPass) overlayPass.enabled = !!overlays?.hasVisible();
    if (journey) {
      const dist = camera.position.distanceTo(controls.target);
      journey.setMetresPerPixel(
        (2 * dist * Math.tan((camera.fov * RAD) / 2)) / Math.max(1, size[1]),
      );
    }
    const tRender = performance.now();
    composer.render();
    renderJourneyMarkers();
    if (swapped) {
      swapped = false;
      measure(UPLOAD_MEASURE, tRender);
    }
    pinPrograms();
    flushRetired();
    dirty = false;
    frames++;
    const dt = idle ? 0 : now - last;
    last = now;
    idle = false;
    // autoReset is off, so calls and triangles add up over every pass of this frame.
    const info = {
      at: now,
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      moving: now - lastMove < MOVING_MS,
    };
    for (const cb of listeners) cb(dt, info);
    if (flying || damping || dirty || lifting) schedule();
    // Motion-only frames stay "idle" (dt 0 to onFrame listeners, ruling P4-T).
    if (!raf) idle = true;
    // The motion clock: the next rAF (display rate) or the 30 fps timer; nothing while stopped.
    wakeMotion(performance.now(), live);
    // The camera stopped before the last LOD update was due: wake one more frame for it (display
    // rate already renders the next frame, which runs the LOD tick when due).
    const wait = lodWanted() && !raf ? lod.trailingMs(now) : null;
    clearTimeout(lodTimer);
    lodTimer = wait === null ? undefined : setTimeout(requestRender, wait);
  }

  const onVisibility = () => {
    if (visible()) {
      requestRender();
      return;
    }
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(motionTimer);
    motionTimer = undefined;
    idle = true;
    // Paused: the hidden span is neither motion time nor a slow frame for the fallback monitor,
    // even if running() only turns false later (the React gate may lag this event).
    clock.frame(motionNow(performance.now()), false);
    liveBefore = false;
  };
  document.addEventListener("visibilitychange", onVisibility);
  undo.push(() => document.removeEventListener("visibilitychange", onVisibility));

  const applyViewOffset = () => {
    const [w, h] = size;
    camera.aspect = w / h;
    if (panelPx > 0) camera.setViewOffset(...viewOffsetFor(w, h, panelPx));
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };

  applyTier(tier);

  return {
    get groundGeneration() {
      return groundGeneration;
    },
    get frames() {
      return frames;
    },
    rig,
    motion,
    requestRender,
    setCameraOverride(pose) {
      cameraOverride = pose;
      schedule();
    },
    renderNow() {
      if (disposed) return;
      cancelAnimationFrame(raf);
      raf = 0;
      dirty = true;
      tick();
    },
    setDecor(slot, d) {
      if (disposed) {
        d?.dispose();
        return;
      }
      if (d && (decor.get(slot) === d || compiling.get(slot) === d)) return;
      // A newer layer (or a clear) supersedes one still compiling: it is never shown.
      const waiting = compiling.get(slot);
      if (waiting) {
        compiling.delete(slot);
        waiting.dispose();
      }
      if (!d) {
        dropDecor(slot);
        requestRender();
        return;
      }
      const show = () => {
        // A replacement keeps the old layer's programs alive until it has rendered once.
        dropDecor(slot, true);
        decor.set(slot, d);
        scene.add(d.group);
        groundGeneration++;
        swapped = true;
        requestRender();
      };
      // Shader programs the layer needs that are not compiled yet are compiled in parallel
      // (KHR_parallel_shader_compile) before it is shown, so its first render never waits on a
      // link (40-130 ms on the main thread, P5 Task 5); the old layer stays drawn meanwhile.
      if (typeof renderer.compileAsync !== "function") {
        show();
        return;
      }
      compiling.set(slot, d);
      const ready = () => {
        if (disposed || compiling.get(slot) !== d) return;
        compiling.delete(slot);
        show();
      };
      // Compile for the render target the scene pass draws into (linear, no tone mapping), not the
      // screen: the program variant must be the one the composer's render will use.
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(composer.readBuffer);
      let compiled: Promise<unknown>;
      try {
        compiled = renderer.compileAsync(d.group, camera, scene);
      } catch (err) {
        // A synchronous throw must not leave the slot blank: show the layer, which then compiles
        // on its first render as before.
        warnCompileOnce(err);
        compiled = Promise.resolve();
      } finally {
        renderer.setRenderTarget(prev);
      }
      compiled.then(ready, ready);
    },
    markSwap() {
      if (disposed) return;
      swapped = true;
      requestRender();
    },
    setMotion(l, running) {
      if (disposed) {
        l?.dispose();
        return;
      }
      motionRunning = running;
      if (l !== motionLayer) {
        dropMotion();
        if (l) {
          motionLayer = l;
          // Running: it starts now; stopped: at the frozen motion time (no jump on resume).
          clock.restart(liveBefore ? motionNow(performance.now()) : clock.at);
          scene.add(l.group);
        } else {
          clearTimeout(motionTimer);
          motionTimer = undefined;
          rest();
        }
      }
      requestRender();
    },
    setCity(g) {
      if (disposed) return;
      disposeCity();
      groundGeneration++;
      const buildings = new THREE.Mesh(g.buildings, buildingMat);
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      // The extruded (fallback) buildings are pickable buildings: the picker names one by face.
      buildings.userData.pick = { kind: "building" };
      buildings.userData.faces = g.faces;
      const { parks, water } = cityGroundMeshes(g.parks, g.water, parksMat, waterMat);
      const plane = new THREE.PlaneGeometry(g.ground.size[0], g.ground.size[1]);
      plane.rotateX(-Math.PI / 2);
      const ground = new THREE.Mesh(plane, groundMat);
      ground.position.set(g.ground.center[0], 0, g.ground.center[1]);
      // the base plane is the drawn ground where no band lies (journey hero foot planting)
      ground.userData.groundBand = "base";
      for (const m of [parks, water, ground]) m.receiveShadow = true;
      ground.name = "base-plane";
      ground.visible = !slab;
      basePlane = ground;
      city.add(ground, parks, water, buildings);
      if (!g.bounds.isEmpty())
        bounds = { min: [g.bounds.min.x, g.bounds.min.z], max: [g.bounds.max.x, g.bounds.max.z] };
      requestRender();
    },
    setAssets(a) {
      if (disposed) {
        a?.dispose();
        return;
      }
      if (a === assets) return;
      dropAssets();
      if (a) {
        assets = a;
        scene.add(a.group);
        // The next tick buckets the new instances before it renders.
        lod.force();
      }
      requestRender();
    },
    setGround(g) {
      if (disposed) {
        g?.dispose();
        return;
      }
      if (g === groundLayer) return;
      dropGround();
      groundGeneration++;
      if (g) {
        groundLayer = g;
        scene.add(g.group);
      }
      requestRender();
    },
    setSlab(b) {
      if (disposed) return;
      dropSlab();
      slabBoundary = b;
      startFit(b);
      if (b) {
        slab = createSlab(b, groundMat);
        scene.add(slab.group);
        if (basePlane) basePlane.visible = false;
      }
      requestRender();
    },
    setBounds(b) {
      if (disposed) return;
      bounds = b;
    },
    cameraFit: () => fit,
    slabBoundary: () => slabBoundary,
    onFitReady(cb) {
      fitListeners.add(cb);
      return () => fitListeners.delete(cb);
    },
    inputSerial: () => inputSerial,
    noteInput() {
      inputSerial++;
    },
    setClearance(c) {
      if (disposed) return;
      clearance = c;
      lift.reset();
      requestRender();
    },
    clearance: () => clearance,
    clearanceLiftM: () => liftNow(),
    setOverlays(o) {
      if (disposed) return;
      if (o === overlays) return;
      dropOverlays();
      if (o) {
        overlays = o;
        o.setResolution(size[0], size[1]);
        o.setPixelRatio(pixelRatio);
        syncDashes(true);
        overlayScene.add(o.group);
        scene.add(o.groundGroup);
        scene.add(o.lineGroup);
      }
      requestRender();
    },
    setJourney(j) {
      if (disposed) {
        j?.dispose();
        return;
      }
      if (j === journey) return;
      dropJourney();
      if (j) {
        journey = j;
        j.setResolution(size[0], size[1]);
        scene.add(j.ribbon);
      }
      requestRender();
    },
    setLighting(p, dir) {
      if (disposed) return;
      keyDir = dir;
      sun.color.set(p.sunColor);
      sun.intensity = p.sunIntensity;
      hemi.color.set(p.hemiSky);
      hemi.groundColor.set(p.hemiGround);
      hemi.intensity = p.hemiIntensity;
      scene.environmentIntensity = p.envIntensity;
      renderer.toneMappingExposure = p.exposure;
      (scene.background as THREE.Color).set(p.background);
      sky.setPreset(p);
      GROUND_GRADE.value = p.groundGrade;
      lastPreset = p;
      syncBloom();
      applyFog(scene, p, fogRange, fogReachM(fit, fogRange));
      requestRender();
    },
    setFogRange(rangeM) {
      if (disposed) return;
      fogRange = rangeM;
      if (lastPreset) {
        applyFog(scene, lastPreset, rangeM, fogReachM(fit, rangeM));
        requestRender();
      }
    },
    setTier(t) {
      if (!disposed) applyTier(t);
    },
    setViewOffset(px) {
      if (disposed) return;
      panelPx = px;
      applyViewOffset();
      requestRender();
    },
    resize(w, h) {
      if (disposed || w <= 0 || h <= 0) return;
      size = [w, h];
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      overlays?.setResolution(w, h);
      journey?.setResolution(w, h);
      syncDashes(true);
      applyViewOffset();
      requestRender();
    },
    onFrame(cb) {
      if (disposed) return () => {};
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onLodTick(cb) {
      if (disposed) return () => {};
      lodCbs.add(cb);
      lod.force();
      requestRender();
      return () => lodCbs.delete(cb);
    },
    requestLodTick() {
      if (disposed) return;
      lod.force();
      requestRender();
    },
    onFatal(cb) {
      if (disposed) return () => {};
      fatalCbs.add(cb);
      return () => fatalCbs.delete(cb);
    },
    gl: () => renderer.getContext() as WebGL2RenderingContext,
    pickView: () => ({ camera, roots: [overlayScene, scene], size: [size[0], size[1]] }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      listeners.clear();
      lodCbs.clear();
      fatalCbs.clear();
      release();
    },
  };
}
