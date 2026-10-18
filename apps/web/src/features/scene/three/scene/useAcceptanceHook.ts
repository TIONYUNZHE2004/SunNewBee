import { useEffect } from "react";
import * as THREE from "three";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createFrameStats, type PerfSample } from "../frameStats";
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
  /** Vertices in the visible road-surface meshes: the streamed road layer has arrived when > 0. */
  roadVertices(): number;
  /** The scene's live fog (colour as #rrggbb sRGB, distances in metres) and background colour; null when fog is off. */
  fog(): { color: string; near: number; far: number; background: string } | null;
  /** Lamp-pool centres on screen (page-independent canvas CSS pixels), those inside the canvas only. */
  lampPoints(): { x: number; y: number }[];
  /**
   * Shows or hides the data-overlay scene (access lines, flood tint: `pickView().roots[0]`) so a capture
   * can measure the surface under them. Display only; the lines' own fade is A-T2's.
   */
  setOverlaysVisible(visible: boolean): void;
  /** The unmasked WebGL vendor and renderer (WEBGL_debug_renderer_info), else the masked ones. */
  gpu(): { vendor: string; renderer: string };
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
  return engine.rig.pick(screen) ? "ground" : "sky";
}

export function createAcceptanceApi(engine: Engine, frame: LocalFrame): AcceptanceApi {
  return {
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
    gpu() {
      const gl = engine.gl();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      };
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
