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
import type { HeroPose } from "../journeyStore";
import type { RoutePath } from "../routePath";
import type { JourneyPlan, Timeline } from "../timeline";

/** She stands where the decorative agents do: on the road / footway ribbons (0.08 m), not in them. */
export const HERO_GROUND_Y = AGENT_LIFT_M;

/**
 * The journey hero in the 3D scene: the hero model (placeholder until C-T4) plus a bench at each
 * rest stop of the plan. `pose(tl, t)` puts her where `heroStateAt` says and returns what was drawn.
 */
export interface HeroLayer {
  group: THREE.Group;
  hero: Hero;
  seats: Map<number, HeroSeat>;
  pose(tl: Timeline, t: number): HeroPose;
  dispose(): void;
}

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _from = new THREE.Vector3();

/**
 * The drawn ground height at (x, z): the highest ground-band surface (land cover, roads, markings;
 * `groundLayer.ts` tags them `userData.groundBand` and makes them unpickable, so they are raycast
 * directly, as the acceptance road mask does), else the base plane (0). Test probe only.
 */
export function groundAt(
  roots: readonly THREE.Object3D[],
  x: number,
  z: number,
): { y: number; band: string | null } {
  _from.set(x, 5, z);
  _ray.set(_from, _down);
  _ray.far = 10;
  let best: { y: number; band: string | null } = { y: 0, band: null };
  const hits: THREE.Intersection[] = [];
  for (const r of roots)
    r.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !o.userData.groundBand || o.userData.groundBand === "markings") return;
      hits.length = 0;
      THREE.Mesh.prototype.raycast.call(m, _ray, hits);
      for (const h of hits)
        if (h.point.y > best.y) best = { y: h.point.y, band: o.userData.groundBand };
    });
  return best;
}

export function createHeroLayer(
  plan: JourneyPlan,
  path: RoutePath,
  frame: LocalFrame,
  opts: {
    places?: ReadonlyMap<string, LonLat>;
    /** The scene roots for the ground probe (the engine's `pickView().roots`). */
    roots?: () => readonly THREE.Object3D[];
    createHero?: () => Hero;
  } = {},
): HeroLayer {
  const hero = (opts.createHero ?? createPlaceholderHero)();
  const group = new THREE.Group();
  group.name = "journey-hero-layer";
  group.userData.decorative = true;
  group.add(hero.object3d);

  // One seat per rest event: the bench place when the access layer has it, else a side offset.
  const seats = new Map<number, HeroSeat>();
  const benches: { dispose(): void }[] = [];
  plan.events.forEach((e, i) => {
    if (e.kind !== "rest") return;
    const ll = e.element_id ? opts.places?.get(e.element_id) : undefined;
    const place = ll ? frame.toLocal(ll[0], ll[1]) : null;
    const seat = seatFor(path.pointAt, e.at_m, place);
    seats.set(i, seat);
    const [rx, rz] = path.pointAt(e.at_m);
    const b = createRestBench();
    b.object3d.position.set(seat.x, HERO_GROUND_Y, seat.z);
    // the bench faces the route, as she does when seated (model front +z)
    b.object3d.rotation.y = Math.atan2(rx - seat.x, rz - seat.z);
    group.add(b.object3d);
    benches.push(b);
  });

  const helpers: HeroPathHelpers = {
    pointAt: path.pointAt,
    seatOf: (i) => seats.get(i) ?? null,
  };
  const probe = () =>
    hero.contacts().map((c) => {
      const g = groundAt(opts.roots?.() ?? [], c.x, c.z);
      return { ...c, groundY: Math.max(g.y, 0), onFootway: g.band === "roads" };
    });

  return {
    group,
    hero,
    seats,
    pose(tl, t) {
      const s = heroStateAt(tl, t, helpers);
      hero.setPose({ x: s.x, y: HERO_GROUND_Y, z: s.z }, s.yaw);
      hero.play(s.clip, s.clipTime, s.walkRate);
      const [lon, lat] = frame.toLonLat(s.x, s.z);
      return { ...s, y: HERO_GROUND_Y, lon, lat, probe };
    },
    dispose() {
      hero.dispose();
      for (const b of benches) b.dispose();
      group.clear();
    },
  };
}
