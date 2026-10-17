import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Tier } from "../cesium/stylised/quality";
import { ROUTE_STYLE } from "../styles";
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
import { fitShadowCamera, type LightPreset } from "./lighting";
import { THREE_TIERS } from "./quality";

/** Local xz box the camera target may not leave (by more than LIMITS.maxCentreOffsetM). */
export interface Bounds {
  min: [number, number];
  max: [number, number];
}

export interface FrameInfo {
  calls: number;
  moving: boolean;
}

export interface Engine {
  readonly frames: number;
  setCity(g: CityGeometry): void;
  /** Camera bounds before the city arrives (the site extent); setCity replaces them. */
  setBounds(b: Bounds): void;
  setRoute(positions: Float32Array | null): void;
  setLighting(p: LightPreset, keyDir: [number, number, number]): void;
  setTier(t: Tier): void;
  setViewOffset(panelPx: number): void;
  resize(w: number, h: number): void;
  rig: CameraRig;
  requestRender(): void;
  onFrame(cb: (dtMs: number, info: FrameInfo) => void): () => void;
  /** Unrecoverable runtime failure (context lost, shader compile/link error): the caller falls back. */
  onFatal(cb: (err: Error) => void): () => void;
  gl(): WebGL2RenderingContext;
  dispose(): void;
}

const RAD = Math.PI / 180;
const MOVING_MS = 300;
const GROUND_COLOUR = "#d6d0c2";
const BLOOM = { strength: 0.6, radius: 0.4, threshold: 0.85 };

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
  renderer.toneMapping = THREE.AgXToneMapping;
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

  const buildingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
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

  const lineMat = new LineMaterial({
    color: new THREE.Color(ROUTE_STYLE.color),
    linewidth: ROUTE_STYLE.width,
    depthTest: false,
    transparent: true,
  });
  const route = new Line2(new LineGeometry(), lineMat);
  route.renderOrder = 10;
  route.frustumCulled = false;
  route.visible = false;
  scene.add(route);
  undo.push(() => {
    route.geometry.dispose();
    for (const m of [buildingMat, flatMat, groundMat, lineMat]) m.dispose();
    sun.shadow.map?.dispose();
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
    requestRender();
  };

  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
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
  undo.push(() => {
    for (const p of passes) p.dispose();
    composer.dispose();
  });
  const applyTier = (t: Tier) => {
    const spec = THREE_TIERS[t];
    const pr = Math.min(globalThis.devicePixelRatio || 1, spec.maxPixelRatio);
    renderer.setPixelRatio(pr);
    renderer.shadowMap.enabled = spec.shadows;
    sun.castShadow = spec.shadows;
    if (spec.shadows) {
      sun.shadow.mapSize.set(spec.shadowMapSize, spec.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    for (const m of [buildingMat, flatMat, groundMat]) m.needsUpdate = true;
    for (const p of passes) p.dispose();
    composer.dispose();
    const [w, h] = size;
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(pr);
    passes = [new RenderPass(scene, camera)];
    if (spec.ao) passes.push(new GTAOPass(scene, camera, w, h));
    if (spec.bloom)
      passes.push(
        new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM.strength, BLOOM.radius, BLOOM.threshold),
      );
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
    if (flying) lastMove = now;
    const damping = controls.update();
    placeLight();
    renderer.info.reset();
    composer.render();
    dirty = false;
    frames++;
    const dt = idle ? 0 : now - last;
    last = now;
    idle = false;
    const info = { calls: renderer.info.render.calls, moving: now - lastMove < MOVING_MS };
    for (const cb of listeners) cb(dt, info);
    if (flying || damping || dirty) schedule();
    if (!raf) idle = true;
  }

  const onVisibility = () => {
    if (visible()) {
      requestRender();
      return;
    }
    cancelAnimationFrame(raf);
    raf = 0;
    idle = true;
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
    requestRender,
    setCity(g) {
      if (disposed) return;
      disposeCity();
      const buildings = new THREE.Mesh(g.buildings, buildingMat);
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      const parks = new THREE.Mesh(g.parks, flatMat);
      const water = new THREE.Mesh(g.water, flatMat);
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
    setBounds(b) {
      if (disposed) return;
      bounds = b;
    },
    setRoute(positions) {
      if (disposed) return;
      if (!positions || positions.length < 6) {
        route.visible = false;
      } else {
        route.geometry.dispose();
        route.geometry = new LineGeometry().setPositions(positions);
        route.visible = true;
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
      scene.fog = new THREE.Fog(p.fog.color, p.fog.near, p.fog.far);
      requestRender();
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
      lineMat.resolution.set(w, h);
      applyViewOffset();
      requestRender();
    },
    onFrame(cb) {
      if (disposed) return () => {};
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onFatal(cb) {
      if (disposed) return () => {};
      fatalCbs.add(cb);
      return () => fatalCbs.delete(cb);
    },
    gl: () => renderer.getContext() as WebGL2RenderingContext,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      listeners.clear();
      fatalCbs.clear();
      release();
    },
  };
}
