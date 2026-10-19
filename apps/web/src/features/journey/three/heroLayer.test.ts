import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "../../scene/three/frame";
import { restSchedule, SEAT_OFFSET_M, seatFor } from "../../scene/three/journey/heroDriver";
import demo from "../fixtures/demoPlan.json";
import { createRoutePath } from "../routePath";
import { buildTimeline, type JourneyPlan, type Phase } from "../timeline";
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

  it("seats her and the bench on the rest's sampled ground once its band has streamed in", () => {
    let roots: THREE.Object3D[] = [];
    let clock = 0;
    const l = createHeroLayer(plan, path, frame, { roots: () => roots, now: () => clock });
    const before = l.pose(tl, sitT);
    expect(before.clip).toBe("sit_idle");
    expect(before.groundKnown).toBe(false);
    expect(before.y).toBeCloseTo(HERO_GROUND_Y, 9);
    roots = [bandPlane(0.05, "parks")];
    clock += 1000; // past the retry interval
    const after = l.pose(tl, sitT);
    expect(after.groundKnown).toBe(true);
    expect(after.y).toBeCloseTo(0.05, 6);
    const bench = l.group.children.find((c) => c.name === "journey-bench") as THREE.Object3D;
    expect(bench.position.y).toBeCloseTo(0.05, 6);
    // every contact (feet and the parked walker) sits on that ground
    for (const c of after.probe?.().contacts ?? []) {
      expect(c.band).toBe("parks");
      expect(Math.abs(c.y - c.groundY)).toBeLessThanOrEqual(0.03);
    }
    // on the route (a walk phase) she keeps the footway height
    const walk = tl.phases.find((p) => p.kind === "walk") as Phase;
    expect(l.pose(tl, (walk.t0 + walk.t1) / 2).y).toBeCloseTo(HERO_GROUND_Y, 9);
    l.dispose();
  });

  it("a probe re-tries the ground at once (paused acceptance beats) and re-poses", () => {
    let roots: THREE.Object3D[] = [];
    const seen: number[] = [];
    const l = createHeroLayer(plan, path, frame, {
      roots: () => roots,
      now: () => 0,
      onPose: (p) => seen.push(p.y),
    });
    const p = l.pose(tl, sitT);
    roots = [bandPlane(0.03, "landcover")];
    const probe = p.probe?.();
    expect(seen.at(-1)).toBeCloseTo(0.03, 6);
    expect(probe?.contacts.every((c) => c.band === "landcover")).toBe(true);
    expect(probe?.benches).toHaveLength(3);
    for (const b of probe?.benches ?? []) expect(b.corners).toHaveLength(4);
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
