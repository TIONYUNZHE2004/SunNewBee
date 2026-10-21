import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { journeyMarkerStandIn } from "../../journey/three/journeyLayer";
import { reducedMotion } from "../cesium/controls/cameraOps";
import type { Tier } from "../shared/quality";
import { CityGTAOPass } from "./aoPass";
import type { CityInstances } from "./assets/cityInstances";
import {
  createMotionUniforms,
  FOLIAGE_GRADE,
  foliageGradeFor,
  type MotionUniforms,
} from "./assets/roleMaterial";
import { currentTreeCut } from "./assets/treeCut";
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
import { createEnvTexture, ENV_SIGMA, fillEnvTexture, loadEnvFile } from "./envMap";
import { createGpuPacer } from "./gpuPacer";
import { applyGroundGrade, GROUND_GRADE, groundMaterial, ROAD_GRADE } from "./ground/bands";
import type { Boundary } from "./ground/boundary";
import { cityGroundMeshes } from "./ground/cityGround";
import type { GroundLayer } from "./ground/groundLayer";
import { shimmerMaterial } from "./ground/landcover";
import { createSlab, type SlabLayerObject } from "./ground/slab";
import {
  AO_PARAMS,
  BLOOM,
  fitShadowCamera,
  type LightPreset,
  SHADOW,
  shadowFrame,
} from "./lighting";
import { createLodSchedule } from "./lodSchedule";
import { applyFog } from "./mood";
import { createMotionClock, type MotionMode, motionModeFor } from "./motion/motionClock";
import type { MotionLayer } from "./motion/motionLayer";
import type { OverlayLayer } from "./overlays/accessLayers";
import { lineProgramStandIns } from "./overlays/lines";
import { markerProgramStandIn } from "./overlays/markers";
import { THREE_TIERS } from "./quality";
import { applyClayTier, CLAY_PALETTE, clayMaterial, setClayTier } from "./shared/clayTokens";
import { createSky } from "./sky";
import { measure, UPLOAD_MEASURE } from "./stream/streamer";
import { CityBokehPass, focusDepth } from "./tiltShift";
import { buildWarmDraws, releaseWarmDraws } from "./warmDraw";
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

/**
 * The developer-lens Development Simulation layer as the engine sees it
 * (`scene/three/devsim/devsimLayer.ts`): its group joins the main scene, and `beforeRender` runs
 * every frame once the camera is final (driver, rig, clearance), just before the render, so its
 * objects and its projected screen anchors match the drawn frame. Decorative.
 */
export interface DevsimOverlay {
  group: THREE.Object3D;
  beforeRender(
    camera: THREE.PerspectiveCamera,
    size: readonly [number, number],
    nowMs: number,
  ): void;
  /** Glows and paint the AO G-buffer must leave out (they would read as solid occluders). */
  aoExcluded?(): readonly THREE.Object3D[];
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
  /**
   * Compiles the shader programs `obj` needs, for the render target the scene pass draws into, in
   * parallel (KHR_parallel_shader_compile) before it is shown, as `setDecor` does for its layers
   * (GATE AC-D18: the motion layer's crowd and vehicle materials were compiled on first draw).
   * Resolves when ready, and also on failure (the first render then compiles as before). Optional
   * so test doubles need not provide it.
   */
  prepare?(obj: THREE.Object3D): Promise<void>;
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
  /**
   * A deterministic clock (seconds) for the decorative motion, e.g. the journey's trip time t, so a
   * beat renders the same at any wall time (AC-D17). While it returns a number, the shader motion
   * (`motion.uTime`: sway, shimmer, flicker, limbs) and the motion layer (decorative people, cars,
   * birds) run on it, offset by a fixed epoch; null (or no clock) keeps the motion clock.
   */
  setDecorClock?(c: (() => number | null) | null): void;
  /**
   * Removes `c` only if it is still the decorative clock: a stale cleanup (journey and devsim share
   * the one slot) never clears another owner's clock.
   */
  releaseDecorClock?(c: () => number | null): void;
  /**
   * A material patch run on every layer before it is compiled or first drawn (the city, the asset
   * instances, decor slots): e.g. the journey building cutaway, injected ahead of need so no
   * program is compiled twice. Runs at once on what is already drawn, then the scene is
   * precompiled in the background (`prewarm`). Returns a remover.
   */
  addMaterialPatch?(patch: (root: THREE.Object3D) => number): () => void;
  /**
   * Compiles the shader programs `root` needs (its own materials, and the AO normal and depth of
   * field depth variants of its meshes) in parallel (KHR_parallel_shader_compile), so their first
   * render never links on the main thread. Resolves when they are ready (at once without
   * `compileAsync`). Default root: the whole scene.
   */
  prewarm?(root?: THREE.Object3D): Promise<void>;
  /**
   * Draws `obj` for a couple of frames without colour (every material's colour writes off, a few
   * metres under the ground at the view's centre), then takes it out again: the driver builds the
   * draw-time shader variants (ANGLE on D3D11 compiles some only at the first draw, e.g. the skinned
   * shadow-map variant) at an idle moment instead of when it first really shows. Resolves when done.
   */
  warmDraw?(obj: THREE.Object3D, frames?: number): Promise<void>;
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
   * A camera driven from outside the orbit rig (the journey follow camera, D-T5): called at the
   * start of every frame; while it returns a pose the camera is put exactly there (position and
   * look point, no clamp, no rig lift: the driver clears buildings itself), MapControls are off
   * and rig flights are dropped. Returning null hands the camera back to the rig and MapControls
   * where it stands. null removes the driver. The driver asks for frames itself (`requestRender`),
   * or returns `animating` to get the next one.
   */
  setCameraDriver?(d: CameraDriver | null): void;
  /** Removes `d` only if it is still the camera driver (see `releaseDecorClock`). */
  releaseCameraDriver?(d: CameraDriver): void;
  /** True while the last frame's camera came from the driver. */
  cameraDriven?(): boolean;
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
  /**
   * The Development Simulation layer (see `DevsimOverlay`); replaces and disposes the previous one;
   * null removes it. Optional so test doubles need not provide it.
   */
  setDevsim?(l: DevsimOverlay | null): void;
  setLighting(p: LightPreset, keyDir: [number, number, number]): void;
  /** Camera range in metres: fog distances scale with it so the township view is never fogged out. */
  setFogRange(rangeM: number): void;
  setTier(t: Tier): void;
  /**
   * Tilt-shift depth of field wanted (B-T5): the FX toggle on and motion not reduced. It runs only
   * where the tier has it too (`THREE_TIERS.dof`, High).
   */
  setDof(on: boolean): void;
  /**
   * The depth-of-field subject (B-T5), e.g. the journey hero from the follow rig; null falls back
   * to the camera target (the map centre: a horizontal focus band in a tilted overview).
   */
  setFocusPoint(p: THREE.Vector3 | null): void;
  /** Which effects run now (acceptance AC-B5): depth of field and AO. */
  effects(): { dof: boolean; ao: boolean };
  /** The focus point projected to canvas CSS pixels (acceptance AC-B4), null when behind the camera. */
  focusScreen(): { x: number; y: number } | null;
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

/** A pose from a camera driver (`Engine.setCameraDriver`), local metres. */
export interface DrivenCamera {
  position: [number, number, number];
  look: [number, number, number];
  /** True while the driver animates on its own (e.g. a mode change blend): render another frame. */
  animating?: boolean;
  /**
   * Vertical field of view to render with (degrees). Without it the rig's fov applies, which
   * depends on the pose the user left the rig at; a driver that must be a pure function of its own
   * clock (the Development Simulation's seek) pins it.
   */
  fovDeg?: number;
}
export type CameraDriver = (
  now: number,
  current: { position: [number, number, number]; look: [number, number, number] },
) => DrivenCamera | null;

const RAD = Math.PI / 180;
const MOVING_MS = 300;
/** LOD re-bucketing while the camera moves: at most this often, plus once after it stops. */
const LOD_INTERVAL_MS = 250;
/**
 * A bound on pinned shader programs (see `pinPrograms`). The journey adds cut, hero, override and
 * crowd variants: with 96 the place markers' program went unpinned, was deleted when a marker layer
 * was replaced and linked again on the next answer (gate AC-D18). Programs are small.
 */
const MAX_PINNED_PROGRAMS = 256;
/** Stand-in material copies are disposed this long after their compile (their programs pinned). */
const STAND_IN_DISPOSE_MS = 2000;
/**
 * Motion time (ms) at trip time 0 while a journey drives the decorative clock (`setDecorClock`):
 * a fixed epoch, so the seeded crowd and traffic stand where they would after a minute of motion.
 */
const DECOR_EPOCH_MS = 60_000;

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
  /** Drops a running flight or fit landing where it stands (a camera driver took the camera). */
  halt(): void;
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
    halt() {
      flight = null;
      landing = false;
    },
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
  // so the console stays clean. r186 PCF honours `shadow.radius` (soft kernel, B-T4: SHADOW).
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
  // The environment light: baked at build time (envMap.ts), so the first frame links no PMREM
  // programs (ITER2 AC-D18: 434-814 ms). Same size as the runtime PMREM it falls back to.
  const envTex = createEnvTexture();
  undo.push(() => envTex.dispose());
  scene.environment = envTex;
  let envFallback: THREE.WebGLRenderTarget | null = null;
  undo.push(() => envFallback?.dispose());
  // (unit tests: no file, no fetch; the texture stays without pixels)
  (import.meta.env.MODE === "test" ? new Promise<Uint16Array>(() => {}) : loadEnvFile()).then(
    (px) => {
      if (disposed) return;
      fillEnvTexture(envTex, px);
      requestRender();
    },
    (err: unknown) => {
      if (disposed) return;
      console.warn(`city: baked environment unavailable, rendering it (${String(err)})`);
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        envFallback = pmrem.fromScene(room, ENV_SIGMA);
        room.dispose();
        pmrem.dispose();
        scene.environment = envFallback.texture;
        requestRender();
      } catch (e) {
        console.warn(`city: no environment light (${String(e)})`);
      }
    },
  );

  const camera = new THREE.PerspectiveCamera(VFOV_DEG, 1, 2, 30000);
  const sun = new THREE.DirectionalLight();
  const hemi = new THREE.HemisphereLight();
  // Soft PCF shadows (B-T4). normalBias follows the box size (placeLight).
  sun.shadow.radius = SHADOW.radius;
  sun.shadow.bias = SHADOW.bias;
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
  /** An overlay layer whose programs are still compiling (shown when ready, see setOverlays). */
  let pendingOverlays: OverlayLayer | null = null;
  /** A journey layer whose programs are still compiling (shown when ready, see setJourney). */
  let pendingJourney: JourneyOverlay | null = null;
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
  /** The Development Simulation layer (main scene), see setDevsim. */
  let devsim: DevsimOverlay | null = null;
  const dropDevsim = () => {
    if (!devsim) return;
    scene.remove(devsim.group);
    devsim.dispose();
    devsim = null;
  };
  undo.push(() => {
    dropDevsim();
    pendingOverlays?.dispose();
    pendingOverlays = null;
    pendingJourney?.dispose();
    pendingJourney = null;
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
  /**
   * The sun's shadow map draws each caster with three's shared basic-packed depth material, its
   * side from the caster's `shadowSide` (else the flipped side), in an empty scene (no fog). One
   * stand-in material per side, compiled the same way, so the programs it needs (the hero's skinned
   * variant was linked on her first shadow draw, gate AC-D18) are built in parallel.
   */
  const shadowDepthBySide = new Map<THREE.Side, THREE.MeshDepthMaterial>();
  undo.push(() => {
    for (const d of shadowDepthBySide.values()) d.dispose();
    shadowDepthBySide.clear();
  });
  const shadowDepthFor = (mat: THREE.Material | THREE.Material[]): THREE.MeshDepthMaterial => {
    const m = Array.isArray(mat) ? mat[0] : mat;
    const flip: Record<number, THREE.Side> = {
      [THREE.FrontSide]: THREE.BackSide,
      [THREE.BackSide]: THREE.FrontSide,
      [THREE.DoubleSide]: THREE.DoubleSide,
    };
    const side = m?.shadowSide ?? flip[m?.side ?? THREE.FrontSide] ?? THREE.BackSide;
    let d = shadowDepthBySide.get(side);
    if (!d) {
      d = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side });
      shadowDepthBySide.set(side, d);
    }
    return d;
  };
  /**
   * The post passes draw the scene again with an override material (GTAO normals, depth of field
   * depth): one program per object variant (skinned, instanced, morphed). One stand-in mesh per
   * variant found under `root`, wearing each override (`shadow`: the shadow-map depth material of
   * each caster instead), so `compileAsync` builds those programs too.
   */
  const overrideStandIns = (root: THREE.Object3D, shadow = false): THREE.Group | null => {
    const overrides: THREE.Material[] = [];
    if (!shadow) {
      if (aoPass) overrides.push(aoPass.normalMaterial);
      const depth = (bokehPass as unknown as { _materialDepth?: THREE.Material } | null)
        ?._materialDepth;
      if (depth) overrides.push(depth);
      if (overrides.length === 0) return null;
    } else if (!(sun.castShadow && renderer.shadowMap.enabled)) return null;
    const group = new THREE.Group();
    const seen = new Set<string>();
    root.traverse((o) => {
      const m = o as THREE.Mesh & {
        isSkinnedMesh?: boolean;
        isInstancedMesh?: boolean;
        isBatchedMesh?: boolean;
        instanceColor?: unknown;
      };
      if (!m.isMesh || m.isBatchedMesh || (shadow && !m.castShadow)) return;
      const wear = shadow ? [shadowDepthFor(m.material)] : overrides;
      const morph = Object.keys(m.geometry?.morphAttributes ?? {}).length;
      const key = `${!!m.isSkinnedMesh}|${!!m.isInstancedMesh}|${!!m.instanceColor}|${morph}|${wear[0]?.side}`;
      if (seen.has(key)) return;
      seen.add(key);
      for (const ov of wear) {
        // a shallow stand-in: same geometry (and skeleton / instance buffers), the override material
        // Its own copy of the override: compileAsync waits on each material's current program,
        // and a shared override's is only the last variant prepared (the skinned shadow variant
        // was then still linking when first drawn: a 190 ms wait). Same cache key, same program.
        const c = m.clone(false) as THREE.Mesh;
        c.material = ov.clone();
        c.visible = true;
        group.add(c);
      }
    });
    return group.children.length > 0 ? group : null;
  };
  /**
   * Compiles `root`'s programs in parallel for `target` (the scene pass's buffer: linear, no tone
   * mapping; null: the canvas, for the markers), plus the post passes' override variants. Resolves
   * when ready; a synchronous throw resolves at once (the first render then compiles as before).
   */
  const compileRoot = (
    root: THREE.Object3D,
    target: THREE.WebGLRenderTarget | null,
    overrides = true,
    /** The scene it is drawn in (its fog and lights pick the program variant). */
    into: THREE.Scene = scene,
  ): Promise<unknown> => {
    if (typeof renderer.compileAsync !== "function") return Promise.resolve();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const jobs: Promise<unknown>[] = [];
    const standIns: THREE.Object3D[] = [];
    try {
      jobs.push(renderer.compileAsync(root, camera, into));
      const stand = overrides ? overrideStandIns(root) : null;
      if (stand) {
        standIns.push(stand);
        jobs.push(renderer.compileAsync(stand, camera, into));
      }
      const casters = overrides ? overrideStandIns(root, true) : null;
      if (casters) {
        standIns.push(casters);
        // as the shadow pass draws them: into the shadow map, in an empty scene (no fog)
        const fog = scene.fog;
        scene.fog = null;
        try {
          if (sun.shadow.map) renderer.setRenderTarget(sun.shadow.map as THREE.WebGLRenderTarget);
          jobs.push(renderer.compileAsync(casters, sun.shadow.camera, scene));
        } finally {
          scene.fog = fog;
        }
      }
    } catch (err) {
      warnCompileOnce(err);
    } finally {
      renderer.setRenderTarget(prev);
    }
    const all = Promise.all(jobs);
    // the stand-ins' material copies go once their programs are pinned (a few frames later)
    const copies: THREE.Material[] = [];
    for (const g of standIns)
      g.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mat && !copies.includes(mat)) copies.push(mat);
      });
    if (copies.length)
      void all.then(() =>
        setTimeout(() => {
          for (const mat of copies) mat.dispose();
        }, STAND_IN_DISPOSE_MS),
      );
    // Each compiled program gets its first use (three's onFirstUse: info-log and uniform queries, a
    // synchronous round trip to the GPU process) at the next idle moment if nothing has drawn it by
    // then: a route-line program compiled at load but first drawn when the answer landed waited
    // 132-222 ms in that frame behind its uploads (ITER2 AC-D18 diagnosis). Programs drawn at once
    // (a layer shown when ready) are used by their first draw before the idle moment: no change.
    const mats: THREE.Material[] = [...copies];
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if (!mats.includes(x)) mats.push(x);
    });
    void all.then(
      () => {
        const ric = (
          globalThis as {
            requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
          }
        ).requestIdleCallback;
        const run = () => {
          if (disposed) return;
          touchPrograms(mats);
          // and one real draw of each mesh (ITER2 AC-D18: ANGLE builds the D3D executable at a
          // program's first draw; see warmDraw.ts), for one frame, if the layer is still shown
          if (root.parent) warmDraw(root, into);
          // a stand-in (never in a scene: the line, marker and journey marker programs) is drawn
          // once into its own target, clipped to one pixel, inside the next frame
          else if (!overrides) {
            standWarm.push({ root, target, into });
            requestRender();
          }
        };
        // without idle callbacks (Safari, node) the first draw does it, as before
        if (ric) ric(run, { timeout: 2000 });
      },
      () => {},
    );
    return all;
  };
  /** Warm-up draw groups (warmDraw.ts) in their scenes until the next rendered frame. */
  let warming: THREE.Group[] = [];
  let standWarm: {
    root: THREE.Object3D;
    target: THREE.WebGLRenderTarget | null;
    into: THREE.Scene;
  }[] = [];
  /**
   * Draws the queued stand-ins for real (ITER2 AC-D18: the journey ribbon's line programs and its
   * marker sprite were compiled at load but first DRAWN at Ask+0.8 s, where ANGLE built their D3D
   * executables and the GPU process fell ~300 ms behind). Each is drawn in the scene it was compiled
   * for, into the target it draws in, with the scissor on one pixel: that pixel of the scene target is
   * cleared by the next frame's scene pass, and on the canvas it is only touched where a stand-in
   * covers it. Shadows are not re-rendered for it.
   */
  const drawStandWarm = () => {
    const list = standWarm;
    standWarm = [];
    const prevTarget = renderer.getRenderTarget();
    const autoShadow = renderer.shadowMap.autoUpdate;
    const autoClear = renderer.autoClear;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    try {
      for (const { root, target, into } of list) {
        const own = root !== into && !root.parent;
        if (own) into.add(root);
        try {
          renderer.setRenderTarget(target);
          renderer.setScissorTest(true);
          renderer.setScissor(0, 0, 1, 1);
          renderer.render(into, camera);
        } finally {
          renderer.setScissorTest(false);
          if (own) into.remove(root);
        }
      }
    } catch (err) {
      warnCompileOnce(err);
    } finally {
      renderer.shadowMap.autoUpdate = autoShadow;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(prevTarget);
    }
  };
  const warmDraw = (root: THREE.Object3D, into: THREE.Scene) => {
    const g = buildWarmDraws(root);
    if (!g) return;
    into.add(g);
    warming.push(g);
    requestRender();
  };
  const touchPrograms = (mats: readonly THREE.Material[]) => {
    for (const m of mats) {
      const prog = (
        renderer.properties.get(m) as { currentProgram?: { getUniforms?(): unknown } } | undefined
      )?.currentProgram;
      try {
        prog?.getUniforms?.();
      } catch {
        /* a failed program reports through renderer.debug.onShaderError */
      }
    }
  };
  /** Material patches run on every layer before its first compile (`addMaterialPatch`). */
  const materialPatches = new Set<(root: THREE.Object3D) => number>();
  const runPatches = (root: THREE.Object3D) => {
    let n = 0;
    for (const patch of materialPatches) n += patch(root);
    return n;
  };
  /**
   * Meshes whose material carries the decorative occluder cut (trees, cars, props kit, decorative
   * dressing, crowd): rebuilt when the scene's layers change (`groundGeneration`, assets, motion)
   * and at most once a second (layers add instanced buckets as they stream).
   */
  let decorList: THREE.Object3D[] = [];
  let decorKey = "";
  const decorCuttable = (): THREE.Object3D[] => {
    const key = `${groundGeneration}|${assets ? assets.group.id : 0}|${motionLayer ? motionLayer.group.id : 0}|${scene.children.length}|${Math.floor(performance.now() / 1000)}`;
    if (key === decorKey) return decorList;
    decorKey = key;
    decorList = [];
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mat = Array.isArray(m) ? m[0] : m;
      if (mat?.userData.tlDecorCut) decorList.push(o);
    });
    return decorList;
  };
  /** The decorative shader clock (`setDecorClock`); null: the motion clock drives uTime. */
  let decorClock: (() => number | null) | null = null;
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
    if (driving && drivenFov !== null) {
      if (Math.abs(camera.fov - drivenFov) <= 1e-4) return;
      camera.fov = drivenFov;
      camera.updateProjectionMatrix();
      return;
    }
    const pose = rig.get();
    const aspect = size[0] / Math.max(1, size[1]);
    const k = rig.landingWeight(now);
    const want =
      k >= 1 ? vfovFor(pose, fit, aspect) : VFOV_DEG + (vfovFor(pose, fit, aspect) - VFOV_DEG) * k;
    if (Math.abs(camera.fov - want) <= 1e-4) return;
    camera.fov = want;
    camera.updateProjectionMatrix();
  };

  /** Materials inside a `warmDraw` (colorWrite off): their own colorWrite and the open warm-ups. */
  const warmColor = new WeakMap<THREE.Material, { n: number; cw: boolean }>();
  /** renderNow: this tick renders whatever the GPU pacing says. */
  let forced = false;
  const pacer = createGpuPacer(renderer.getContext() as WebGL2RenderingContext);
  undo.push(() => pacer.dispose());
  let composer = new EffectComposer(renderer);
  let passes: Pass[] = [];
  /** The live GTAO pass (null on Low or before the first tier), for the per-mood blend. */
  let aoPass: CityGTAOPass | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  /** Tilt-shift (B-T5): wanted by the settings, the live pass, its subject, the current tier. */
  let dofWanted = false;
  let bokehPass: CityBokehPass | null = null;
  const focusPoint = new THREE.Vector3();
  let focusSet = false;
  let tierNow: Tier = tier;
  const bokehSkip: THREE.Object3D[] = [];
  const focusNow = (out: THREE.Vector3) =>
    focusSet ? out.copy(focusPoint) : out.copy(controls.target);
  const focusTmp = new THREE.Vector3();
  const aimBokeh = () => {
    if (!bokehPass) return;
    focusNow(focusTmp);
    bokehPass.aim(focusDepth(camera, focusTmp), camera.position.distanceTo(focusTmp), focusSet);
  };
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
    tierNow = t;
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
    aoPass = null;
    // AO normal/depth pass without the far LOD2 blocks (I3).
    if (spec.ao) {
      // Agents too: small and moving, their AO is invisible and their draws would double.
      // B-T4 tuning: clay contact shadows that shade but never blacken (lighting.ts AO_PARAMS),
      // blended per mood (LightPreset.aoBlend, kept current in setLighting).
      const params = {
        ...AO_PARAMS,
        blendIntensity: lastPreset?.aoBlend ?? AO_PARAMS.blendIntensity,
      };
      const ao = new CityGTAOPass(
        scene,
        camera,
        w,
        h,
        () => {
          aoSkip.length = 0;
          // The sky dome is drawn at the far plane (xyww); with the override materials' standard
          // projection it became a 1 m ball at the site origin (an AO ring, a wrong focus depth).
          aoSkip.push(sky.mesh);
          // Decorative things the journey cut hides must not draw into the post passes either,
          // or their depth stays in front of her (DoF blurred her through a hidden canopy, 9.1 F3).
          if (currentTreeCut.value) for (const o of decorCuttable()) aoSkip.push(o);
          if (assets) for (const o of assets.aoExcluded()) aoSkip.push(o);
          if (motionLayer) aoSkip.push(motionLayer.group);
          // The flood tint is data on the ground: AO must not darken it.
          if (overlays) aoSkip.push(overlays.groundGroup, overlays.lineGroup);
          // The journey ribbon is Line2 quads (paint over the ground), not a surface for AO.
          if (journey) aoSkip.push(journey.ribbon);
          if (devsim?.aoExcluded) for (const o of devsim.aoExcluded()) aoSkip.push(o);
          return aoSkip;
        },
        params,
      );
      aoPass = ao;
      passes.push(ao);
    }
    // Tilt-shift (B-T5) after AO, before the markers: markers, residents and journey pins are
    // drawn after it (overlay pass, renderJourneyMarkers) and are never blurred.
    bokehPass = null;
    if (spec.dof && dofWanted) {
      bokehPass = new CityBokehPass(scene, camera, () => {
        bokehSkip.length = 0;
        bokehSkip.push(sky.mesh);
        if (currentTreeCut.value) for (const o of decorCuttable()) bokehSkip.push(o);
        if (overlays) bokehSkip.push(overlays.lineGroup);
        if (journey) bokehSkip.push(journey.ribbon);
        return bokehSkip;
      });
      aimBokeh();
      passes.push(bokehPass);
    }
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
    // B-T4 shadow frame: the box follows the focus (>= 70 m), fades out at range.
    const shadow = shadowFrame(camera.position.distanceTo(t), sun.shadow.mapSize.x);
    sun.shadow.intensity = shadow.strength;
    sun.shadow.normalBias = shadow.normalBias;
    // Faded out (far camera): stop re-rendering the shadow map.
    sun.shadow.autoUpdate = shadow.strength > 0;
    const fit = fitShadowCamera([t.x, t.z], shadow.halfSize, keyDir);
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

  // A camera driver (the journey follow camera): it owns the camera while it returns a pose.
  let driver: CameraDriver | null = null;
  let driving = false;
  /** The driver's pinned fov (DrivenCamera.fovDeg), or null: the rig's. */
  let drivenFov: number | null = null;
  const _cur = {
    position: [0, 0, 0] as [number, number, number],
    look: [0, 0, 0] as [number, number, number],
  };
  const driveCamera = (now: number): { driven: boolean; animating: boolean } => {
    let pose: DrivenCamera | null = null;
    if (driver) {
      // filled in place: no arrays per frame (final review)
      _cur.position[0] = camera.position.x;
      _cur.position[1] = camera.position.y;
      _cur.position[2] = camera.position.z;
      _cur.look[0] = controls.target.x;
      _cur.look[1] = controls.target.y;
      _cur.look[2] = controls.target.z;
      pose = driver(now, _cur);
    }
    drivenFov = pose?.fovDeg ?? null;
    if (!pose) {
      if (driving) {
        driving = false;
        controls.enabled = true;
      }
      return { driven: false, animating: false };
    }
    if (!driving) {
      driving = true;
      controls.enabled = false;
      lift.reset();
    }
    // flights and fit landings asked for meanwhile are dropped: the driver has the camera
    rig.halt();
    const [x, y, z] = pose.position;
    const [lx, ly, lz] = pose.look;
    const p = camera.position;
    const t = controls.target;
    if (p.x !== x || p.y !== y || p.z !== z || t.x !== lx || t.y !== ly || t.z !== lz) {
      lastMove = now;
      lod.moved();
    }
    p.set(x, y, z);
    t.set(lx, ly, lz);
    camera.lookAt(t);
    camera.updateMatrixWorld();
    liftM = 0;
    lifted.set(Number.NaN, 0, 0);
    return { driven: true, animating: !!pose.animating };
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
    // GPU pacing (gpuPacer.ts): at most two frames ahead of the GPU; otherwise try again next frame
    if (!forced && !pacer.ready(now)) {
      raf = requestAnimationFrame(tick);
      return;
    }
    unlift();
    const drive = driveCamera(now);
    const flying = drive.driven ? false : rig.step(now);
    if (flying) {
      lastMove = now;
      lod.moved();
    }
    const damping = drive.driven ? false : controls.update();
    // Drags, wheel zoom and flight frames stay bound to the slab (A-T5); the lift comes after.
    if (!drive.driven) rig.constrain();
    syncFov(now);
    const lifting = drive.driven ? false : clearCamera(now);
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
      // The shadow box half size is the shadow frame's (placeLight); no casters needed once faded.
      if (assets) {
        const sf = shadowFrame(rangeM, sun.shadow.mapSize.x);
        assets.update(
          camera.position,
          cullFrustum(
            camera,
            shadowPadM(sun.castShadow && sf.strength > 0, sf.halfSize),
            cull,
            viewProj,
          ),
        );
      }
      lodTick.target.x = controls.target.x;
      lodTick.target.z = controls.target.z;
      lodTick.rangeM = rangeM;
      lodTick.nowMs = now;
      let more = false;
      for (const cb of lodCbs) if (cb(lodTick)) more = true;
      // More tiles to plan: one more LOD tick an interval later (the trailing timer wakes it).
      if (more) lod.moved();
    }
    // A journey's trip time drives the decorative motion while a trip is loaded: shader sway and
    // shimmer, and the decorative people and cars (their routes are seeded functions of time), so
    // a paused beat draws the same at any wall time (AC-D17). Otherwise the motion clock.
    const decorT = decorClock?.() ?? null;
    const tripMs =
      decorT !== null && Number.isFinite(decorT) ? DECOR_EPOCH_MS + decorT * 1000 : null;
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
      motionLayer.tick(tripMs ?? clock.at, camera.position, frustum, tripMs !== null);
    }
    if (tripMs !== null) motion.uTime.value = tripMs / 1000;
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
    devsim?.beforeRender(camera, size, now);
    aimBokeh();
    const tRender = performance.now();
    // The scene pass always draws into the same target (ITER2 AC-D18). The composer ping-pongs its
    // two targets once per swapping pass, so when a pass turns on or off (the depth of field once
    // the journey sets its subject) the scene pass moved to the other target, where none of the
    // city's programs had drawn yet: ANGLE / D3D11 built their executables there at the dive
    // (~66 first draws, one 160-360 ms frame at Ask+1.3-1.6 s). Nothing reads the scene target
    // across frames (the scene pass clears it), so pinning it changes no pixel.
    if (
      composer.renderTarget1 &&
      composer.readBuffer !== composer.renderTarget1 &&
      typeof composer.swapBuffers === "function"
    )
      composer.swapBuffers();
    composer.render();
    renderJourneyMarkers();
    if (warming.length > 0) {
      for (const g of warming) releaseWarmDraws(g);
      warming = [];
    }
    if (standWarm.length > 0) drawStandWarm();
    pacer.submitted(now);
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
    if (flying || damping || dirty || lifting || drive.animating) schedule();
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
  // The place / waste / centre markers' program (the overlay layers rebuild their markers when an
  // answer lands): compiled now, in the background, and pinned once it renders.
  void compileRoot(markerProgramStandIn(), composer.readBuffer, false, overlayScene);
  // The overlay lines and the journey ribbon variants (the route line of an answer was linked on
  // its first draw), for both scenes they can draw in.
  // Every fog / shadow combination they are drawn with (a no-shadow, fogged variant was still
  // linked on first draw): the scene state is switched only around the synchronous compile.
  for (const fogOn of [true, false])
    for (const shadowOn of [true, false]) {
      const fog = scene.fog;
      const cast = sun.castShadow;
      // the mood sets linear fog later; only its presence and kind pick the variant
      scene.fog = fogOn ? (fog ?? new THREE.Fog(new THREE.Color(), 1, 2)) : null;
      sun.castShadow = cast && shadowOn;
      try {
        void compileRoot(lineProgramStandIns(), composer.readBuffer, false);
      } finally {
        scene.fog = fog;
        sun.castShadow = cast;
      }
    }
  // The journey's event markers (their own scene, straight to the canvas), first drawn when the
  // answer lands: compiled now (ITER2 AC-D18).
  {
    // kept for the engine's life (one sprite and a 1x1 texture): its program stays in use
    const standIn = journeyMarkerStandIn();
    void compileRoot(standIn, null, false, standIn);
    undo.push(() =>
      standIn.traverse((o) => {
        const m = (o as THREE.Sprite).material as THREE.SpriteMaterial | undefined;
        m?.map?.dispose();
        m?.dispose();
      }),
    );
  }
  // the overlay scene (no lights) with and without the mood's fog
  for (const fogOn of [true, false]) {
    const fog = overlayScene.fog;
    overlayScene.fog = fogOn ? (fog ?? new THREE.Fog(new THREE.Color(), 1, 2)) : null;
    try {
      void compileRoot(lineProgramStandIns(), composer.readBuffer, false, overlayScene);
    } finally {
      overlayScene.fog = fog;
    }
  }

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
      // synchronous (acceptance measurements, captures): never deferred by the GPU pacing
      forced = true;
      try {
        tick();
      } finally {
        forced = false;
      }
    },
    setDecor(slot, d) {
      if (disposed) {
        d?.dispose();
        return;
      }
      if (d && (decor.get(slot) === d || compiling.get(slot) === d)) return;
      if (d) runPatches(d.group);
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
      // screen: the program variant must be the one the composer's render will use. A synchronous
      // throw shows the layer anyway (it then compiles on its first render as before).
      compileRoot(d.group, composer.readBuffer).then(ready, ready);
    },
    markSwap() {
      if (disposed) return;
      swapped = true;
      requestRender();
    },
    prepare(obj) {
      if (disposed) return Promise.resolve();
      // compile() gathers materials with traverse(), not traverseVisible(): hidden LOD buckets and
      // crowd meshes (visible = false until an agent is drawn on them) are compiled too, with the
      // AO / depth-of-field override variants of their meshes (compileRoot).
      return compileRoot(obj, composer.readBuffer).then(
        () => {},
        (err) => warnCompileOnce(err),
      );
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
      runPatches(city);
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
        runPatches(a.group);
        scene.add(a.group);
        // Its LOD buckets show as the camera moves: their programs compile now, in the background.
        void compileRoot(a.group, composer.readBuffer);
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
    setCameraDriver(d) {
      if (disposed) return;
      driver = d;
      requestRender();
    },
    releaseCameraDriver(d) {
      if (disposed || driver !== d) return;
      driver = null;
      requestRender();
    },
    cameraDriven: () => driving,
    setOverlays(o) {
      if (disposed) return;
      if (o && o === pendingOverlays) return;
      if (o === overlays) {
        // the shown layer again: a newer one still compiling is cancelled (disposed, never shown)
        pendingOverlays?.dispose();
        pendingOverlays = null;
        return;
      }
      pendingOverlays?.dispose();
      pendingOverlays = null;
      if (!o) {
        dropOverlays();
        requestRender();
        return;
      }
      const attach = () => {
        if (disposed || pendingOverlays !== o) return;
        pendingOverlays = null;
        dropOverlays();
        overlays = o;
        o.setResolution(size[0], size[1]);
        o.setPixelRatio(pixelRatio);
        syncDashes(true);
        overlayScene.add(o.group);
        scene.add(o.groundGroup);
        scene.add(o.lineGroup);
        requestRender();
      };
      pendingOverlays = o;
      if (typeof renderer.compileAsync !== "function") {
        attach();
        return;
      }
      // Their programs compile in parallel before they show, the previous layer drawn meanwhile:
      // the answer's route and place markers linked on first draw (gate AC-D18). A layer replaced
      // while compiling is never shown, and is disposed like a replaced one.
      Promise.all([
        compileRoot(o.group, composer.readBuffer, false, overlayScene),
        compileRoot(o.groundGroup, composer.readBuffer, false),
        compileRoot(o.lineGroup, composer.readBuffer, false),
      ]).then(attach, attach);
    },
    setJourney(j) {
      if (disposed) {
        j?.dispose();
        return;
      }
      if (j === journey) return;
      dropJourney();
      if (pendingJourney && pendingJourney !== j) pendingJourney.dispose();
      pendingJourney = null;
      if (!j) {
        requestRender();
        return;
      }
      const attach = () => {
        if (disposed || pendingJourney !== j) return;
        pendingJourney = null;
        journey = j;
        j.setResolution(size[0], size[1]);
        scene.add(j.ribbon);
        swapped = true;
        requestRender();
      };
      pendingJourney = j;
      if (typeof renderer.compileAsync !== "function") {
        attach();
        return;
      }
      // The ribbon (scene pass) and the markers (drawn to the canvas) compile in parallel before
      // they are shown: no program links on the main thread when the answer lands (gate AC-D18).
      Promise.all([
        compileRoot(j.ribbon, composer.readBuffer, false),
        // the markers draw in their own scene (no fog, no lights), straight to the canvas
        compileRoot(j.markers, null, false, j.markers),
      ]).then(attach, attach);
    },
    setDevsim(l) {
      if (disposed) {
        l?.dispose();
        return;
      }
      if (l === devsim) return;
      dropDevsim();
      if (l) {
        runPatches(l.group);
        devsim = l;
        scene.add(l.group);
        swapped = true;
      }
      requestRender();
    },
    setDecorClock(c) {
      if (disposed) return;
      decorClock = c;
      requestRender();
    },
    releaseDecorClock(c) {
      if (disposed || decorClock !== c) return;
      decorClock = null;
      requestRender();
    },
    addMaterialPatch(patch) {
      materialPatches.add(patch);
      if (!disposed && patch(scene) > 0) void compileRoot(scene, composer.readBuffer);
      return () => {
        materialPatches.delete(patch);
      };
    },
    warmDraw(obj, frames = 2) {
      if (disposed) return Promise.resolve();
      const mats: THREE.Material[] = [];
      obj.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) {
          // overlapping warm draws of one model (a second preload before the first ended) must
          // restore the material's own colorWrite, never the first warm-up's false (ITER2: the
          // hero stayed invisible once the frame pacing changed the timing)
          const w = warmColor.get(x);
          if (w) w.n++;
          else warmColor.set(x, { n: 1, cw: x.colorWrite });
          mats.push(x);
          x.colorWrite = false;
        }
        o.frustumCulled = false;
      });
      obj.position.set(controls.target.x, -3, controls.target.z);
      obj.updateMatrixWorld(true);
      scene.add(obj);
      return new Promise<void>((done) => {
        let n = 0;
        const off = this.onFrame(() => {
          if (++n < frames) {
            requestRender();
            return;
          }
          off();
          scene.remove(obj);
          for (const x of mats) {
            const w = warmColor.get(x);
            if (!w) continue;
            if (--w.n > 0) continue;
            x.colorWrite = w.cw;
            warmColor.delete(x);
          }
          done();
        });
        requestRender();
      });
    },
    prewarm(root) {
      if (disposed) return Promise.resolve();
      return compileRoot(root ?? scene, composer.readBuffer).then(() => undefined);
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
      if (aoPass) aoPass.blendIntensity = p.aoBlend;
      GROUND_GRADE.value = p.groundGrade;
      ROAD_GRADE.value = p.roadGrade;
      FOLIAGE_GRADE.value = foliageGradeFor(p.groundGrade);
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
    setDof(on) {
      if (disposed || on === dofWanted) return;
      dofWanted = on;
      // Rebuild the chain only when the tier has depth of field (otherwise nothing changes).
      if (THREE_TIERS[tierNow].dof) applyTier(tierNow);
    },
    setFocusPoint(p) {
      if (disposed) return;
      focusSet = !!p;
      if (p) focusPoint.copy(p);
      requestRender();
    },
    effects() {
      return { dof: bokehPass !== null, ao: aoPass !== null };
    },
    focusScreen() {
      focusNow(focusTmp);
      camera.updateMatrixWorld();
      const v = focusTmp.project(camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * size[0], y: ((1 - v.y) / 2) * size[1] };
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
