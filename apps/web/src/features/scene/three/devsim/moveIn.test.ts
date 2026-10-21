import type * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoHook, registerDemoState, resetDemoRegistry } from "../../../demo/demoHook";
import { useDevsimAnchors } from "../../../devsim/anchors";
import elmina from "../../../devsim/fixtures/plan.elmina.json";
import provisional from "../../../devsim/fixtures/plan.provisional.json";
import { stateAt } from "../../../devsim/timeline";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { castMoveIn, castSlots, createCast, MOVERS } from "./cast";
import { createDevsimLayer, type DevsimPart } from "./devsimLayer";
import { inRing, siteGeom } from "./geom";
import {
  BOXES,
  CAR_AISLE_S,
  CAR_VARIANTS,
  carAt,
  carStalls,
  createMoveIn,
  KIDS,
  MOVER_DOOR_S,
  moverAt,
  PARKED_CARS,
} from "./moveIn";
import { createPilingRig } from "./pilingRig";
import { createRain } from "./rain";
import { createScaffold } from "./scaffold";
import { litShareAt, moveInCounter, SET_PIECE_S, setPieceTiming } from "./setPieces";
import { createSite, yardRing } from "./site";
import { createTower } from "./tower";

/** The 45 s Elmina building plan (C7), and the legacy 66 s plan (no schedule). */
const C7 = elmina as unknown as DevelopmentPlan;
const LEGACY = provisional as unknown as DevelopmentPlan;
const frame = createFrame(C7.anchors.junction as [number, number]);

afterEach(() => {
  useDevsimAnchors.getState().clear();
  resetDemoRegistry();
});

/** The whole devsim layer for a plan (tower, site, cast without a crowd kit, move-in). */
function layerFor(plan: DevelopmentPlan) {
  const l = createDevsimLayer({ plan, frame, anchors: false });
  const ru = createRoleUniforms();
  l.setTower(createTower({ geom: l.geom, roleUniforms: ru }));
  l.add(createSite({ geom: l.geom, roleUniforms: ru }));
  l.add(createCast({ plan, geom: l.geom }));
  l.add(createMoveIn({ geom: l.geom, timing: setPieceTiming(plan), roleUniforms: ru }));
  return l;
}

type St = {
  movingLorries: number;
  boxes: number;
  parkedCars: number;
  movers: { walking: number; entered: number };
  kidsAtPlayground: number;
  litShare: number;
  occupancy: number;
};

describe("move-in (AC-W5, schedule mode)", () => {
  it("lorries, boxes, movers, lit windows, parked cars and children between 27 and 33 s", () => {
    const l = layerFor(C7);
    const st = () => l.demoState() as unknown as St;
    let lastLit = -1;
    let maxLorries = 0;
    let walking = 0;
    for (let t = 27; t <= 33.001; t += 0.05) {
      l.setT(t);
      const s = st();
      // monotonic, whole floors; the occupancy counter follows lit x homes
      expect(s.litShare).toBeGreaterThanOrEqual(lastLit);
      lastLit = s.litShare;
      expect(s.occupancy).toBe(Math.round(s.litShare * C7.site.homes));
      maxLorries = Math.max(maxLorries, s.movingLorries);
      walking = Math.max(walking, s.movers.walking);
    }
    expect(maxLorries).toBeGreaterThanOrEqual(2);
    expect(walking).toBeGreaterThan(0);
    l.setT(28);
    expect(st().litShare).toBe(0);
    l.setT(33);
    const end = st();
    expect(end.litShare).toBeGreaterThanOrEqual(0.85);
    expect(end.boxes).toBeGreaterThanOrEqual(8);
    expect(end.movers.entered).toBeGreaterThanOrEqual(10);
    expect(end.parkedCars).toBeGreaterThanOrEqual(6);
    expect(end.kidsAtPlayground).toBeGreaterThanOrEqual(4);
    l.setT(31);
    expect(st().boxes).toBeGreaterThanOrEqual(8);
    l.setT(32.4);
    expect(st().kidsAtPlayground).toBe(0);
    l.setT(32.6);
    expect(st().kidsAtPlayground).toBeGreaterThanOrEqual(4);
    l.dispose();
  });

  it("the children play at the nearest playground; the movers walk from a lorry to the door", () => {
    const g = siteGeom(C7, frame);
    const cast = createCast({ plan: C7, geom: g });
    const mi = castMoveIn(C7, g);
    const layer = createDevsimLayer({ plan: C7, frame, anchors: false });
    layer.add(cast);
    layer.setT(33);
    for (let k = 0; k < KIDS; k++) {
      const p = cast.poseOf(`child${k}`);
      expect(p).not.toBeNull();
      if (p)
        expect(Math.hypot(p.x - g.playground[0], p.z - g.playground[1])).toBeLessThanOrEqual(8);
    }
    const mv = SET_PIECE_S.moveIn.movers;
    for (let i = 0; i < MOVERS; i++) {
      const path = mi.paths[i] as [number, number][];
      expect(path[path.length - 1]).toEqual(g.door);
      const first = moverAt(path, mv, i, mv.t0 + i * mv.gap);
      expect(first?.p).toEqual(path[0]);
    }
    layer.dispose();
  });

  it("lit share stays monotonic when seeking backward (C10 review minor 4)", () => {
    const l = layerFor(C7);
    const st = () => l.demoState() as unknown as St;
    // backward from 33 s to 27 s: never rises as t falls; the same t gives the same share
    // whatever was seen before (seek determinism)
    const forward = new Map<number, number>();
    for (let i = 0; i <= 120; i++) {
      const t = 27 + i * 0.05;
      l.setT(t);
      forward.set(i, st().litShare);
    }
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 120; i >= 0; i--) {
      l.setT(27 + i * 0.05);
      const lit = st().litShare;
      expect(lit).toBeLessThanOrEqual(prev);
      expect(lit).toBe(forward.get(i));
      prev = lit;
    }
    // jumps back and forth
    for (const [a, b] of [
      [33, 28.5],
      [30.2, 29.1],
      [32.9, 27.2],
    ] as const) {
      l.setT(a);
      const hi = st().litShare;
      l.setT(b);
      expect(st().litShare).toBeLessThanOrEqual(hi);
    }
    l.dispose();
  });

  it("a mover walks on through the doorway for at most 0.3 s, then is inside (review minor 2)", () => {
    const g = siteGeom(C7, frame);
    const mi = castMoveIn(C7, g);
    const mv = SET_PIECE_S.moveIn.movers;
    expect(MOVER_DOOR_S).toBeLessThanOrEqual(0.3);
    const path = mi.paths[0] as [number, number][];
    const arrive = mv.t0 + mv.walk;
    const at = moverAt(path, mv, 0, arrive + MOVER_DOOR_S / 2);
    expect(at?.entered).toBe(true);
    expect(at?.inside).toBe(false);
    if (at) {
      const d = Math.hypot(at.p[0] - g.door[0], at.p[1] - g.door[1]);
      expect(d).toBeGreaterThan(0.3);
      expect(d).toBeLessThanOrEqual(1.2);
      // on past the door: farther from the path's previous point than the door is
      const prev = path[path.length - 2] as [number, number];
      expect(Math.hypot(at.p[0] - prev[0], at.p[1] - prev[1])).toBeGreaterThan(
        Math.hypot(g.door[0] - prev[0], g.door[1] - prev[1]),
      );
    }
    expect(moverAt(path, mv, 0, arrive + MOVER_DOOR_S)?.inside).toBe(true);
  });

  it("no car shows before its window time (review minor 3)", () => {
    const g = siteGeom(C7, frame);
    const m = setPieceTiming(C7).moveIn;
    for (let k = 0; k < PARKED_CARS; k++) {
      const a = m.cars.t0 + k * m.cars.gap;
      expect(carAt(g, m, k, a - 0.01)).toBeNull();
      expect(carAt(g, m, k, a)).not.toBeNull();
      expect(carAt(g, m, k, a + CAR_AISLE_S + m.cars.drive)?.parked).toBe(true);
    }
    expect(m.cars.t0).toBe(30);
  });

  it("parked cars use the A4 variants, in the parcel lot", () => {
    const g = siteGeom(C7, frame);
    const part = createMoveIn({
      geom: g,
      timing: setPieceTiming(C7),
      roleUniforms: createRoleUniforms(),
    });
    const names = part.group.children.map((c) => c.name);
    for (const v of CAR_VARIANTS) expect(names).toContain(`devsim-move-in-${v}`);
    expect(names).toContain("devsim-move-in-boxes");
    expect(BOXES).toBeGreaterThanOrEqual(8);
    expect(PARKED_CARS).toBeGreaterThanOrEqual(6);
    const lot = yardRing(g);
    for (const st of carStalls(g)) expect(inRing(lot, st.p[0], st.p[1])).toBe(true);
    part.dispose();
  });

  it("the HUD counter reads the same lit share x homes, equal to the 45 s timeline's", () => {
    for (let t = 26; t <= 45; t += 0.25) {
      const s = stateAt(t, C7);
      expect(moveInCounter(C7, t).litShare).toBe(s.windowsLitFraction);
      expect(moveInCounter(C7, t).occupancy).toBe(s.occupancy);
    }
    const c = moveInCounter(C7, 33);
    expect(c.litShare).toBeGreaterThanOrEqual(0.85);
    expect(c.occupancy).toBe(Math.round(c.litShare * C7.site.homes));
    expect(moveInCounter(C7, 27).occupancy).toBe(0);
  });

  it("the bld hook carries the move-in counts", () => {
    const l = layerFor(C7);
    const off = registerDemoState("bld", () => l.demoState());
    const hook = createDemoHook();
    hook.set("bld");
    l.setT(33);
    const st = hook.state();
    for (const k of [
      "movingLorries",
      "boxes",
      "parkedCars",
      "movers",
      "kidsAtPlayground",
      "litShare",
      "occupancy",
    ])
      expect(st, k).toHaveProperty(k);
    off();
    l.dispose();
  });
});

describe("move-in on the legacy 66 s plan (plan.provisional.json)", () => {
  it("lit windows stay the timeline's (Q4: 0 before Handover); 12 mover slots and 5 children", () => {
    const tm = setPieceTiming(LEGACY);
    for (const t of [10, 31.9, 35, 40]) expect(litShareAt(tm, t, 30, 0.37)).toBe(0.37);
    const slots = castSlots(LEGACY);
    expect(slots.filter((s) => s.startsWith("mover"))).toHaveLength(12);
    expect(slots.filter((s) => s.startsWith("child"))).toHaveLength(5);
    // workers stay last (the worker renderer indexes from the first worker)
    expect(slots.at(-1)).toMatch(/^worker/);
    const l = layerFor(LEGACY);
    l.setT(42);
    const s = l.demoState() as unknown as St;
    expect(s.movers.entered).toBeGreaterThan(0);
    expect(s.parkedCars).toBeGreaterThanOrEqual(6);
    l.dispose();
  });
});

describe("dispose frees geometry (C9 review minor 3)", () => {
  const spyAll = (p: DevsimPart) => {
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    p.group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g) spies.push(vi.spyOn(g, "dispose"));
    });
    return spies;
  };
  it("rain, scaffold, piling rig and move-in dispose every geometry they draw", () => {
    const g = siteGeom(C7, frame);
    const parts: DevsimPart[] = [
      createRain(),
      createScaffold({ geom: g }),
      createPilingRig({ geom: g }),
      createMoveIn({ geom: g, timing: setPieceTiming(C7), roleUniforms: createRoleUniforms() }),
    ];
    for (const p of parts) {
      const spies = spyAll(p);
      expect(spies.length).toBeGreaterThan(0);
      p.dispose();
      for (const s of spies) expect(s).toHaveBeenCalled();
    }
  });
});
