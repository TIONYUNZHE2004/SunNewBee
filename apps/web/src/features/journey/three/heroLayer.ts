import * as THREE from "three";
import type { LonLat } from "../../scene/geo";
import { HERO_BENCH } from "../../scene/three/characters/benchGeometry";
import { createGlbHero } from "../../scene/three/characters/glbHero";
import { HERO_DISPLAY_SCALE, type Hero } from "../../scene/three/characters/hero";
import { createRestBench } from "../../scene/three/characters/placeholderHero";
import type { Clearance } from "../../scene/three/clearance";
import type { LocalFrame } from "../../scene/three/frame";
import {
  approachClear,
  type HeroPathHelpers,
  type HeroSeat,
  heroStateAt,
  seatFor,
} from "../../scene/three/journey/heroDriver";
import { AGENT_LIFT_M } from "../../scene/three/motion/agents";
import type { HeroPose, HeroProbe } from "../journeyStore";
import type { RoutePath } from "../routePath";
import type { JourneyPlan, Timeline } from "../timeline";
import { buildGroundIndex, corridorCells, type GroundIndex, groundBandMeshes } from "./groundIndex";

/** Her root height where no drawn ground is known yet: the agents' footway height (0.08 m). */
export const HERO_GROUND_Y = AGENT_LIFT_M;
/** `HeroPose.ahead`: her next 10 m of route, sampled every 0.25 m (crowd keep-out, C-T8). */
const AHEAD_STEP_M = 0.25;
const AHEAD_STEPS = 40;
/** Footprints this far (m) from a rest point are considered for its seat side. */
const FOOTPRINT_RANGE_M = 40;
const CLEARANCE_CAP_M = 50;
/** Ground corridor: this far (m) either side of the route and the rest paths (walker reach + margin). */
const CORRIDOR_M = 2.5;
/** Corridor sampling step along the route (m). */
const CORRIDOR_STEP_M = 0.5;

/** A bench the street dressing draws for a mapped seating place (see `createHeroLayer` opts). */
export interface FactBench {
  id?: string;
  x: number;
  z: number;
  yaw: number;
}
/** A fact bench this close (m) to a rest's seat or bench place is the rest's bench. */
export const FACT_BENCH_RANGE_M = 3;
/**
 * Her stand point in front of a bench's footprint centre: the manifest seat box centre lies
 * (min z + max z) / 2 behind her root (true m), x the display scale.
 */
export const FACT_BENCH_STAND_M =
  (-((HERO_BENCH.seat.min[2] as number) + (HERO_BENCH.seat.max[2] as number)) / 2) *
  HERO_DISPLAY_SCALE;

/** The fact bench a rest uses: same source id, else the nearest within FACT_BENCH_RANGE_M. */
export function factBenchFor(
  benches: readonly FactBench[] | undefined,
  id: string | null | undefined,
  near: readonly ([number, number] | null)[],
): FactBench | null {
  if (!benches?.length) return null;
  if (id) {
    const same = benches.find((b) => b.id === id);
    if (same) return same;
  }
  let best: FactBench | null = null;
  let bestD = FACT_BENCH_RANGE_M;
  for (const b of benches)
    for (const p of near) {
      if (!p) continue;
      const d = Math.hypot(b.x - p[0], b.z - p[1]);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
  return best;
}

/** Per-pose cost of the hero (driver + planting + model update), for the frame budget. */
export interface HeroCost {
  poses: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  rebuilds: number;
  lastRebuildMs: number;
  meanRebuildMs: number;
  maxRebuildMs: number;
  triangles: number;
}

/**
 * The journey hero in the 3D scene: the hero model (the rigged GLB, C-T4) plus a bench at each
 * rest stop of the plan. `pose(tl, t)` puts her where `heroStateAt` says, on the drawn ground from a
 * precomputed corridor height table, and returns what was drawn.
 */
export interface HeroLayer {
  group: THREE.Group;
  hero: Hero;
  seats: Map<number, HeroSeat>;
  /** The driver's path helpers (route points and seats): `heroStateAt(tl, t, helpers)` is where she stands. */
  helpers: HeroPathHelpers;
  pose(tl: Timeline, t: number): HeroPose;
  /**
   * Re-checks the ground meshes when the engine's ground generation moved (a tile streamed in or
   * out) and rebuilds the height table if the set changed; true when it did (re-pose then).
   */
  refreshGround(): boolean;
  cost(): HeroCost;
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

/** The bench's seat + backrest footprint corners (local xz) for a stand point facing `yaw`. */
function benchCorners(x: number, z: number, yaw: number): [number, number][] {
  const s = HERO_BENCH.seat;
  const b = HERO_BENCH.back;
  const k = HERO_DISPLAY_SCALE;
  const x0 = Math.min(s.min[0] as number, b.min[0] as number) * k;
  const x1 = Math.max(s.max[0] as number, b.max[0] as number) * k;
  const z0 = Math.min(s.min[2] as number, b.min[2] as number) * k;
  const z1 = Math.max(s.max[2] as number, b.max[2] as number) * k;
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  // rotation.y = yaw maps local (lx, lz) to (lx cos + lz sin, -lx sin + lz cos)
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ].map(([lx, lz]) => [
    x + (lx as number) * c + (lz as number) * n,
    z - (lx as number) * n + (lz as number) * c,
  ]);
}

export function createHeroLayer(
  plan: JourneyPlan,
  path: RoutePath,
  frame: LocalFrame,
  opts: {
    places?: ReadonlyMap<string, LonLat>;
    /** OSM building footprints (`/layers/buildings` `buildings`): the bench keeps clear of them. */
    footprints?: unknown;
    /**
     * The drawn buildings (the engine's clearance grid: OSM extrusions plus the archetype and
     * landmark placement boxes, A-T7): seats and their approach keep out of them too (D-T5 ruling).
     */
    grid?: Pick<Clearance, "topAt"> | null;
    /** The scene roots holding the ground bands (the engine's `pickView().roots`). */
    roots?: () => readonly THREE.Object3D[];
    /**
     * The engine's ground generation (`Engine.groundGeneration`): the height table is re-checked
     * only when it moves. Without it the ground meshes are re-checked on every `refreshGround`.
     */
    groundGeneration?: () => number;
    createHero?: () => Hero;
    /**
     * Fact benches drawn by the street dressing (B-T7: mapped seating places), local metres:
     * `x, z` the bench footprint centre, `yaw` the facing of someone sitting on it (atan2(dx, dz)),
     * `id` the source id (the place id a rest event names). A rest uses the fact bench whose id is
     * the event's element, else one within FACT_BENCH_RANGE_M of its seat or bench place: she sits
     * on it (stand point and facing from the manifest bench contract) and no rest bench is drawn.
     */
    factBenches?: readonly FactBench[];
    /** Called with every pose drawn. */
    onPose?: (p: HeroPose) => void;
  } = {},
): HeroLayer {
  // The rigged GLB hero for the plan's profile (C-T4); the placeholder shows until it loads and
  // stays if it cannot. When the GLB swaps in, the last pose is drawn again (onPose -> a frame).
  const hero = (
    opts.createHero ??
    (() =>
      createGlbHero({
        profile: plan.profile,
        onReady: () => {
          if (last) place(last.tl, last.t);
        },
      }))
  )();
  const group = new THREE.Group();
  group.name = "journey-hero-layer";
  group.userData.journeyHero = true;
  group.add(hero.object3d);

  const restIdx = plan.events.flatMap((e, i) => (e.kind === "rest" ? [i] : []));
  const osm = opts.footprints
    ? footprintClearance(
        opts.footprints,
        frame,
        restIdx.map((i) => path.pointAt((plan.events[i] as JourneyPlan["events"][number]).at_m)),
      )
    : undefined;
  const grid = opts.grid ?? null;
  // 0 inside any drawn building (grid) or OSM footprint, else metres to the nearest OSM edge
  const clearance =
    osm || grid
      ? (x: number, z: number) =>
          grid && grid.topAt(x, z) > 0 ? 0 : osm ? osm(x, z) : CLEARANCE_CAP_M
      : undefined;

  // One seat (stand point) per rest event: a display approximation; the bench fact is the rest point.
  // The side keeps the whole bench box (seat and backrest behind her) clear of building footprints.
  const seats = new Map<number, HeroSeat>();
  /** Rests seated on a street-dressing fact bench (no own bench drawn). */
  const factSeats = new Set<number>();
  const benches = new Map<number, ReturnType<typeof createRestBench>>();
  for (const i of restIdx) {
    const e = plan.events[i] as JourneyPlan["events"][number];
    const ll = e.element_id ? opts.places?.get(e.element_id) : undefined;
    const place = ll ? frame.toLocal(ll[0], ll[1]) : null;
    const [rx, rz] = path.pointAt(e.at_m);
    const benchClear = clearance
      ? (x: number, z: number) =>
          Math.min(
            clearance(x, z),
            ...benchCorners(x, z, Math.atan2(rx - x, rz - z)).map(([cx, cz]) => clearance(cx, cz)),
          )
      : undefined;
    const own = seatFor(path.pointAt, e.at_m, place, benchClear);
    // the fact bench within ~3 m of the rest point (or its place / our seat; same id first)
    const fact = factBenchFor(opts.factBenches, e.element_id, [[rx, rz], place, [own.x, own.z]]);
    const factSeat: HeroSeat | null = fact
      ? {
          x: fact.x + Math.sin(fact.yaw) * FACT_BENCH_STAND_M,
          z: fact.z + Math.cos(fact.yaw) * FACT_BENCH_STAND_M,
          yaw: fact.yaw,
        }
      : null;
    // a fact bench whose stand point is inside a drawn building, or reached only through one, is
    // not used (she would be hidden; D-T5 ruling): our own seat, which avoids them, instead
    const usable =
      factSeat &&
      (!clearance ||
        (clearance(factSeat.x, factSeat.z) > 0 && approachClear(clearance, [rx, rz], factSeat)));
    if (fact && factSeat && usable) {
      // the street dressing's fact bench is the rest's bench: she stands in front of it, facing as
      // it faces, and no rest bench of our own is drawn (one bench per fact)
      const seat = factSeat;
      seats.set(i, seat);
      factSeats.add(i);
      continue;
    }
    const seat = own;
    seats.set(i, seat);
    const b = createRestBench();
    b.object3d.position.set(seat.x, HERO_GROUND_Y, seat.z);
    // her back to the bench, facing the route (model front +z)
    b.object3d.rotation.y = Math.atan2(rx - seat.x, rz - seat.z);
    group.add(b.object3d);
    benches.set(i, b);
  }

  const helpers: HeroPathHelpers = {
    pointAt: path.pointAt,
    seatOf: (i) => seats.get(i) ?? null,
  };

  // The ground corridor: the route polyline and each rest's route point -> stand point path.
  const corridorPts: [number, number][] = [];
  for (let m = 0; m <= path.planLength + 1e-9; m += CORRIDOR_STEP_M)
    corridorPts.push(path.pointAt(m));
  corridorPts.push(path.pointAt(path.planLength));
  for (const i of restIdx) {
    const e = plan.events[i] as JourneyPlan["events"][number];
    const [rx, rz] = path.pointAt(e.at_m);
    const s = seats.get(i) as HeroSeat;
    for (let k = 0; k <= 8; k++)
      corridorPts.push([rx + ((s.x - rx) * k) / 8, rz + ((s.z - rz) * k) / 8]);
    for (const c of benchCorners(s.x, s.z, s.yaw ?? Math.atan2(rx - s.x, rz - s.z)))
      corridorPts.push(c);
  }
  const corridor = corridorCells(corridorPts, CORRIDOR_M);

  let index: GroundIndex | null = null;
  let meshKey: string | null = null;
  let checkedGen = Number.NaN;
  let rebuilds = 0;
  const rebuildMs: number[] = [];
  const refreshGround = (): boolean => {
    if (!opts.roots) return false;
    const gen = opts.groundGeneration?.();
    if (gen !== undefined && gen === checkedGen) return false;
    checkedGen = gen ?? Number.NaN;
    const meshes = groundBandMeshes(opts.roots());
    const key = meshes.map((m) => m.uuid).join(",");
    if (key === meshKey) return false;
    meshKey = key;
    index = meshes.length ? buildGroundIndex(meshes, corridor) : null;
    if (index) {
      rebuilds++;
      rebuildMs.push(index.buildMs);
    }
    for (const [i, b] of benches) {
      const s = seats.get(i) as HeroSeat;
      b.object3d.position.y = index?.heightAt(s.x, s.z) ?? HERO_GROUND_Y;
    }
    return true;
  };

  const times: number[] = [];
  let last: { tl: Timeline; t: number } | null = null;
  const place = (tl: Timeline, t: number): HeroPose => {
    const t0 = performance.now();
    last = { tl, t };
    const s = heroStateAt(tl, t, helpers);
    const groundY = index?.heightAt(s.x, s.z) ?? null;
    const y = groundY ?? HERO_GROUND_Y;
    hero.setPose({ x: s.x, y, z: s.z }, s.yaw);
    // every foot and walker leg on the drawn ground under it: a table lookup, the same in play and seek
    hero.setGround?.(index ? index.heightAt : null);
    hero.play(s.clip, s.clipTime, s.walkRate, s.fade);
    const [lon, lat] = frame.toLonLat(s.x, s.z);
    const ahead: [number, number][] = [];
    for (let k = 1; k <= AHEAD_STEPS; k++)
      ahead.push(path.pointAt(s.distance_m + k * AHEAD_STEP_M));
    const pose: HeroPose = { ...s, y, lon, lat, groundKnown: groundY !== null, probe, ahead };
    times.push(performance.now() - t0);
    if (times.length > 2000) times.shift();
    opts.onPose?.(pose);
    return pose;
  };

  const probe = (): HeroProbe => {
    // a probe measures what is drawn; it only catches up with ground that streamed in since
    if (refreshGround() && last) place(last.tl, last.t);
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
    // every rest's bench: our own, or the street dressing's fact bench she sits on
    const benchCornersLonLat = [...seats].map(([eventIndex, s]) => {
      const b = benches.get(eventIndex);
      const yaw = b ? b.object3d.rotation.y : (s.yaw as number);
      const corners = benchCorners(s.x, s.z, yaw).map(
        ([x, z]) => frame.toLonLat(x, z) as [number, number],
      );
      return { eventIndex, corners, fact: factSeats.has(eventIndex) };
    });
    const kind = (hero as { kind?: () => string }).kind?.();
    return { contacts, benches: benchCornersLonLat, cost: cost(), model: kind ?? "custom" };
  };

  const cost = (): HeroCost => {
    const sorted = [...times].sort((a, b) => a - b);
    const n = sorted.length;
    return {
      poses: n,
      meanMs: n ? sorted.reduce((a, b) => a + b, 0) / n : 0,
      p95Ms: n ? (sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)] as number) : 0,
      maxMs: n ? (sorted[n - 1] as number) : 0,
      rebuilds,
      lastRebuildMs: index?.buildMs ?? 0,
      meanRebuildMs: rebuildMs.length ? rebuildMs.reduce((a, b) => a + b, 0) / rebuildMs.length : 0,
      maxRebuildMs: rebuildMs.length ? Math.max(...rebuildMs) : 0,
      triangles: index?.triangles ?? 0,
    };
  };

  return {
    group,
    hero,
    seats,
    helpers,
    pose: place,
    refreshGround,
    cost,
    dispose() {
      hero.dispose();
      for (const b of benches.values()) b.dispose();
      group.clear();
    },
  };
}
