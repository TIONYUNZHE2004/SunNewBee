import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Tier } from "../cesium/stylised/quality";
import { CityGTAOPass } from "./aoPass";
import type { CityInstances } from "./assets/cityInstances";
import { createMotionUniforms, type MotionUniforms } from "./assets/roleMaterial";
import {
  type CameraRig,
  clampPose,
  LIMITS,
  type Pose,
  poseToCamera,
  tweenPose,
  VFOV_DEG,
  viewOffsetFor,
} from "./cameraRig";
import type { CityGeometry } from "./cityMesh";
import { cullFrustum, shadowPadM } from "./cull";
import { GROUND_BANDS, groundMaterial } from "./ground/bands";
import type { GroundLayer } from "./ground/groundLayer";
import { shimmerMaterial } from "./ground/landcover";
import { BLOOM, fitShadowCamera, type LightPreset } from "./lighting";
import { createLodSchedule } from "./lodSchedule";
import { applyFog } from "./mood";
import { createMotionClock, type MotionMode, motionModeFor } from "./motion/motionClock";
import type { MotionLayer } from "./motion/motionLayer";
import type { OverlayLayer } from "./overlays/accessLayers";
import { THREE_TIERS } from "./quality";

/** Local xz box the camera target may not leave (by more than LIMITS.maxCentreOffsetM). */
export interface Bounds {
  min: [number, number];
  max: [number, number];
}

export interface FrameInfo {
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

export interface Engine {
  readonly frames: number;
  setCity(g: CityGeometry): void;
  /** Instanced archetypes; replaces and disposes the previous set; null removes it. */
  setAssets(a: CityInstances | null): void;
  /** Land cover, roads and markings; replaces and disposes the previous layer; null removes it. */
  setGround(g: GroundLayer | null): void;
  /**
   * Decorative extras (lamp pools, birds, cloud shadows) by slot name: replaces and disposes the
   * slot's previous content; null clears it. The group is added to the scene as is.
   */
  setDecor(slot: string, d: { group: THREE.Object3D; dispose(): void } | null): void;
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
   * Access / gaps / route / what-if lines. They live in their own scene, drawn by a pass after the
   * AO pass, so ambient occlusion never darkens them and they sit above every prop. Replaces and
   * disposes the previous layer; null removes it.
   */
  setOverlays(o: OverlayLayer | null): void;
  setLighting(p: LightPreset, keyDir: [number, number, number]): void;
  /** Camera range in metres: fog distances scale with it so the township view is never fogged out. */
  setFogRange(rangeM: number): void;
  setTier(t: Tier): void;
  setViewOffset(panelPx: number): void;
  resize(w: number, h: number): void;
  rig: CameraRig;
  requestRender(): void;
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
const GROUND_COLOUR = "#d6d0c2";

export interface RigView {
  camera: THREE.PerspectiveCamera;
  /** The orbit target (MapControls' target). */
  target: THREE.Vector3;
  changed(): void;
  /** Canvas size in CSS pixels. */
  size(): [number, number];
}

export interface EngineRig extends CameraRig {
  /** Advances a flight to `now` (performance.now() clock); true while it is still running. */
  step(now: number): boolean;
}

/** Camera rig over a camera and orbit target. set() and flyTo() always apply clampPose. */
export function createRig(view: RigView, bounds: () => Bounds): EngineRig {
  let flight: { from: Pose; to: Pose; t0: number; ms: number } | null = null;
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
      apply(clampPose(p, bounds()));
    },
    flyTo(p, durationMs) {
      const to = clampPose(p, bounds());
      if (durationMs <= 0) {
        flight = null;
        apply(to);
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
      return false;
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

  const buildingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const parksMat = groundMaterial("parks", 0.95);
  const waterMat = groundMaterial("water", 0.95);
  const motion = createMotionUniforms();
  shimmerMaterial(waterMat, motion.uTime, "all");
  const groundMat = new THREE.MeshStandardMaterial({
    color: GROUND_COLOUR,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const city = new THREE.Group();
  scene.add(city);
  const disposeCity = () => {
    for (const o of [...city.children]) {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      city.remove(o);
    }
  };
  undo.push(disposeCity);

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
    overlays.dispose();
    overlays = null;
  };
  undo.push(() => {
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
  const dropGround = () => {
    if (!groundLayer) return;
    scene.remove(groundLayer.group);
    groundLayer.dispose();
    groundLayer = null;
  };
  undo.push(dropGround);

  const decor = new Map<string, { group: THREE.Object3D; dispose(): void }>();
  const dropDecor = (slot: string) => {
    const d = decor.get(slot);
    if (!d) return;
    scene.remove(d.group);
    d.dispose();
    decor.delete(slot);
  };
  undo.push(() => {
    for (const slot of [...decor.keys()]) dropDecor(slot);
  });

  let raf = 0;
  let dirty = true;
  let idle = true;
  let last = 0;
  let lastMove = Number.NEGATIVE_INFINITY;
  let frames = 0;
  let size: [number, number] = [1, 1];
  let panelPx = 0;
  let bounds: Bounds = { min: [0, 0], max: [0, 0] };
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
  // 0.95^(speed x |deltaY| / 100) per wheel event: about 26% per 200-unit notch (default: 10%).
  controls.zoomSpeed = 3;
  controls.minDistance = LIMITS.minRangeM;
  controls.maxDistance = LIMITS.maxRangeM;
  controls.minPolarAngle = (90 + LIMITS.minPitchDeg) * RAD;
  controls.maxPolarAngle = (90 + LIMITS.maxPitchDeg) * RAD;
  controls.addEventListener("change", moved);
  undo.push(() => {
    controls.removeEventListener("change", moved);
    controls.dispose();
  });

  const rig = createRig(
    { camera, target: controls.target, changed: moved, size: () => size },
    () => bounds,
  );

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
          if (overlays) aoSkip.push(overlays.groundGroup);
          return aoSkip;
        }),
      );
    // Overlays after the AO pass and before bloom/tone mapping: no occlusion on them, drawn on top.
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

  function tick() {
    raf = 0;
    if (disposed) return;
    const now = performance.now();
    const flying = rig.step(now);
    if (flying) {
      lastMove = now;
      lod.moved();
    }
    const damping = controls.update();
    clearTimeout(motionTimer);
    motionTimer = undefined;
    const live = motionMode !== null && !!motionLayer && motionRunning();
    // Resuming: motion time continues from the frozen clock, excluding the stopped span.
    if (live && !liveBefore) motionOffset = now - clock.at;
    liveBefore = live;
    // display: every live frame is a motion tick; 30 fps: a (re)start at once, then one per
    // MOTION_FRAME_MS with a few ms of slack for vsync jitter.
    const due = clock.frame(motionNow(now), live);
    if (live && !due && !dirty && !flying && !damping) {
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
    composer.render();
    dirty = false;
    frames++;
    const dt = idle ? 0 : now - last;
    last = now;
    idle = false;
    // autoReset is off, so calls and triangles add up over every pass of this frame.
    const info = {
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      moving: now - lastMove < MOVING_MS,
    };
    for (const cb of listeners) cb(dt, info);
    if (flying || damping || dirty) schedule();
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
    get frames() {
      return frames;
    },
    rig,
    motion,
    requestRender,
    setDecor(slot, d) {
      if (disposed) {
        d?.dispose();
        return;
      }
      if (d && decor.get(slot) === d) return;
      dropDecor(slot);
      if (d) {
        decor.set(slot, d);
        scene.add(d.group);
      }
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
      const buildings = new THREE.Mesh(g.buildings, buildingMat);
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      // The extruded (fallback) buildings are pickable buildings: the picker names one by face.
      buildings.userData.pick = { kind: "building" };
      buildings.userData.faces = g.faces;
      const parks = new THREE.Mesh(g.parks, parksMat);
      parks.renderOrder = GROUND_BANDS.parks.order;
      const water = new THREE.Mesh(g.water, waterMat);
      water.renderOrder = GROUND_BANDS.water.order;
      const plane = new THREE.PlaneGeometry(g.ground.size[0], g.ground.size[1]);
      plane.rotateX(-Math.PI / 2);
      const ground = new THREE.Mesh(plane, groundMat);
      ground.position.set(g.ground.center[0], 0, g.ground.center[1]);
      for (const m of [parks, water, ground]) m.receiveShadow = true;
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
      if (g) {
        groundLayer = g;
        scene.add(g.group);
      }
      requestRender();
    },
    setBounds(b) {
      if (disposed) return;
      bounds = b;
    },
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
      lastPreset = p;
      syncBloom();
      applyFog(scene, p, fogRange);
      requestRender();
    },
    setFogRange(rangeM) {
      if (disposed) return;
      fogRange = rangeM;
      if (lastPreset) {
        applyFog(scene, lastPreset, rangeM);
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
