import * as THREE from "three";
import type { LonLat } from "../../scene/geo";
import type { Hero } from "../../scene/three/characters/hero";
import {
  createPlaceholderHero,
  createRestBench,
} from "../../scene/three/characters/placeholderHero";
import type { LocalFrame } from "../../scene/three/frame";
import {
  type HeroPathHelpers,
  type HeroSeat,
  heroStateAt,
  seatFor,
} from "../../scene/three/journey/heroDriver";
import { AGENT_LIFT_M } from "../../scene/three/motion/motionLayer";
import type { HeroPose, HeroProbe } from "../journeyStore";
import type { RoutePath } from "../routePath";
import type { JourneyPlan, Timeline } from "../timeline";

/** On the route she stands where the decorative agents do: on the footway ribbons (0.08 m). */
export const HERO_GROUND_Y = AGENT_LIFT_M;
/** Samples of the drawn ground along route point -> seat (offRoute 0..1) for a rest's heights. */
const REST_PROFILE_N = 8;
/** Retry a rest's ground sampling at most this often (ms) while its band has not streamed in. */
const GROUND_RETRY_MS = 300;
/** Start sampling a rest's ground this many route metres before it. */
const GROUND_LOOKAHEAD_M = 40;
/** Footprints this far (m) from a rest point are considered for its seat side. */
const FOOTPRINT_RANGE_M = 40;
const CLEARANCE_CAP_M = 50;

/**
 * The journey hero in the 3D scene: the hero model (placeholder until C-T4) plus a bench at each
 * rest stop of the plan. `pose(tl, t)` puts her where `heroStateAt` says and returns what was drawn.
 */
export interface HeroLayer {
  group: THREE.Group;
  hero: Hero;
  seats: Map<number, HeroSeat>;
  /** `playing`: the timeline is running (planting is then budgeted, and off in compressed walks). */
  pose(tl: Timeline, t: number, playing?: boolean): HeroPose;
  dispose(): void;
}

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _from = new THREE.Vector3();

/**
 * A sampler of the drawn ground: the highest ground-band surface at (x, z) among the meshes tagged
 * `userData.groundBand` (land cover, roads, city parks / water; markings excluded), raycast directly
 * as the acceptance road mask does (they are unpickable). `band` is null where no band mesh lies
 * under the point (the bare base plane at 0, or a tile not streamed in yet). The mesh list is
 * gathered once per sampler.
 */
export function groundSampler(
  roots: readonly THREE.Object3D[],
): (x: number, z: number) => { y: number; band: string | null } {
  const meshes: THREE.Mesh[] = [];
  for (const r of roots)
    r.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.userData.groundBand && o.userData.groundBand !== "markings") meshes.push(m);
    });
  const hits: THREE.Intersection[] = [];
  return (x, z) => {
    _from.set(x, 5, z);
    _ray.set(_from, _down);
    _ray.far = 10;
    let best: { y: number; band: string | null } = { y: 0, band: null };
    for (const m of meshes) {
      hits.length = 0;
      THREE.Mesh.prototype.raycast.call(m, _ray, hits);
      for (const h of hits)
        if (best.band === null || h.point.y > best.y)
          best = { y: h.point.y, band: m.userData.groundBand as string };
    }
    return best;
  };
}

/** One-shot ground sample (tests, probes). */
export function groundAt(
  roots: readonly THREE.Object3D[],
  x: number,
  z: number,
): { y: number; band: string | null } {
  return groundSampler(roots)(x, z);
}

type Ring = [number, number][];

function inRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i] as [number, number];
    const [xj, zj] = ring[j] as [number, number];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(x - (a[0] + dx * u), z - (a[1] + dz * u));
}

/**
 * Clearance from building footprints (outer rings of a GeoJSON FeatureCollection, in lon/lat) near
 * the given local points: 0 inside a footprint, else metres to the nearest edge (capped).
 */
export function footprintClearance(
  fc: unknown,
  frame: LocalFrame,
  near: [number, number][],
): (x: number, z: number) => number {
  const rings: Ring[] = [];
  const feats = (fc as { features?: unknown[] } | null)?.features ?? [];
  for (const f of feats) {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const polys =
      g?.type === "Polygon"
        ? [g.coordinates as number[][][]]
        : g?.type === "MultiPolygon"
          ? (g.coordinates as number[][][][])
          : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 3) continue;
      const ring = outer.map((c) => frame.toLocal(c[0] as number, c[1] as number));
      const close = ring.some(([x, z]) =>
        near.some(([nx, nz]) => Math.hypot(x - nx, z - nz) < FOOTPRINT_RANGE_M),
      );
      if (close) rings.push(ring);
    }
  }
  return (x, z) => {
    let best = CLEARANCE_CAP_M;
    for (const r of rings) {
      if (inRing(x, z, r)) return 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++)
        best = Math.min(best, segDist(x, z, r[j] as [number, number], r[i] as [number, number]));
    }
    return best;
  };
}

interface RestGround {
  /** Drawn ground heights at offRoute 0, 1/N .. 1 (route point -> seat). */
  profile: number[];
}

/** Ground cache cell (m): a contact samples the band once per cell it enters (2 cm: a band edge is never misread by more than that). */
const GROUND_CELL_M = 0.02;
/** The ground-band mesh list is gathered again after this long (ms): tiles stream in and out. */
const GROUND_MESHES_MS = 1000;
/** New ground samples (raycasts) allowed per pose while playing; a paused pose plants fully. */
const PLANT_BUDGET = 12;

/**
 * Foot-planting ground: the drawn ground band at (x, z), cached per 2 cm cell while the set of
 * ground meshes stays the same (re-gathered every second; a tile streaming in or out clears the
 * cache, so a park-only answer never outlives the footway arriving). `make(budget)` returns a
 * sampler allowed `budget` new raycasts; past it, unknown cells return null (the contact then
 * stays at the root's height). A cell with no band under it is asked again.
 */
function plantingGround(roots: (() => readonly THREE.Object3D[]) | undefined, now: () => number) {
  const cache = new Map<number, number>();
  let sample: ((x: number, z: number) => { y: number; band: string | null }) | null = null;
  let meshKey = "";
  let gathered = -Infinity;
  /** Re-gathers the ground meshes; a changed set (a tile streamed in or out) drops the cache. */
  const refresh = (force: boolean) => {
    if (!roots || (!force && sample && now() - gathered <= GROUND_MESHES_MS)) return;
    const meshes: string[] = [];
    for (const r of roots())
      r.traverseVisible((o) => {
        if (
          (o as THREE.Mesh).isMesh &&
          o.userData.groundBand &&
          o.userData.groundBand !== "markings"
        )
          meshes.push(o.uuid);
      });
    const key = meshes.join(",");
    if (key !== meshKey) cache.clear();
    meshKey = key;
    sample = groundSampler(roots());
    gathered = now();
  };
  const make = (budget: number) => {
    let left = budget;
    return (x: number, z: number): number | null => {
      const cx = Math.round(x / GROUND_CELL_M);
      const cz = Math.round(z / GROUND_CELL_M);
      const key = cx * 1e7 + cz;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      if (!roots || left <= 0) return null;
      left--;
      refresh(false);
      const g = (sample as NonNullable<typeof sample>)(x, z);
      if (g.band === null) return null;
      const y = Math.max(0, g.y);
      cache.set(key, y);
      return y;
    };
  };
  return { make, refresh };
}

export function createHeroLayer(
  plan: JourneyPlan,
  path: RoutePath,
  frame: LocalFrame,
  opts: {
    places?: ReadonlyMap<string, LonLat>;
    /** OSM building footprints (`/layers/buildings` `buildings`): the seat side keeps clear of them. */
    footprints?: unknown;
    /** The scene roots for ground sampling (the engine's `pickView().roots`). */
    roots?: () => readonly THREE.Object3D[];
    createHero?: () => Hero;
    now?: () => number;
    /** Called with every pose drawn (also a probe's re-pose). */
    onPose?: (p: HeroPose) => void;
  } = {},
): HeroLayer {
  const now = opts.now ?? (() => performance.now());
  const hero = (opts.createHero ?? createPlaceholderHero)();
  const group = new THREE.Group();
  group.name = "journey-hero-layer";
  group.userData.journeyHero = true;
  group.add(hero.object3d);

  const restIdx = plan.events.flatMap((e, i) => (e.kind === "rest" ? [i] : []));
  const clearance = opts.footprints
    ? footprintClearance(
        opts.footprints,
        frame,
        restIdx.map((i) => path.pointAt((plan.events[i] as JourneyPlan["events"][number]).at_m)),
      )
    : undefined;

  // One seat per rest event (a display approximation; the bench fact is the rest point).
  const seats = new Map<number, HeroSeat>();
  const benches = new Map<number, ReturnType<typeof createRestBench>>();
  for (const i of restIdx) {
    const e = plan.events[i] as JourneyPlan["events"][number];
    const ll = e.element_id ? opts.places?.get(e.element_id) : undefined;
    const place = ll ? frame.toLocal(ll[0], ll[1]) : null;
    const seat = seatFor(path.pointAt, e.at_m, place, clearance);
    seats.set(i, seat);
    const [rx, rz] = path.pointAt(e.at_m);
    const b = createRestBench();
    b.object3d.position.set(seat.x, HERO_GROUND_Y, seat.z);
    // the bench faces the route, as she does when seated (model front +z)
    b.object3d.rotation.y = Math.atan2(rx - seat.x, rz - seat.z);
    group.add(b.object3d);
    benches.set(i, b);
  }

  const helpers: HeroPathHelpers = {
    pointAt: path.pointAt,
    seatOf: (i) => seats.get(i) ?? null,
  };

  // Ground under each rest (route point -> seat), sampled once its ground band has streamed in.
  const ground = new Map<number, RestGround>();
  const tried = new Map<number, number>();
  const tryGround = (i: number, force = false) => {
    if (ground.has(i) || !opts.roots) return;
    const stamp = now();
    if (!force && stamp - (tried.get(i) ?? -Infinity) < GROUND_RETRY_MS) return;
    tried.set(i, stamp);
    const seat = seats.get(i);
    const e = plan.events[i];
    if (!seat || !e) return;
    const [rx, rz] = path.pointAt(e.at_m);
    const sample = groundSampler(opts.roots());
    const profile: number[] = [];
    for (let k = 0; k <= REST_PROFILE_N; k++) {
      const u = k / REST_PROFILE_N;
      const g = sample(rx + (seat.x - rx) * u, rz + (seat.z - rz) * u);
      if (g.band === null) return; // not streamed in yet: keep the default height, retry later
      profile.push(Math.max(0, g.y));
    }
    ground.set(i, { profile });
    const b = benches.get(i);
    if (b) b.object3d.position.y = profile[REST_PROFILE_N] as number;
  };
  const restY = (i: number, off: number): number | null => {
    const g = ground.get(i);
    if (!g) return null;
    const f = Math.max(0, Math.min(1, off)) * REST_PROFILE_N;
    const k = Math.min(REST_PROFILE_N - 1, Math.floor(f));
    const a = g.profile[k] as number;
    const b = g.profile[k + 1] as number;
    return a + (b - a) * (f - k);
  };

  const planting = plantingGround(opts.roots, now);
  let last: { tl: Timeline; t: number } | null = null;
  const place = (tl: Timeline, t: number, playing = false): HeroPose => {
    last = { tl, t };
    const s = heroStateAt(tl, t, helpers);
    // sample a rest's ground just before she gets there
    for (const i of restIdx) {
      const e = plan.events[i] as JourneyPlan["events"][number];
      if (s.rest?.eventIndex === i || Math.abs(s.distance_m - e.at_m) < GROUND_LOOKAHEAD_M)
        tryGround(i);
    }
    const ry = s.rest ? restY(s.rest.eventIndex, s.rest.offRoute) : null;
    const y = ry ?? HERO_GROUND_Y;
    hero.setPose({ x: s.x, y, z: s.z }, s.yaw);
    // Each foot and walker leg is planted on the drawn ground under it (a footway / park edge, the
    // lawn by a bench). Compressed walks while playing (~23 m/s on screen) skip it: a new cell per
    // contact every frame would cost a raycast each, for a 3 cm step nobody can see at that speed.
    const budget = playing && s.fast ? 0 : playing ? PLANT_BUDGET : Number.POSITIVE_INFINITY;
    hero.setGround?.(budget > 0 ? planting.make(budget) : null);
    hero.play(s.clip, s.clipTime, s.walkRate, s.fade);
    const [lon, lat] = frame.toLonLat(s.x, s.z);
    const pose: HeroPose = { ...s, y, lon, lat, groundKnown: !s.rest || ry !== null, probe };
    opts.onPose?.(pose);
    return pose;
  };

  const probe = (): HeroProbe => {
    // a paused test probe: sample any rest ground that has streamed in since, and re-pose
    if (last) {
      for (const i of restIdx) tryGround(i, true);
      planting.refresh(true);
      place(last.tl, last.t);
    }
    const sample = groundSampler(opts.roots?.() ?? []);
    const contacts = hero.contacts().map((c) => {
      const g = sample(c.x, c.z);
      return {
        ...c,
        groundY: Math.max(g.y, 0),
        band: g.band,
        onFootway: g.band === "roads",
      };
    });
    const benchCorners = [...benches].map(([eventIndex, b]) => {
      b.object3d.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(b.object3d);
      const corners: [number, number][] = [
        [box.min.x, box.min.z],
        [box.max.x, box.min.z],
        [box.max.x, box.max.z],
        [box.min.x, box.max.z],
      ].map(([x, z]) => frame.toLonLat(x as number, z as number) as [number, number]);
      return { eventIndex, corners };
    });
    return { contacts, benches: benchCorners };
  };

  return {
    group,
    hero,
    seats,
    pose: place,
    dispose() {
      hero.dispose();
      for (const b of benches.values()) b.dispose();
      group.clear();
    },
  };
}
