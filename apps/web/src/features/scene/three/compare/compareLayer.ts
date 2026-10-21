import * as THREE from "three";
import type { CompareTimeline } from "../../../journey/compareTimeline";
import type { CompareIntent, CompareRoute } from "../../../journey/compareTypes";
import { createRoutePath, type RoutePath, type SpanEval } from "../../../journey/routePath";
import type { JourneyPlan } from "../../../journey/timeline";
import { COMPARE_RIBBON_STYLE } from "../../styles";
import { walkRate } from "../assets/heroManifest";
import { HERO_MANIFEST } from "../characters/benchGeometry";
import { createGlbHero, type GlbHero, heroVariantFor } from "../characters/glbHero";
import type { LocalFrame } from "../frame";
import { HERO_REF_PACE_MPS, WALK_PHASE_RATE } from "../journey/heroDriver";
import { AGENT_LIFT_M } from "../motion/agents";
import type { CrowdKit } from "../motion/crowdBake";
import { framePair } from "../motion/crowdGait";
import { type CrowdRenderer, createCrowdRenderer } from "../motion/crowdRenderer";
import { COMPARE_HERO_COLOURS } from "../shared/clayTokens";

/**
 * The compare playback's 3D layer (demo polish B8, spec §5.3): the two route ribbons, the
 * unchecked runs and the stop edge over them, two wheelchair users (the journey hero's GLB
 * `wheelchair` variant, two instances with distinct shirt colours) placed by distance along their
 * routes, and one simulated resident (a crowd look) beside the recommended route where the greeting
 * beat plays. Decorative except the ribbons' meaning (route identity, a known FAIL, a not-checked
 * run), which comes from the payload only. Positions are pure functions of the walker metres.
 */

/** Prototype colours: fastest orange, recommended green, unchecked purple, stop edge red. */
export const COMPARE_COLOURS = COMPARE_RIBBON_STYLE;
/**
 * Ribbons: the width on screen (CSS px, from the view's metres per pixel) within a width in metres
 * (`widthM` close up, the chase view; at most `maxM` far out, the overview), and the lift above the
 * ground (m). Wider ribbons sit higher, so the unchecked run and the stop edge draw over the routes.
 */
export const RIBBON = {
  fastest: { widthM: 1.6, widthPx: 6, maxM: 24, liftM: 0.3 },
  recommended: { widthM: 1.9, widthPx: 7, maxM: 28, liftM: 0.32 },
  unchecked: { widthM: 2.3, widthPx: 9, maxM: 36, liftM: 0.36 },
  stop: { widthM: 2.7, widthPx: 10, maxM: 40, liftM: 0.38 },
} as const;
type RibbonSpec = (typeof RIBBON)[keyof typeof RIBBON];

/** A ribbon's width (m) for a view of `mpp` metres per CSS pixel. */
export function ribbonWidthM(spec: RibbonSpec, mpp: number): number {
  const w = Number.isFinite(mpp) && mpp > 0 ? spec.widthPx * mpp : spec.widthM;
  return Math.max(spec.widthM, Math.min(spec.maxM, w));
}
/** The stop edge's drawn length when the payload carries no edge length (m). */
export const STOP_EDGE_M = 12;
/**
 * Shirt colours (sRGB) of the two wheelchair users: the hero's purple baju (`#8a63cc` in the
 * Blender palette) becomes the route colour, a shade deeper so it reads as cloth.
 */
export const SHIRTS = {
  fastest: COMPARE_HERO_COLOURS.shirtFastest,
  recommended: COMPARE_HERO_COLOURS.shirtRecommended,
} as const;
const HERO_BAJU = COMPARE_HERO_COLOURS.heroBaju;
/** The greeter stands this far to the side of the recommended route (m). */
export const GREETER_SIDE_M = 3.2;
/** Crowd looks for the greeter, first found wins (a resident in baju kurung, then any adult). */
export const GREETER_LOOKS = ["woman_baju_kurung_green", "woman_baju_kurung_purple"] as const;
const GREETER_SCALE = 1.5;
/** Head heights for screen anchors (m): the wheelchair user seated, the greeter standing. */
export const ANCHOR_Y = { walker: 2.6, greeter: 2.9, poi: 1.5 } as const;

const NOOP = () => {};

export interface CompareAnchors {
  walkers: { fastest: [number, number, number]; recommended: [number, number, number] };
  /** Keyed by beat id; the side ("L" fastest view, "R" recommended view) each is drawn in. */
  pois: Record<string, { p: [number, number, number]; side: "L" | "R" }>;
  unchecked: [number, number, number] | null;
}

export interface CompareLayer {
  group: THREE.Group;
  paths: { fastest: RoutePath; recommended: RoutePath };
  heroes: { fastest: GlbHero; recommended: GlbHero };
  /** Poses the walkers and the greeter for playback time t and the walkers' metres. */
  update(t: number, walkers: { fastest: number; recommended: number }): void;
  /** Ribbon widths for a view of `mpp` metres per CSS pixel (rebuilt only on a 5 % change). */
  setMetresPerPixel(mpp: number): void;
  /** Screen anchors at the current pose (world, local metres). */
  anchors(): CompareAnchors;
  /** Route points for the overview's screen box (AC-N7). */
  routePoints(n?: number): [number, number, number][];
  setKit(kit: CrowdKit | null): void;
  dispose(): void;
}

/** A flat ribbon (triangle strip as triangles) along an xyz polyline (y ignored), at `liftM`. */
export function ribbonGeometry(
  points: Float32Array,
  widthM: number,
  liftM: number,
): THREE.BufferGeometry {
  const n = points.length / 3;
  const g = new THREE.BufferGeometry();
  if (n < 2) return g;
  const pos = new Float32Array(n * 2 * 3);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  setRibbonWidth(g, points, widthM, liftM);
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    idx.push(l0, r0, l1, r0, r1, l1);
  }
  g.setIndex(idx);
  return g;
}

/** Rewrites a ribbon's vertices (in place) for a new width. */
export function setRibbonWidth(
  g: THREE.BufferGeometry,
  points: Float32Array,
  widthM: number,
  liftM: number,
): void {
  const attr = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!attr) return;
  const pos = attr.array as Float32Array;
  const n = points.length / 3;
  const half = widthM / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = (points[b * 3] as number) - (points[a * 3] as number);
    let dz = (points[b * 3 + 2] as number) - (points[a * 3 + 2] as number);
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const x = points[i * 3] as number;
    const z = points[i * 3 + 2] as number;
    // normal (to the left of travel)
    pos.set([x - dz * half, liftM, z + dx * half, x + dz * half, liftM, z - dx * half], i * 6);
  }
  attr.needsUpdate = true;
  g.computeBoundingSphere();
}

/** Spans for a route: PASS everywhere, `marks` (from, to) as `ev`, clipped to [0, L]. */
export function spansWith(
  L: number,
  marks: readonly [number, number][],
  ev: SpanEval,
): [number, number, SpanEval][] {
  const cuts = marks
    .map(([a, b]) => [Math.max(0, Math.min(L, a)), Math.max(0, Math.min(L, b))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number, SpanEval][] = [];
  let at = 0;
  for (const [a, b] of cuts) {
    if (a < at) continue;
    if (a > at) out.push([at, a, "PASS"]);
    out.push([a, b, ev]);
    at = b;
  }
  if (L > at || out.length === 0) out.push([at, Math.max(at, L), "PASS"]);
  return out;
}

function pathOf(
  r: CompareRoute,
  spans: [number, number, SpanEval][],
  frame: LocalFrame,
): RoutePath {
  return createRoutePath(
    {
      polyline: r.geometry.coordinates as unknown as JourneyPlan["polyline"],
      spans: spans as unknown as JourneyPlan["spans"],
    },
    (lon, lat) => frame.toLocal(lon, lat),
  );
}

/**
 * The hero outfit to recolour: the purple baju and kain (hue around `#8a63cc`, saturated, sRGB
 * lightness below the lilac tudung and trims), with their baked shading kept as a lightness ratio.
 */
export const OUTFIT_MATCH = { hueDeg: [245, 285], minSat: 0.3, maxLight: 0.64 } as const;
const _hsl = { h: 0, s: 0, l: 0 };
const _c = new THREE.Color();

/** Recolours the outfit (`OUTFIT_MATCH` around `from`) to `to` (sRGB hex) on geometry copies; returns the undo. */
export function tintVertexColours(root: THREE.Object3D, from: string, to: string): () => void {
  const ref = { h: 0, s: 0, l: 0 };
  new THREE.Color(from).getHSL(ref, THREE.SRGBColorSpace);
  const tgt = { h: 0, s: 0, l: 0 };
  new THREE.Color(to).getHSL(tgt, THREE.SRGBColorSpace);
  const [h0, h1] = OUTFIT_MATCH.hueDeg;
  const undo: (() => void)[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const col = m.geometry?.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!col) return;
    const orig = m.geometry;
    const g = orig.clone();
    const c = g.getAttribute("color") as THREE.BufferAttribute;
    let n = 0;
    for (let i = 0; i < c.count; i++) {
      _c.setRGB(c.getX(i), c.getY(i), c.getZ(i)).getHSL(_hsl, THREE.SRGBColorSpace);
      const hue = _hsl.h * 360;
      if (hue < h0 || hue > h1 || _hsl.s < OUTFIT_MATCH.minSat || _hsl.l > OUTFIT_MATCH.maxLight)
        continue;
      const l = Math.min(0.95, tgt.l * (_hsl.l / Math.max(0.01, ref.l)));
      _c.setHSL(tgt.h, tgt.s, l, THREE.SRGBColorSpace);
      c.setXYZ(i, _c.r, _c.g, _c.b);
      n++;
    }
    if (n === 0) {
      g.dispose();
      return;
    }
    c.needsUpdate = true;
    m.geometry = g;
    undo.push(() => {
      if (m.geometry === g) m.geometry = orig;
      g.dispose();
    });
  });
  return () => {
    for (const u of undo) u();
  };
}

export function createCompareLayer(o: {
  payload: CompareIntent & { fastest: CompareRoute; recommended: CompareRoute };
  timeline: CompareTimeline;
  frame: LocalFrame;
  prepare?: (obj: THREE.Object3D) => Promise<unknown>;
  onReady?: () => void;
}): CompareLayer {
  const { payload: c, timeline: tl, frame } = o;
  const group = new THREE.Group();
  group.name = "compare-layer";
  const owned: { dispose(): void }[] = [];

  const fastL = Math.max(0, c.fastest.distance_m);
  const recL = Math.max(0, c.recommended.distance_m);
  const stopMarks: [number, number][] = c.stop ? [[c.stop.at_m, c.stop.at_m + STOP_EDGE_M]] : [];
  const fastest = pathOf(c.fastest, spansWith(fastL, stopMarks, "FAIL"), frame);
  const recommended = pathOf(
    c.recommended,
    spansWith(
      recL,
      c.unchecked.map((u) => [u.start_m, u.end_m] as [number, number]),
      "UNKNOWN",
    ),
    frame,
  );

  const ribbonMat = (hex: string, order: number) => {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex),
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2 - order,
      // data, not scenery: the overview's haze must not wash the routes out
      fog: false,
    });
    owned.push(m);
    return m;
  };
  const ribbons: { g: THREE.BufferGeometry; points: Float32Array; spec: RibbonSpec; w: number }[] =
    [];
  const addRibbon = (
    points: Float32Array,
    spec: RibbonSpec,
    hex: string,
    order: number,
    name: string,
  ) => {
    const g = ribbonGeometry(points, spec.widthM, spec.liftM);
    owned.push(g);
    ribbons.push({ g, points, spec, w: spec.widthM });
    const mesh = new THREE.Mesh(g, ribbonMat(hex, order));
    mesh.name = name;
    mesh.renderOrder = 18 + order;
    mesh.raycast = NOOP;
    mesh.frustumCulled = true;
    group.add(mesh);
  };
  const whole = (p: RoutePath) => {
    const runs = p.spanLines();
    const pts: number[] = [];
    for (const r of runs)
      for (let i = pts.length ? 3 : 0; i < r.points.length; i++) pts.push(r.points[i] as number);
    return new Float32Array(pts);
  };
  addRibbon(whole(fastest), RIBBON.fastest, COMPARE_COLOURS.fastest, 0, "compare-ribbon-fastest");
  addRibbon(
    whole(recommended),
    RIBBON.recommended,
    COMPARE_COLOURS.recommended,
    1,
    "compare-ribbon-recommended",
  );
  for (const r of recommended.spanLines())
    if (r.eval === "UNKNOWN")
      addRibbon(
        r.points,
        RIBBON.unchecked,
        COMPARE_COLOURS.unchecked,
        2,
        "compare-ribbon-unchecked",
      );
  for (const r of fastest.spanLines())
    if (r.eval === "FAIL")
      addRibbon(r.points, RIBBON.stop, COMPARE_COLOURS.stop, 3, "compare-ribbon-stop");

  // the two wheelchair users
  const variant = heroVariantFor("wheelchair");
  const tints: (() => void)[] = [];
  const hero = (shirt: string) => {
    const h = createGlbHero({
      variant,
      ...(o.prepare ? { prepare: o.prepare } : {}),
      onReady: () => {
        const m = h.model();
        if (m) tints.push(tintVertexColours(m.object3d, HERO_BAJU, shirt));
        o.onReady?.();
      },
    });
    group.add(h.object3d);
    return h;
  };
  const heroes = { fastest: hero(SHIRTS.fastest), recommended: hero(SHIRTS.recommended) };
  const spec = HERO_MANIFEST.variants[variant];
  const rate = spec ? walkRate(spec, HERO_REF_PACE_MPS, HERO_MANIFEST.displayScale) : 1;

  const yawAt = (p: RoutePath, m: number, L: number) => {
    const [ax, az] = p.pointAt(Math.max(0, m - 2));
    const [bx, bz] = p.pointAt(Math.min(L, m + 2));
    return Math.abs(bx - ax) + Math.abs(bz - az) > 1e-4 ? Math.atan2(bx - ax, bz - az) : 0;
  };
  const posed = { fastest: 0, recommended: 0 };
  const poseHero = (h: GlbHero, p: RoutePath, L: number, m: number, moving: boolean, t: number) => {
    const [x, z] = p.pointAt(m);
    h.setPose({ x, y: AGENT_LIFT_M, z }, yawAt(p, m, L));
    if (moving) h.play("walk", Math.max(0, t - 3) * rate * WALK_PHASE_RATE, rate);
    else h.play("idle", t, 0);
  };

  // the greeter: beside the recommended route at the greeting metre, facing it
  const gm = tl.greetingAtM;
  const [gx0, gz0] = recommended.pointAt(gm);
  const gyaw = yawAt(recommended, gm, recL);
  // left of travel: (cos yaw, -sin yaw) is the right; the greeter stands on the left
  const greeter = {
    x: gx0 - Math.cos(gyaw) * GREETER_SIDE_M,
    z: gz0 + Math.sin(gyaw) * GREETER_SIDE_M,
    // faces the route (towards the right of travel)
    yaw: gyaw + Math.PI / 2,
  };
  let crowd: CrowdRenderer | null = null;
  let kit: CrowdKit | null = null;
  let greeterBody: string | null = null;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);
  let tNow = 0;
  const drawGreeter = () => {
    if (!crowd || !kit || !greeterBody) return;
    const clips = kit.clips[greeterBody as keyof CrowdKit["clips"]];
    const clip = clips?.idle ?? clips?.walk;
    if (!clip) {
      crowd.hide(0);
      crowd.commit();
      return;
    }
    // a little turn towards the passer-by while greeting (prototype: sway at 10.5-14.5 s)
    const sway = tNow >= 7 && tNow <= 10 ? Math.sin(tNow * 3) * 0.3 : 0;
    _m.compose(
      _p.set(greeter.x, AGENT_LIFT_M, greeter.z),
      _q.setFromAxisAngle(_y, greeter.yaw + sway),
      _s.setScalar(GREETER_SCALE),
    );
    const f = framePair((tNow / Math.max(0.1, clip.duration)) % 1, clip.frames);
    crowd.set(0, 0, _m, clip.row + f.f0, clip.row + f.f1, f.t);
    crowd.commit();
  };

  const up = (p: [number, number], y: number): [number, number, number] => [p[0], y, p[1]];

  const layer: CompareLayer = {
    group,
    paths: { fastest, recommended },
    heroes,
    update(t, w) {
      tNow = t;
      posed.fastest = w.fastest;
      posed.recommended = w.recommended;
      const walking = t >= 3;
      poseHero(
        heroes.fastest,
        fastest,
        fastL,
        w.fastest,
        walking && w.fastest < tl.fastestEndM - 1e-3,
        t,
      );
      poseHero(
        heroes.recommended,
        recommended,
        recL,
        w.recommended,
        walking && w.recommended < tl.recommendedM - 1e-3,
        t,
      );
      drawGreeter();
    },
    setMetresPerPixel(mpp) {
      for (const r of ribbons) {
        const w = ribbonWidthM(r.spec, mpp);
        if (Math.abs(w / r.w - 1) <= 0.05) continue;
        r.w = w;
        setRibbonWidth(r.g, r.points, w, r.spec.liftM);
      }
    },
    anchors() {
      const pois: CompareAnchors["pois"] = {};
      for (const b of tl.beats) {
        if (b.poi !== undefined) {
          const poi = c.pois[b.poi];
          if (poi) pois[b.id] = { p: up(recommended.pointAt(poi.at_m), ANCHOR_Y.poi), side: "R" };
        }
      }
      if (c.stop)
        pois["tag-stop"] = { p: up(fastest.pointAt(c.stop.at_m), ANCHOR_Y.poi), side: "L" };
      pois["tag-fastest"] = {
        p: up(fastest.pointAt(posed.fastest), ANCHOR_Y.walker + 1.2),
        side: "L",
      };
      if (!pois.arrive) pois.arrive = { p: up(recommended.pointAt(recL), ANCHOR_Y.poi), side: "R" };
      pois.greeting = { p: [greeter.x, ANCHOR_Y.greeter, greeter.z], side: "R" };
      const u = c.unchecked[0];
      const unchecked = u ? up(recommended.pointAt((u.start_m + u.end_m) / 2), ANCHOR_Y.poi) : null;
      if (unchecked) pois["tag-unchecked"] = { p: unchecked, side: "R" };
      return {
        walkers: {
          fastest: up(fastest.pointAt(posed.fastest), ANCHOR_Y.walker),
          recommended: up(recommended.pointAt(posed.recommended), ANCHOR_Y.walker),
        },
        pois,
        unchecked,
      };
    },
    routePoints(n = 48) {
      const out: [number, number, number][] = [];
      for (const [p, L] of [
        [fastest, fastL],
        [recommended, recL],
      ] as const)
        for (let i = 0; i <= n; i++) out.push(up(p.pointAt((L * i) / n), 0.3));
      return out;
    },
    setKit(k) {
      if (crowd) {
        group.remove(crowd.group);
        crowd.dispose();
        crowd = null;
      }
      kit = k;
      if (!k) return;
      let look = -1;
      for (const id of GREETER_LOOKS) {
        const i = k.lookIndex.get(id);
        if (i !== undefined) {
          look = i;
          break;
        }
      }
      if (look < 0)
        look = Math.max(
          0,
          k.manifest.looks.findIndex((l) => l.body === "adult_woman" && !l.prop),
        );
      greeterBody = k.manifest.looks[look]?.body ?? null;
      crowd = createCrowdRenderer(k, [look]);
      crowd.group.name = "compare-greeter";
      for (const m of crowd.meshes) m.castShadow = true;
      crowd.hide(0);
      group.add(crowd.group);
      drawGreeter();
    },
    dispose() {
      for (const u of tints) u();
      tints.length = 0;
      heroes.fastest.dispose();
      heroes.recommended.dispose();
      if (crowd) {
        crowd.dispose();
        crowd = null;
      }
      for (const x of owned) x.dispose();
      group.clear();
    },
  };
  return layer;
}
