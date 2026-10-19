import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createClearance } from "../../scene/three/clearance";
import { createFrame } from "../../scene/three/frame";
import {
  approachClear,
  restSchedule,
  SEAT_OFFSET_M,
  seatFor,
} from "../../scene/three/journey/heroDriver";
import demo from "../fixtures/demoPlan.json";
import { createRoutePath } from "../routePath";
import { buildTimeline, type JourneyPlan, type Phase } from "../timeline";
import { buildGroundIndex, corridorCells, groundBandMeshes } from "./groundIndex";
import { createHeroLayer, footprintClearance, groundAt, HERO_GROUND_Y } from "./heroLayer";

const plan = demo as unknown as JourneyPlan;
const frame = createFrame([101.5135, 3.18]);
const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));
const tl = buildTimeline(plan);
const rest = tl.phases.find((p) => p.event?.kind === "rest") as Phase;
const sch = restSchedule(rest.t1 - rest.t0);
const sitT = rest.t0 + (sch.sitIdle[0] + sch.sitIdle[1]) / 2;

/** A flat ground-band plane at height y, as groundLayer tags its meshes. */
function bandPlane(y: number, band: string): THREE.Object3D {
  const g = new THREE.PlaneGeometry(4000, 4000);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.y = y;
  m.userData.groundBand = band;
  m.raycast = () => {}; // unpickable, as the real bands: the sampler raycasts them directly
  const scene = new THREE.Scene();
  scene.add(m);
  scene.updateMatrixWorld(true);
  return scene;
}

/** Ground with edges: a land-cover plane at 0.02 m and 1.5 m wide footway strips (0.08 m) every 3 m. */
function stripedGround(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(bandPlane(0.02, "landcover"));
  for (let x = -600; x <= 600; x += 3) {
    const g = new THREE.PlaneGeometry(1.5, 2000);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.position.set(x, 0.08, 0);
    m.userData.groundBand = "roads";
    m.raycast = () => {};
    scene.add(m);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

describe("hero layer ground", () => {
  it("samples the drawn ground band (highest wins, markings and untagged meshes ignored)", () => {
    const s = new THREE.Scene();
    s.add(bandPlane(0.02, "landcover"), bandPlane(0.05, "parks"), bandPlane(0.1, "markings"));
    s.updateMatrixWorld(true);
    const g = groundAt([s], 3, 4);
    expect(g.band).toBe("parks");
    expect(g.y).toBeCloseTo(0.05, 6);
    expect(groundAt([new THREE.Scene()], 0, 0)).toEqual({ y: 0, band: null });
  });

  it("the corridor height table equals a downward raycast on the route, and knows nothing far off it", () => {
    const scene = stripedGround();
    const idx = buildGroundIndex(
      groundBandMeshes([scene]),
      corridorCells(
        Array.from({ length: 200 }, (_, i) => path.pointAt((i * path.planLength) / 199)),
        2.5,
      ),
    );
    for (let i = 0; i < 400; i++) {
      const [x, z] = path.pointAt((i * path.planLength) / 399);
      const px = x + Math.sin(i) * 1.2;
      const pz = z + Math.cos(i * 1.7) * 1.2;
      const ray = groundAt([scene], px, pz);
      expect(idx.heightAt(px, pz)).toBeCloseTo(ray.y, 6);
      expect(idx.bandAt(px, pz)).toBe(ray.band);
    }
    expect(idx.heightAt(5000, 5000)).toBeNull();
  });

  it("stands her and the bench on the drawn ground once its tiles are in", () => {
    let roots: THREE.Object3D[] = [];
    let gen = 0;
    const l = createHeroLayer(plan, path, frame, {
      roots: () => roots,
      groundGeneration: () => gen,
    });
    l.refreshGround();
    const before = l.pose(tl, sitT);
    expect(before.clip).toBe("sit_idle");
    expect(before.groundKnown).toBe(false);
    expect(before.y).toBeCloseTo(HERO_GROUND_Y, 9);
    roots = [bandPlane(0.05, "parks")];
    expect(l.refreshGround()).toBe(false); // the generation has not moved: no re-check
    gen++;
    expect(l.refreshGround()).toBe(true);
    const after = l.pose(tl, sitT);
    expect(after.groundKnown).toBe(true);
    expect(after.y).toBeCloseTo(0.05, 6);
    const bench = l.group.children.find((c) => c.name === "journey-bench") as THREE.Object3D;
    expect(bench.position.y).toBeCloseTo(0.05, 6);
    expect(l.cost().rebuilds).toBe(1);
    l.dispose();
  });
});

describe("hero layer foot planting (play and seek alike)", () => {
  it("keeps all six contacts within 3 cm of the drawn ground over a whole trip with kerbs every 3 m", () => {
    const scene = stripedGround();
    const l = createHeroLayer(plan, path, frame, {
      roots: () => [scene],
      groundGeneration: () => 1,
    });
    l.refreshGround();
    let worst = 0;
    let n = 0;
    for (let t = 0; t <= tl.total; t += 0.25) {
      l.pose(tl, t);
      for (const c of l.hero.contacts()) {
        const g = groundAt([scene], c.x, c.z);
        worst = Math.max(worst, Math.abs(c.y - g.y));
        n++;
      }
    }
    expect(n).toBeGreaterThan(300 * 6);
    expect(worst).toBeLessThanOrEqual(0.03);
    l.dispose();
  });

  it("a pose is the same whether reached by playing through or by seeking", () => {
    const scene = stripedGround();
    const mk = () =>
      createHeroLayer(plan, path, frame, { roots: () => [scene], groundGeneration: () => 1 });
    const a = mk();
    const b = mk();
    a.refreshGround();
    b.refreshGround();
    const t = sitT - 1.3;
    for (let u = 0; u < t; u += 1 / 60) a.pose(tl, u);
    a.pose(tl, t);
    b.pose(tl, t);
    expect(a.hero.contacts()).toEqual(b.hero.contacts());
    a.dispose();
    b.dispose();
  });

  it("reports its per-pose cost", () => {
    const scene = stripedGround();
    const l = createHeroLayer(plan, path, frame, {
      roots: () => [scene],
      groundGeneration: () => 1,
    });
    l.refreshGround();
    for (let t = 0; t < 20; t += 0.1) l.pose(tl, t);
    const c = l.cost();
    expect(c.poses).toBe(200);
    expect(c.meanMs).toBeGreaterThan(0);
    expect(c.triangles).toBeGreaterThan(0);
    l.dispose();
  });
});

describe("hero layer seat side", () => {
  it("keeps the seat clear of a building footprint beside the rest point", () => {
    const e = plan.events[rest.eventIndex as number] as JourneyPlan["events"][number];
    const [px, pz] = path.pointAt(e.at_m);
    const left = seatFor(path.pointAt, e.at_m, null);
    // a 4 m square footprint centred on the default (left) seat
    const sq = [
      [left.x - 2, left.z - 2],
      [left.x + 2, left.z - 2],
      [left.x + 2, left.z + 2],
      [left.x - 2, left.z + 2],
      [left.x - 2, left.z - 2],
    ].map(([x, z]) => frame.toLonLat(x as number, z as number));
    const fc = { features: [{ geometry: { type: "Polygon", coordinates: [sq] } }] };
    const clearance = footprintClearance(fc, frame, [[px, pz]]);
    expect(clearance(left.x, left.z)).toBe(0);
    const l = createHeroLayer(plan, path, frame, { footprints: fc });
    const seat = l.seats.get(rest.eventIndex as number) as { x: number; z: number };
    expect(Math.hypot(seat.x - left.x, seat.z - left.z)).toBeCloseTo(2 * SEAT_OFFSET_M, 3);
    expect(clearance(seat.x, seat.z)).toBeGreaterThan(0);
    l.dispose();
  });
});

describe("hero layer seats keep out of drawn buildings (D-T5 ruling)", () => {
  const e = plan.events[rest.eventIndex as number] as JourneyPlan["events"][number];
  const [px, pz] = path.pointAt(e.at_m);
  const box = (cx: number, cz: number, half: number) =>
    createClearance([
      {
        id: "landmark-box",
        ring: [
          [cx - half, cz - half],
          [cx + half, cz - half],
          [cx + half, cz + half],
          [cx - half, cz + half],
        ],
        topM: 9,
      },
    ]);

  it("a bench place inside a drawn (archetype / landmark) box: the seat moves out of it", () => {
    // the bench place 3 m off the route (in the 1.2-6 m range) inside a 6 m box no OSM outline has
    const place: [number, number] = [px + 3, pz];
    const grid = box(place[0], place[1], 3.2);
    const inside = seatFor(path.pointAt, e.at_m, place);
    expect(inside).toEqual({ x: place[0], z: place[1] });
    const ll = frame.toLonLat(place[0], place[1]);
    const places = new Map([[e.element_id as string, ll as [number, number]]]);
    const l = createHeroLayer(plan, path, frame, { places, grid });
    const seat = l.seats.get(rest.eventIndex as number) as { x: number; z: number };
    expect(grid.topAt(seat.x, seat.z)).toBe(0);
    // the approach from the route point never enters the box
    expect(approachClear((x, z) => (grid.topAt(x, z) > 0 ? 0 : 1), [px, pz], seat)).toBe(true);
    l.dispose();
  });

  it("the route point inside a drawn box: she may walk out of it, never back in", () => {
    const grid = box(px, pz, 2.5);
    const clear = (x: number, z: number) => (grid.topAt(x, z) > 0 ? 0 : 1);
    const seat = seatFor(path.pointAt, e.at_m, null, clear);
    expect(grid.topAt(seat.x, seat.z)).toBe(0);
    expect(Math.hypot(seat.x - px, seat.z - pz)).toBeGreaterThan(2.5);
    expect(approachClear(clear, [px, pz], seat)).toBe(true);
    // in, out, in again is not clear
    const far = box(px + 5, pz, 1);
    const both = (x: number, z: number) => (grid.topAt(x, z) > 0 || far.topAt(x, z) > 0 ? 0 : 1);
    expect(approachClear(both, [px, pz], { x: px + 8, z: pz })).toBe(false);
  });
});
