import * as THREE from "three";
import { type HeroVariant, walkRate } from "../assets/heroManifest";
import type { Engine } from "../engine";
import { clayMaterial } from "../shared/clayTokens";
import { HERO_BENCH, HERO_MANIFEST } from "./benchGeometry";
import { createGlbHero, type GlbHero } from "./glbHero";
import { HERO_DISPLAY_SCALE, type HeroClip, type HeroContact } from "./hero";
import { createRestBench } from "./placeholderHero";

/**
 * C-T4 acceptance test scene (H5, H6, H7, H11), installed only through the acceptance hook
 * (`window.__tlAcceptance.heroLab()`, dev or `?acceptance=1`): a flat footway strip and a bench at
 * the camera target in the live Stylised scene, with the GLB hero on it. Sampling poses the hero
 * synchronously through the same `Hero` calls the journey player makes (clip time set, never
 * accumulated), so a sample at t is exactly the frame drawn at t. Test display only: it never
 * touches the plan, the timeline, intents or data.
 */
export const HERO_LAB_SLOT = "hero-lab";
/** Footway strip: 2.4 m wide, 40 m long, top a little above the city's footway band (0.08 m). */
const FOOT_W = 2.4;
const FOOT_L = 40;
export const HERO_LAB_TOP_Y = 0.12;
/** The walk lane starts this far behind the lab centre (local -z). */
const WALK_START_M = 15;
/** The bench station: this far along local +x from the walk lane (her back to the bench). */
const BENCH_STATION_X = 0;
const BENCH_STATION_Z = 17;

export interface LabSample {
  t: number;
  clip: HeroClip;
  contacts: HeroContact[];
  /** Palm-to-grip distances [left, right], displayed metres (null without the GLB). */
  grips: [number, number] | null;
  /** Hips bone, world. */
  hips: [number, number, number] | null;
  /** Root, world. */
  root: [number, number, number];
  /** Walker / stroller contacts in her frame (x her left, z her front), displayed metres. */
  propLocal: [number, number, number][];
  /** Deepest LOD0 skinned vertex inside the bench seat or backrest box (m, displayed); sampled only on request. */
  benchDepthM?: number;
}

export interface HeroLab {
  open(opts?: { variant?: HeroVariant }): Promise<{ model: string; variant: HeroVariant }>;
  /** Walking along the footway at `speed` m/s (true pace) for `seconds`, sampled at `hz`. */
  walk(speed: number, seconds: number, hz: number): LabSample[];
  /** A clip at the bench station (her back to the bench), sampled at `hz` over `seconds`. */
  clip(clip: HeroClip, seconds: number, hz: number, opts?: { bench?: boolean }): LabSample[];
  /** Poses one frame for a screenshot and frames the camera on her (side or behind). */
  show(
    clip: HeroClip,
    time: number,
    view: "side" | "behind" | "front",
    at?: "walk" | "bench",
  ): { x: number; y: number };
  /** Runs her walking back and forth at true pace every frame (H11 "with"), or stops. */
  /**
   * Runs her walk path every frame at true pace (H11), with the camera at the follow pose on her
   * path; `pose: false` moves only the camera (the "without" side). `on: false` stops and hands the
   * camera back to the rig.
   */
  animate(on: boolean, speed?: number, opts?: { pose?: boolean }): void;
  setVisible(on: boolean): void;
  /** Uncapped frame time (renderNow + gl.finish) with her animated per frame or hidden. */
  uncapped(
    frames: number,
    withHero: boolean,
    opts?: { animate?: boolean },
  ): { medianMs: number; p95Ms: number; frames: number };
  /** CPU time of one pose (set clip time, mixer, planting), median over `n` poses at true pace. */
  poseMs(n: number): number;
  /** Diagnostics for H11: show only the hero parts whose name starts with one of `names`. */
  showParts(names: string[]): void;
  /** Shadow casting on the hero meshes (diagnostics for H11). */
  setShadows(on: boolean): void;
  /** The lab footway top height and the bench seat top (world y). */
  levels(): { footwayY: number; seatY: number; scale: number };
  lod(): number | null;
  /**
   * C-T5 capture: poses her (`at` the walk lane or the bench), pins the camera in her frame
   * (`cam`: metres to her left (+) / right (-), up, and behind (+) / in front (-) of her root, looking
   * at `lookY` m above her root), renders one frame and returns it as a PNG data URL scaled to
   * `out` px. The camera goes back to the rig afterwards.
   */
  snap(o: {
    clip: HeroClip;
    time: number;
    at: "walk" | "bench";
    cam: { side: number; up: number; back: number };
    lookY?: number;
    out?: [number, number];
  }): string;
  close(): void;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : 0;
};

export function createHeroLab(engine: Engine): HeroLab {
  let group: THREE.Group | null = null;
  let hero: GlbHero | null = null;
  let disposeAll: (() => void) | null = null;
  let centre: [number, number] = [0, 0];
  let raf = 0;
  const v = new THREE.Vector3();

  const need = (): GlbHero => {
    if (!hero) throw new Error("heroLab: open() first");
    return hero;
  };
  /** Where she is on the walk lane at t: back and forth along z, turning at the ends. */
  const pathAt = (speed: number, t: number) => {
    const lap = FOOT_L - 12;
    const d = (speed * t) % (2 * lap);
    const fwd = d < lap;
    return {
      x: centre[0],
      z: centre[1] - WALK_START_M + (fwd ? d : 2 * lap - d),
      yaw: fwd ? 0 : Math.PI,
    };
  };
  const walkAt = (speed: number, t: number) => {
    const h = need();
    const sp = HERO_MANIFEST.variants[h.variant] ?? HERO_MANIFEST.variants.walker;
    const rate = sp ? walkRate(sp, speed, HERO_DISPLAY_SCALE) : 1;
    const p = pathAt(speed, t);
    h.setPose({ x: p.x, y: HERO_LAB_TOP_Y, z: p.z }, p.yaw);
    h.play("walk", t * rate, rate);
  };
  /** The follow pose (spec H8): 8.5 m behind, 4.5 m to her left, 4.2 m up, on her path point. */
  const followCam = (speed: number, t: number) => {
    const p = pathAt(speed, t);
    const c = Math.cos(p.yaw);
    const n = Math.sin(p.yaw);
    // her frame (side, up, -back) rotated by yaw about y
    const lx = 4.5;
    const lz = -8.5;
    engine.setCameraOverride?.({
      position: [p.x + lx * c + lz * n, HERO_LAB_TOP_Y + 4.2, p.z - lx * n + lz * c],
      target: [p.x, HERO_LAB_TOP_Y + 1.2, p.z],
    });
  };
  let followPose: ReturnType<Engine["rig"]["get"]> | null = null;
  const startFollow = () => {
    followPose ??= engine.rig.get();
  };
  const stopFollow = () => {
    if (!followPose) return;
    engine.setCameraOverride?.(null);
    engine.rig.set(followPose);
    followPose = null;
    engine.requestRender();
  };
  /** The drawn model's root (the GLB, or the placeholder when it did not load). */
  const heroRoot = (): THREE.Object3D => {
    const h = need();
    return h.model()?.object3d ?? (h.object3d.children[0] as THREE.Object3D);
  };
  const benchPose = (clip: HeroClip, time: number) => {
    const h = need();
    h.setPose(
      { x: centre[0] + BENCH_STATION_X, y: HERO_LAB_TOP_Y, z: centre[1] + BENCH_STATION_Z },
      Math.PI, // facing -z (back to the bench behind her at +z)
    );
    h.play(clip, time, 0);
  };

  const sample = (t: number, clip: HeroClip, bench = false): LabSample => {
    const h = need();
    const m = h.model();
    const root = heroRoot();
    root.updateWorldMatrix(true, true);
    const contacts = h.contacts();
    const propLocal = contacts
      .filter((c) => !c.name.startsWith("foot"))
      .map((c) => root.worldToLocal(v.set(c.x, c.y, c.z)).toArray() as [number, number, number]);
    const s: LabSample = {
      t,
      clip,
      contacts,
      grips: m ? m.gripErrors() : null,
      hips: m ? (m.bone("hips").getWorldPosition(v).toArray() as [number, number, number]) : null,
      root: root.getWorldPosition(v).toArray() as [number, number, number],
      propLocal,
    };
    if (bench && m) {
      const k = HERO_DISPLAY_SCALE;
      let worst = 0;
      const boxes = [HERO_BENCH.seat, HERO_BENCH.back].map(
        (b) =>
          new THREE.Box3(
            new THREE.Vector3(...b.min).multiplyScalar(k),
            new THREE.Vector3(...b.max).multiplyScalar(k),
          ),
      );
      for (const p of m.bodyPoints()) {
        // her frame (the bench stands on the same footway as her root)
        const l = root.worldToLocal(p);
        for (const b of boxes)
          if (b.containsPoint(l))
            worst = Math.max(
              worst,
              Math.min(
                l.x - b.min.x,
                b.max.x - l.x,
                l.y - b.min.y,
                b.max.y - l.y,
                l.z - b.min.z,
                b.max.z - l.z,
              ),
            );
      }
      s.benchDepthM = worst;
    }
    return s;
  };

  const lab: HeroLab = {
    async open(opts = {}) {
      lab.close();
      const p = engine.rig.get();
      centre = [p.target[0], p.target[1]];
      const g = new THREE.Group();
      g.name = "hero-lab";
      const footGeo = new THREE.BoxGeometry(FOOT_W, 0.1, FOOT_L);
      const footMat = clayMaterial("road");
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(
        centre[0],
        HERO_LAB_TOP_Y - 0.05,
        centre[1] - WALK_START_M + FOOT_L / 2 - 3,
      );
      foot.receiveShadow = true;
      g.add(foot);
      // bench pad under the bench station, the same flat top
      const padGeo = new THREE.BoxGeometry(3.2, 0.1, 2.4);
      const pad = new THREE.Mesh(padGeo, footMat);
      pad.position.set(
        centre[0] + BENCH_STATION_X,
        HERO_LAB_TOP_Y - 0.05,
        centre[1] + BENCH_STATION_Z + 0.5,
      );
      pad.receiveShadow = true;
      g.add(pad);
      const bench = createRestBench();
      bench.object3d.position.set(
        centre[0] + BENCH_STATION_X,
        HERO_LAB_TOP_Y,
        centre[1] + BENCH_STATION_Z,
      );
      bench.object3d.rotation.y = Math.PI;
      g.add(bench.object3d);
      const h = createGlbHero({
        variant: opts.variant ?? "walker",
        onReady: () => engine.requestRender(),
      });
      h.setGround(() => HERO_LAB_TOP_Y);
      g.add(h.object3d);
      hero = h;
      group = g;
      disposeAll = () => {
        h.dispose();
        bench.dispose();
        footGeo.dispose();
        padGeo.dispose();
        footMat.dispose();
      };
      engine.setDecor(HERO_LAB_SLOT, { group: g, dispose: () => disposeAll?.() });
      await h.ready;
      benchPose("idle", 0);
      engine.requestRender();
      return { model: h.kind(), variant: h.variant };
    },
    walk(speed, seconds, hz) {
      const out: LabSample[] = [];
      for (let i = 0; i <= Math.round(seconds * hz); i++) {
        const t = i / hz;
        walkAt(speed, t);
        out.push(sample(t, "walk"));
      }
      return out;
    },
    clip(clip, seconds, hz, opts = {}) {
      const out: LabSample[] = [];
      for (let i = 0; i <= Math.round(seconds * hz); i++) {
        const t = i / hz;
        benchPose(clip, t);
        out.push(sample(t, clip, opts.bench));
      }
      return out;
    },
    snap(o) {
      if (o.at === "walk") walkAt(1.16, o.time);
      else benchPose(o.clip, o.time);
      if (o.at === "walk" && o.clip !== "walk") need().play(o.clip, o.time, 0);
      const root = heroRoot();
      root.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(o.cam.side, o.cam.up, -o.cam.back).applyMatrix4(root.matrixWorld);
      const t = new THREE.Vector3(0, o.lookY ?? 1.2, 0).applyMatrix4(root.matrixWorld);
      const render = engine.renderNow;
      if (!render || !engine.setCameraOverride)
        throw new Error("engine lacks renderNow / setCameraOverride");
      const pose = engine.rig.get();
      engine.setCameraOverride({ position: p.toArray(), target: t.toArray() });
      render.call(engine);
      const src = engine.gl().canvas as HTMLCanvasElement;
      const [w, h] = o.out ?? [720, 450];
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      (c.getContext("2d") as CanvasRenderingContext2D).drawImage(src, 0, 0, w, h);
      const url = c.toDataURL("image/png");
      engine.setCameraOverride(null);
      engine.rig.set(pose);
      engine.requestRender();
      return url;
    },
    show(clip, time, view, at = clip === "walk" ? "walk" : "bench") {
      if (at === "walk") walkAt(1.16, time);
      else benchPose(clip, time);
      const root = heroRoot();
      root.getWorldPosition(v);
      const yaw = root.rotation.y;
      // heading: the camera looks along (sin h, -cos h); her front is (sin yaw, cos yaw)
      const front = Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * (180 / Math.PI);
      const headingDeg = view === "behind" ? front : view === "front" ? front + 180 : front + 90;
      engine.rig.set({ target: [v.x, v.z], rangeM: 30, pitchDeg: -8, headingDeg });
      engine.requestRender();
      const { camera, size } = engine.pickView();
      camera.updateMatrixWorld();
      const p = v
        .clone()
        .setY(v.y + 1.1)
        .project(camera);
      return { x: ((p.x + 1) / 2) * size[0], y: ((1 - p.y) / 2) * size[1] };
    },
    animate(on, speed = 1.16, opts = {}) {
      cancelAnimationFrame(raf);
      if (!on) {
        stopFollow();
        return;
      }
      startFollow();
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        if (opts.pose ?? true) walkAt(speed, t);
        followCam(speed, t);
        engine.requestRender();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    setVisible(on) {
      if (hero) hero.object3d.visible = on;
      engine.requestRender();
    },
    poseMs(n) {
      const ms: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        walkAt(1.16, i / 60);
        ms.push(performance.now() - t0);
      }
      return median(ms);
    },
    showParts(names) {
      need().object3d.traverse((o) => {
        const key = (o.userData.heroPart as string | undefined) ?? o.name;
        if (/__LOD\d$|^ring$|^disc$/.test(key)) o.visible = names.some((n) => key.startsWith(n));
      });
      engine.requestRender();
    },
    setShadows(on) {
      need().object3d.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.heroPart) o.castShadow = on;
      });
      engine.requestRender();
    },
    uncapped(frames, withHero, opts = {}) {
      const animate = opts.animate ?? true;
      const render = engine.renderNow;
      if (!render) throw new Error("engine.renderNow is missing");
      const gl = engine.gl();
      lab.setVisible(withHero);
      startFollow();
      const ms: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        if (withHero && animate) walkAt(1.16, i / 60);
        followCam(1.16, i / 60);
        render.call(engine);
        gl.finish();
        ms.push(performance.now() - t0);
      }
      stopFollow();
      const s = [...ms].sort((a, b) => a - b);
      return {
        frames,
        medianMs: median(ms),
        p95Ms: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0,
      };
    },
    levels: () => ({
      footwayY: HERO_LAB_TOP_Y,
      seatY: HERO_LAB_TOP_Y + HERO_BENCH.seatHeightM * HERO_DISPLAY_SCALE,
      scale: HERO_DISPLAY_SCALE,
    }),
    lod: () => hero?.model()?.lod() ?? null,
    close() {
      cancelAnimationFrame(raf);
      stopFollow();
      if (group) engine.setDecor(HERO_LAB_SLOT, null);
      group = null;
      hero = null;
      disposeAll = null;
    },
  };
  return lab;
}
