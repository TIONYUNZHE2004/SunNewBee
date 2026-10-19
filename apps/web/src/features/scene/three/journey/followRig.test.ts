import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import demoPlan from "../../../journey/fixtures/demoPlan.json";
import { createRoutePath } from "../../../journey/routePath";
import { MARKER_LIFT_M, MARKER_STACK_M } from "../../../journey/three/journeyLayer";
import { createViewFit, safeRectOf } from "../../../journey/three/viewFit";
import {
  buildTimeline,
  DIVE_S,
  type JourneyPlan,
  PULL_S,
  stateAt,
} from "../../../journey/timeline";
import { HERO_CENTRE } from "../bookmarks";
import { type Clearance, createClearance, type Obstacle, obstaclesFromCity } from "../clearance";
import { createFrame } from "../frame";
import {
  blendPose,
  type CamPose,
  elementPoint,
  FOLLOW,
  type FollowScene,
  followPose,
  followPoseAt,
  framingFor,
  HERO_CHEST_Y,
  holdSubjects,
  journeyCameraAt,
  MIN_HERO_DIST_M,
  rawFrameAt,
} from "./followRig";
import { heroPositionAt, heroStateAt } from "./heroDriver";
import { insideSafe } from "./safeFrame";

const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame(HERO_CENTRE);
const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));
const tl = buildTimeline(plan);
const OVERVIEW: CamPose = { pos: [0, 5600, 5600], look: [0, 0, 0] };

/** The hero's drawn box (placeholder: 2.42 m tall at 0.08 m, walker and ring within 0.9 m). */
const HERO_BOX = { r: 0.9, y0: 0.08, y1: 2.5 };
/** The map area left of the side panel at the acceptance size (1440 x 900, panel open). */
const VIEW = { w: 1000, h: 874 };

function cameraFor(p: CamPose, aspect = VIEW.w / VIEW.h): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(30, aspect, 0.5, 30000);
  c.position.set(...p.pos);
  c.lookAt(...p.look);
  c.updateMatrixWorld();
  return c;
}

/** Screen box (NDC [0, 1], y down) of the hero's box at (x, z), or null when a corner is behind. */
function heroScreenBox(cam: THREE.PerspectiveCamera, x: number, z: number) {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const v = new THREE.Vector3();
  for (const dx of [-HERO_BOX.r, HERO_BOX.r])
    for (const dz of [-HERO_BOX.r, HERO_BOX.r])
      for (const y of [HERO_BOX.y0, HERO_BOX.y1]) {
        v.set(x + dx, y, z + dz).applyMatrix4(cam.matrixWorldInverse);
        if (v.z >= 0) return null;
        v.applyMatrix4(cam.projectionMatrix);
        const sx = (v.x + 1) / 2;
        const sy = (1 - v.y) / 2;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
  return { x0, y0, x1, y1 };
}
const inMargin = (b: ReturnType<typeof heroScreenBox>, m = 0.1) =>
  !!b && b.x0 >= m && b.x1 <= 1 - m && b.y0 >= m && b.y1 <= 1 - m;
const projects = (cam: THREE.PerspectiveCamera, p: readonly [number, number, number]) => {
  const v = new THREE.Vector3(...p).applyMatrix4(cam.matrixWorldInverse);
  if (v.z >= 0) return false;
  v.applyMatrix4(cam.projectionMatrix);
  return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
};

const helpers = { pointAt: path.pointAt };
const scene = (over: Partial<FollowScene> = {}): FollowScene => ({
  timeline: tl,
  pointAt: path.pointAt,
  overview: OVERVIEW,
  heroAt: (t) => heroPositionAt(tl, t, helpers),
  ...over,
});
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );
const isFollowPhase = (t: number) => {
  const k = stateAt(tl, t).phase.kind;
  return k === "walk" || k === "event";
};

describe("follow pose (spec §6.4)", () => {
  it("stands 8.5 m back, 4.5 m to the side, 4.2 m up and looks 4 m ahead", () => {
    const p = followPose([10, 20], [1, 0]);
    // facing east (+x): back is -x, the right side is +z (south)
    expect(p.pos).toEqual([10 - 8.5, 4.2, 20 + 4.5]);
    // 4 m ahead, nudged 1.5 m to the far side of her line (centres her box)
    expect(p.look).toEqual([10 + 4, FOLLOW.lookYM, 20 - FOLLOW.lookSideM]);
    const m = followPose([0, 0], [0, -1], -1); // facing north, mirrored side (west)
    expect(m.pos[0]).toBeCloseTo(-4.5);
    expect(m.pos[2]).toBeCloseTo(8.5);
  });

  it("frames her whole box inside the frame with a 10% margin", () => {
    for (const aspect of [VIEW.w / VIEW.h, 16 / 9, 1.1]) {
      const cam = cameraFor(followPose([0, 0], [0.6, 0.8]), aspect);
      expect(inMargin(heroScreenBox(cam, 0, 0))).toBe(true);
    }
  });

  it("framing rules per event kind", () => {
    expect(framingFor("rest")).toBe("rest");
    expect(framingFor("unknown")).toBe("unknown");
    expect(framingFor("arrive")).toBe("arrive");
    for (const k of ["verified", "covered", "gap"] as const) expect(framingFor(k)).toBe("follow");
    expect(framingFor(undefined)).toBe("follow");
  });
});

describe("damping, dive and pull-back", () => {
  it("is the exact follow pose mid-way along a straight walk (offsets constant)", () => {
    const straight = {
      ...plan,
      events: [],
      spans: [[0, 400, "PASS"]],
    } as unknown as JourneyPlan;
    const tl2 = buildTimeline(straight);
    const sc: FollowScene = {
      timeline: tl2,
      pointAt: (m) => [m, 0],
      overview: OVERVIEW,
    };
    const t = DIVE_S + (tl2.total - DIVE_S - PULL_S) / 2;
    const p = journeyCameraAt(sc, t, "follow") as CamPose;
    const m = stateAt(tl2, t).distance_m;
    const want = followPose([m, 0], [1, 0]);
    for (let i = 0; i < 3; i++) {
      expect(p.pos[i]).toBeCloseTo(want.pos[i] as number, 6);
      expect(p.look[i]).toBeCloseTo(want.look[i] as number, 6);
    }
  });

  it("dives from the overview to the follow pose and pulls back to the overview", () => {
    const sc = scene();
    const a = journeyCameraAt(sc, 0, "follow") as CamPose;
    expect(dist(a.pos, OVERVIEW.pos)).toBeLessThan(1e-6);
    const b = journeyCameraAt(sc, DIVE_S, "follow") as CamPose;
    const f = followPoseAt(sc, DIVE_S);
    expect(dist(b.pos, f.pos)).toBeLessThan(1e-6);
    // the distance to the look point only shrinks during the dive
    let last = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= DIVE_S; t += 0.1) {
      const p = journeyCameraAt(sc, t, "follow") as CamPose;
      const d = dist(p.pos, p.look);
      expect(d).toBeLessThanOrEqual(last + 1e-6);
      last = d;
    }
    const end = journeyCameraAt(sc, tl.total, "follow") as CamPose;
    expect(dist(end.pos, OVERVIEW.pos)).toBeLessThan(1e-6);
    expect(journeyCameraAt(sc, 30, "overview")).toEqual(OVERVIEW);
    expect(journeyCameraAt(sc, 30, "free")).toBeNull();
  });

  it("blendPose hits both ends and interpolates the distance in log space", () => {
    const a: CamPose = { pos: [0, 1000, 0], look: [0, 0, 0] };
    const b: CamPose = { pos: [0, 10, 0], look: [50, 0, 0] };
    const s0 = blendPose(a, b, 0);
    expect(dist(s0.pos, a.pos) + dist(s0.look, a.look)).toBeLessThan(1e-9);
    const e = blendPose(a, b, 1);
    expect(dist(e.pos, b.pos) + dist(e.look, b.look)).toBeLessThan(1e-9);
    const mid = blendPose(a, b, 0.5);
    expect(dist(mid.pos, mid.look)).toBeCloseTo(Math.sqrt(1000 * Math.hypot(50, 10)), 6);
  });

  it("moves smoothly at 10 Hz over the whole demo trip (no snaps)", () => {
    const sc = scene();
    let prev: CamPose | null = null;
    let worstFollowStep = 0;
    for (let t = DIVE_S; t <= tl.total - PULL_S; t += 0.1) {
      const p = journeyCameraAt(sc, t, "follow") as CamPose;
      if (prev) worstFollowStep = Math.max(worstFollowStep, dist(p.pos, prev.pos));
      prev = p;
    }
    // she walks ~23 m/s on screen in compressed walks: one tick moves ~2.3 m, framing changes ease in
    expect(worstFollowStep).toBeLessThan(8);
  });
});

describe("per-event framing on the demo route", () => {
  const sc = scene();
  const holds = tl.phases.filter((p) => p.kind === "event");

  it("each event's element projects inside the frame through its hold", () => {
    for (const ph of holds) {
      for (const u of [0.25, 0.5, 0.75, 1]) {
        const t = ph.t0 + (ph.t1 - ph.t0) * u - 1e-6;
        const el = elementPoint(sc, ph.eventIndex as number, stateAt(tl, t).distance_m);
        expect(el).not.toBeNull();
        const cam = cameraFor(journeyCameraAt(sc, t, "follow") as CamPose);
        expect(projects(cam, el as [number, number, number]), `${ph.event?.kind} u=${u}`).toBe(
          true,
        );
      }
    }
  });

  it("rest: a side view across the route-to-seat line, her route point and the seat in frame", () => {
    const seats = new Map<number, { x: number; z: number }>();
    plan.events.forEach((e, i) => {
      if (e.kind !== "rest") return;
      const [x, z] = path.pointAt(e.at_m);
      seats.set(i, { x: x + 3, z: z + 1 });
    });
    const s2 = scene({ seatOf: (i) => seats.get(i) ?? null });
    const rest = holds.find((p) => p.event?.kind === "rest");
    expect(rest).toBeDefined();
    const i = rest?.eventIndex as number;
    const r = rawFrameAt(s2, ((rest?.t0 as number) + (rest?.t1 as number)) / 2);
    expect(r.framing).toBe("rest");
    const seat = seats.get(i) as { x: number; z: number };
    const route = path.pointAt(plan.events[i]?.at_m as number);
    const [vx, vz] = [r.lookOff[0] - r.off[0], r.lookOff[2] - r.off[2]];
    const [ax, az] = [seat.x - route[0], seat.z - route[1]];
    const cos = (vx * ax + vz * az) / (Math.hypot(vx, vz) * Math.hypot(ax, az));
    expect(Math.abs(cos)).toBeLessThan(0.05); // perpendicular: the side view of the bench
    const cam = cameraFor(journeyCameraAt(s2, (rest?.t0 as number) + 2, "follow") as CamPose);
    expect(projects(cam, [seat.x, 0.5, seat.z])).toBe(true);
    expect(projects(cam, [route[0], 0.5, route[1]])).toBe(true);
  });

  it("arrive: the destination is in frame", () => {
    const end = path.pointAt(path.planLength);
    const dest: [number, number] = [end[0] + 30, end[1] - 20];
    const s2 = scene({ destination: dest });
    const arrive = holds.find((p) => p.event?.kind === "arrive");
    const t = ((arrive?.t0 as number) + (arrive?.t1 as number)) / 2;
    const cam = cameraFor(journeyCameraAt(s2, t, "follow") as CamPose);
    expect(projects(cam, [dest[0], 0.5, dest[1]])).toBe(true);
    expect(inMargin(heroScreenBox(cam, end[0], end[1]))).toBe(true);
  });

  it("unknown: picks the side with the clear view of the element", () => {
    const unk = holds.find((p) => p.event?.kind === "unknown");
    const t = ((unk?.t0 as number) + (unk?.t1 as number)) / 2;
    const free = rawFrameAt(scene(), t);
    expect(free.framing).toBe("unknown");
    // a tall block where the default (right-hand) camera stands
    const a = free.anchor;
    const camX = a[0] + free.off[0];
    const camZ = a[1] + free.off[2];
    const midX = (a[0] + camX) / 2;
    const midZ = (a[1] + camZ) / 2;
    const block: Obstacle = {
      id: "podium",
      ring: [
        [midX - 2, midZ - 2],
        [midX + 2, midZ - 2],
        [midX + 2, midZ + 2],
        [midX - 2, midZ + 2],
      ],
      topM: 25,
    };
    const blocked = rawFrameAt(scene({ clearance: createClearance([block]) }), t);
    // mirrored: the side offset flips and no lift is needed
    const side = (o: readonly number[]) =>
      (o[0] as number) * (camX - a[0]) + (o[2] as number) * (camZ - a[1]);
    expect(side(blocked.off)).toBeLessThan(side(free.off));
    expect(blocked.lift).toBe(0);
  });
});

/** AC-D8 / AC-D9 maths over a 10 Hz playback: hero in frame, line of sight, distance, floor. */
function playback(sc: FollowScene, c: Clearance | null) {
  let follow = 0;
  let inFrame = 0;
  let clear = 0;
  let minDist = Number.POSITIVE_INFINITY;
  let inside = 0;
  let routeCrossed = 0;
  for (let t = 0; t <= tl.total + 1e-9; t += 0.1) {
    const p = journeyCameraAt(sc, t, "follow") as CamPose;
    const h = heroStateAt(tl, t, helpers);
    const chest: [number, number, number] = [h.x, HERO_CHEST_Y, h.z];
    // the distance to her box (AC-D9)
    const dx = Math.max(0, Math.abs(p.pos[0] - h.x) - HERO_BOX.r);
    const dz = Math.max(0, Math.abs(p.pos[2] - h.z) - HERO_BOX.r);
    const dy = Math.max(0, p.pos[1] - HERO_BOX.y1, HERO_BOX.y0 - p.pos[1]);
    minDist = Math.min(minDist, Math.hypot(dx, dy, dz));
    if ((c?.topAt(p.pos[0], p.pos[2]) ?? 0) > p.pos[1]) inside++;
    if (!isFollowPhase(t)) continue;
    follow++;
    if (inMargin(heroScreenBox(cameraFor(p), h.x, h.z))) inFrame++;
    if (!c || !c.segmentHitsBuilding(p.pos, chest)) clear++;
    // she stands inside (or on the wall of) a footprint the route crosses
    else if (c.maxRoofNear(h.x, h.z, 0.1) > 0) routeCrossed++;
  }
  return {
    follow,
    inFrame: inFrame / follow,
    clear: clear / follow,
    minDist,
    inside,
    /** Blocked samples where she stands inside a footprint the route itself crosses (ruling). */
    routeCrossed,
  };
}

describe("AC-D8 / AC-D9 maths on the demo route", () => {
  it("without buildings: always in frame, never within 1.5 m", () => {
    const r = playback(scene(), null);
    expect(r.follow).toBeGreaterThan(500);
    expect(r.inFrame).toBeGreaterThanOrEqual(0.98);
    expect(r.minDist).toBeGreaterThanOrEqual(MIN_HERO_DIST_M);
  });

  it("deterministic: a scrub (any order) gives the play pose", () => {
    const sc = scene();
    const ts = Array.from({ length: 200 }, (_, i) => (i * tl.total) / 199);
    const fwd = ts.map((t) => journeyCameraAt(sc, t, "follow"));
    const rev = [...ts].reverse().map((t) => journeyCameraAt(sc, t, "follow"));
    rev.reverse();
    expect(rev).toEqual(fwd);
  });
});

// The Elmina seed buildings (skipped when the seed is not checked out).
const SEED = new URL(
  "../../../../../../../data/seed/elmina/base/buildings.geojson",
  import.meta.url,
);
describe.skipIf(!existsSync(SEED))("seed buildings: clearance interplay", () => {
  const layer = { buildings: JSON.parse(readFileSync(SEED, "utf8")) } as unknown as BuildingsLayer;
  const c = createClearance(obstaclesFromCity(layer, frame));
  const sc = scene({ clearance: c });

  it("in frame >= 98%, clear line of sight >= 95%, >= 1.5 m from her, never inside a building", () => {
    const r = playback(sc, c);
    if (r.inFrame < 0.98 || r.clear < 0.95) throw new Error(JSON.stringify(r));
    expect(r.inFrame).toBeGreaterThanOrEqual(0.98);
    expect(r.clear).toBeGreaterThanOrEqual(0.95);
    expect(r.minDist).toBeGreaterThanOrEqual(MIN_HERO_DIST_M);
    expect(r.inside).toBe(0);
    // every hidden sample is her inside a footprint the planned route crosses (Harmoni 1 at the
    // start, the Sales Gallery at ~831 m; coordinator ruling): none is the camera's doing
    expect(Math.round((1 - r.clear) * r.follow)).toBe(r.routeCrossed);
  });

  it("clearance only raises the camera where it keeps its side of her (never dives in)", () => {
    const bare = scene();
    let kept = 0;
    let raised = 0;
    for (let t = DIVE_S; t < tl.total - PULL_S; t += 0.13) {
      const a = journeyCameraAt(bare, t, "follow") as CamPose;
      const b = journeyCameraAt(sc, t, "follow") as CamPose;
      if (Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) > 0.01) continue;
      kept++;
      expect(b.pos[1]).toBeGreaterThanOrEqual(a.pos[1] - 1e-9);
      if (b.pos[1] > a.pos[1] + 0.5) raised++;
    }
    expect(kept).toBeGreaterThan(300);
    expect(raised).toBeGreaterThan(0);
  });

  it("costs under 1 ms per pose on the seed (median of the trip at 10 Hz)", () => {
    for (let t = DIVE_S; t < DIVE_S + 5; t += 0.1) journeyCameraAt(sc, t, "follow"); // warm-up
    const ms: number[] = [];
    for (let t = DIVE_S; t < tl.total - PULL_S; t += 0.1) {
      const t0 = performance.now();
      journeyCameraAt(sc, t, "follow");
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const median = ms[Math.floor(ms.length / 2)] as number;
    expect(median).toBeLessThan(1);
  });

  it("the hero lookup the camera uses is where the driver puts her", () => {
    for (let t = 0; t < tl.total; t += 0.37) {
      const s = heroStateAt(tl, t, helpers);
      expect(heroPositionAt(tl, t, helpers)).toEqual([s.x, s.z]);
    }
  });
});

describe("UI-safe hold framing (final gate AC-D11)", () => {
  // the acceptance map area with the top stack (header, status, label, HUD) ending at 235 px
  const size: [number, number] = [920, 875];
  const vp = { w: 920, h: 860, top: 235 };
  const cam = new THREE.PerspectiveCamera(30, size[0] / size[1], 0.5, 30000);
  cam.updateProjectionMatrix();
  const view = createViewFit(cam, size, safeRectOf(vp));
  // the journey layer's marker anchors: 5 m over the event's route point, stacked 1.6 m per event
  const markerOf = (i: number): [number, number, number] | null => {
    const e = plan.events[i];
    if (!e) return null;
    const [x, z] = path.pointAt(e.at_m);
    const stacked = plan.events.filter((f, j) => j < i && Math.abs(f.at_m - e.at_m) < 3).length;
    return [x, MARKER_LIFT_M + stacked * MARKER_STACK_M, z];
  };

  it("mid-hold, her body, the element and the marker are inside the safe area", () => {
    const sc = scene({ view, markerOf });
    const holds = tl.phases.filter((p) => p.kind === "event" && p.eventIndex !== undefined);
    expect(holds.length).toBeGreaterThan(5);
    for (const p of holds) {
      const t = (p.t0 + p.t1) / 2;
      const pose = journeyCameraAt(sc, t, "follow") as CamPose;
      const st = stateAt(tl, t);
      const subjects = holdSubjects(sc, t, p.eventIndex as number, st.distance_m);
      expect(insideSafe(pose, subjects, view), `hold ${p.eventIndex}`).toBe(true);
    }
  });

  it("without a view the poses are the plain follow poses; with one, walks are unchanged", () => {
    const plain = scene();
    const fitted = scene({ view, markerOf });
    for (const p of tl.phases.filter((q) => q.kind === "walk")) {
      const t = (p.t0 + p.t1) / 2;
      expect(journeyCameraAt(fitted, t, "follow")).toEqual(journeyCameraAt(plain, t, "follow"));
    }
  });

  it("the fitted camera is as smooth at 10 Hz as the plain one (no jump at a hold's ends)", () => {
    const worstStep = (sc: FollowScene) => {
      let prev = journeyCameraAt(sc, DIVE_S, "follow") as CamPose;
      let worst = 0;
      for (let t = DIVE_S + 0.1; t < tl.total - PULL_S; t += 0.1) {
        const p = journeyCameraAt(sc, t, "follow") as CamPose;
        worst = Math.max(worst, dist(p.look, prev.look), dist(p.pos, prev.pos));
        prev = p;
      }
      return worst;
    };
    expect(worstStep(scene({ view, markerOf }))).toBeLessThanOrEqual(worstStep(scene()) + 0.5);
  });
});
