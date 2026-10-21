import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoHook, registerDemoState, resetDemoRegistry } from "../../../demo/demoHook";
import { useDevsimAnchors } from "../../../devsim/anchors";
import elmina from "../../../devsim/fixtures/plan.elmina.json";
import provisional from "../../../devsim/fixtures/plan.provisional.json";
import { planPlayback } from "../../../devsim/schedulePlayback";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { LIGHT_PRESETS } from "../lighting";
import { createDevsimLayer, type DevsimPart } from "./devsimLayer";
import { devsimGrade, rainGrade } from "./devsimView";
import { distToLine, lengthOf, siteGeom, TOWER_STOREY_M } from "./geom";
import { createPilingRig, pileGrid, rigAt } from "./pilingRig";
import { createRain, RAIN_DROPS } from "./rain";
import { createScaffold, scaffoldExtent } from "./scaffold";
import {
  craneAt,
  planExtras,
  rainAt,
  SET_PIECE_S,
  setPiecesAt,
  setPieceTiming,
  wetBeatAt,
  wetBeats,
} from "./setPieces";
import { createSite, moveInRoutePoses, routeTrafficPoses } from "./site";
import { stateAt } from "./state";
import { createTower } from "./tower";

/** The 45 s Elmina building plan (C7), and the legacy 66 s plan (no schedule, no lorry route). */
const C7 = elmina as unknown as DevelopmentPlan;
const LEGACY = provisional as unknown as DevelopmentPlan;
const frame = createFrame(C7.anchors.junction as [number, number]);
const geom = siteGeom(C7, frame);
const DEG = Math.PI / 180;
/** A part's demo-hook fields. */
const demo = (p: DevsimPart): object => (p.demoState as () => object)();

const frameAt = (plan: DevelopmentPlan, t: number) => {
  const s = stateAt(t, plan);
  return { s, t, night: 0, sp: setPiecesAt(plan, t, s) };
};

afterEach(() => {
  useDevsimAnchors.getState().clear();
  resetDemoRegistry();
});

describe("set piece timing (adapter)", () => {
  it("reads the C7 fields in one place; the legacy plan has neither", () => {
    expect(planExtras(LEGACY)).toEqual({
      lorryRoute: null,
      schedule: null,
      playground: LEGACY.anchors.park,
    });
    const x = planExtras(C7);
    expect(x.lorryRoute?.path.length).toBe(C7.lorry_route.path.length);
    expect(x.schedule?.months_total).toBe(27);
    // the 45 s plan sends no playground: the children use the park anchor (C-align ruling)
    expect(x.playground).toEqual(C7.anchors.park);
  });

  it("schedule mode: the windows are the plan's own (planPlayback: Raya 11-13 s, monsoon 18.5-23 s)", () => {
    const tm = setPieceTiming(C7);
    expect(tm.mode).toBe("schedule");
    const pb = planPlayback(C7);
    expect(tm.raya).toEqual(pb.raya);
    expect(tm.monsoon).toEqual(pb.monsoon);
    const banner = (k: string) => C7.banners.find((b) => b.kind === k);
    expect(tm.raya).toEqual([banner("raya")?.t0, banner("raya")?.t1]);
    expect(tm.monsoon).toEqual([banner("monsoon")?.t0, banner("monsoon")?.t1]);
    expect(tm.raya).toEqual([11, 13]);
    expect(tm.monsoon).toEqual([18.5, 23]);
    expect(tm.total).toBe(45);
    expect(tm.piling).toEqual([3.5, 8.5]);
    expect(tm.lorryRoute).toEqual([8.5, 27]);
    // wet beats: every other 1.5 s inside the monsoon window
    expect(wetBeats(tm)).toEqual([[20, 21.5]]);
    expect(wetBeatAt(tm, 21)).toBe(true);
    expect(wetBeatAt(tm, 19)).toBe(false);
    expect(wetBeatAt(tm, 22)).toBe(false);
  });

  it("legacy mode (66 s plan): no hold, no rain, no lorry route", () => {
    const tm = setPieceTiming(LEGACY);
    expect(tm.mode).toBe("legacy");
    expect(tm.raya).toBeNull();
    expect(tm.monsoon).toBeNull();
    expect(tm.lorryRoute).toBeNull();
    for (let t = 0; t < LEGACY.total_s; t += 0.5) {
      expect(rainAt(tm, t)).toBe(0);
      const s = stateAt(t, LEGACY);
      // the crane is exactly today's
      expect(craneAt(LEGACY, t, s).yaw).toBe(s.crane.slewRad);
    }
  });
});

describe("crane holds (AC-W3)", () => {
  const yawAt = (t: number) => craneAt(C7, t, stateAt(t, C7)).yaw;

  it("Raya hold: the jib yaw changes by < 0.5 deg over any 1 s inside 11-13 s", () => {
    for (let a = 11; a <= 12; a += 0.1)
      expect(Math.abs(yawAt(a + 1) - yawAt(a))).toBeLessThan(0.5 * DEG);
    expect(craneAt(C7, 12, stateAt(12, C7)).stopped).toBe(true);
  });

  it("monsoon: the crane stands still on the wet beat (20-21.5 s)", () => {
    for (let a = 20; a <= 21.5; a += 0.1) expect(Math.abs(yawAt(a) - yawAt(20))).toBeLessThan(1e-9);
    expect(craneAt(C7, 21, stateAt(21, C7)).stopped).toBe(true);
  });

  it("the crane does slew in work hours outside the stops", () => {
    let moved = 0;
    for (let t = 3; t < 27; t += 0.5) {
      const sp = setPiecesAt(C7, t, stateAt(t, C7));
      if (sp.hold || sp.wetBeat) continue;
      if (Math.abs(yawAt(t + 0.25) - yawAt(t)) > 0.5 * DEG) moved++;
    }
    expect(moved).toBeGreaterThan(5);
  });

  it("the site part parks the hook in the hold and exposes the yaw", () => {
    const site = createSite({ geom, roleUniforms: createRoleUniforms() });
    site.update(frameAt(C7, 12));
    const st = demo(site) as { crane: { yaw: number; hookParked: boolean; hold: boolean } };
    expect(st.crane.hold).toBe(true);
    expect(st.crane.hookParked).toBe(true);
    expect(st.crane.yaw).toBeCloseTo(yawAt(12), 9);
    site.update(frameAt(C7, 9));
    expect((demo(site) as { crane: { hookParked: boolean } }).crane.hookParked).toBe(false);
    site.dispose();
  });
});

describe("rain (AC-W3, R25)", () => {
  it("on through the monsoon window, never in the Raya hold, off elsewhere", () => {
    const tm = setPieceTiming(C7);
    expect(rainAt(tm, 21)).toBe(1);
    expect(rainAt(tm, 12)).toBe(0);
    expect(rainAt(tm, 17)).toBe(0);
    expect(rainAt(tm, 24)).toBe(0);
    for (let t = 11; t < 13; t += 0.05) expect(rainAt(tm, t)).toBe(0);
  });

  it("the rain part: at most 3,000 drops, one draw, not drawn when off", () => {
    expect(RAIN_DROPS).toBeLessThanOrEqual(3000);
    const r = createRain();
    let draws = 0;
    r.group.traverse((o) => {
      if ((o as THREE.LineSegments).isLineSegments || (o as THREE.Mesh).isMesh) draws++;
    });
    expect(draws).toBe(1);
    r.update(frameAt(C7, 12));
    expect(r.level()).toBe(0);
    expect(r.group.children.every((c) => !c.visible)).toBe(true);
    r.update(frameAt(C7, 21));
    expect(r.level()).toBe(1);
    expect((demo(r) as { rain: boolean }).rain).toBe(true);
    const cam = new THREE.PerspectiveCamera(40, 1.6, 1, 5000);
    cam.position.set(geom.centre[0] + 120, 60, geom.centre[1] + 120);
    cam.lookAt(geom.centre[0], 0, geom.centre[1]);
    cam.updateMatrixWorld();
    r.project?.(cam, [1440, 900]);
    r.dispose();
  });

  it("the mood greys toward the rain without a cost when dry", () => {
    const w = { day: 1, dusk: 0, night: 0 };
    expect(devsimGrade(LIGHT_PRESETS.day, w, 0)).toEqual(devsimGrade(LIGHT_PRESETS.day, w));
    const wet = rainGrade(LIGHT_PRESETS.day, 1);
    const sat = (hex: string) => {
      const o = { h: 0, s: 0, l: 0 };
      new THREE.Color(hex).getHSL(o);
      return o;
    };
    expect(sat(wet.fog.color).s).toBeLessThan(sat(LIGHT_PRESETS.day.fog.color).s);
    expect(sat(wet.background).s).toBeLessThan(sat(LIGHT_PRESETS.day.background).s + 1e-9);
    // night stays night: the grey keeps the preset's own lightness (only a little darker)
    const n = rainGrade(LIGHT_PRESETS.night, 1);
    expect(sat(n.background).l).toBeLessThanOrEqual(sat(LIGHT_PRESETS.night.background).l + 1e-6);
  });
});

describe("lorries on the lorry route (AC-W4)", () => {
  const route = geom.lorryRoute;

  it("the route is the plan's polyline in local metres", () => {
    expect(route.length).toBe(C7.lorry_route.path.length);
    expect(Math.abs(lengthOf(route) - C7.lorry_route.distance_m)).toBeLessThan(15);
  });

  it("construction traffic and move-in lorries stay within 3 m of the route", () => {
    for (let t = 8.5; t < 27; t += 0.1)
      for (const v of routeTrafficPoses(route, t, 8.5))
        if (v) expect(distToLine(route, v.x, v.z)).toBeLessThanOrEqual(3);
    for (let t = 27; t < 33; t += 0.1)
      for (const v of moveInRoutePoses(route, t, SET_PIECE_S.moveIn))
        if (v) expect(distToLine(route, v.x, v.z)).toBeLessThanOrEqual(3);
  });

  it("the site draws them on the route, hides them in the Raya hold, draws the ribbon 8.5-27 s", () => {
    const site = createSite({ geom, roleUniforms: createRoleUniforms() });
    type St = { lorries: { distToRoute: number | null }[]; lorryRoute: { drawn: boolean } };
    const st = () => demo(site) as St;
    let seen = 0;
    for (let t = 8.6; t < 27; t += 0.25) {
      site.update(frameAt(C7, t));
      const s = st();
      expect(s.lorryRoute.drawn).toBe(true);
      if (t >= 11 && t < 13) expect(s.lorries).toHaveLength(0);
      for (const v of s.lorries) {
        expect(v.distToRoute).not.toBeNull();
        expect(v.distToRoute as number).toBeLessThanOrEqual(3);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(20);
    site.update(frameAt(C7, 8));
    expect(st().lorryRoute.drawn).toBe(false);
    site.update(frameAt(C7, 30));
    expect(st().lorryRoute.drawn).toBe(false);
    site.dispose();
  });

  it("the legacy 66 s plan keeps the lane lorries and draws no route", () => {
    const g = siteGeom(LEGACY, frame);
    expect(g.lorryRoute).toEqual([]);
    const site = createSite({ geom: g, roleUniforms: createRoleUniforms() });
    site.update(frameAt(LEGACY, 38));
    const s = demo(site) as { lorries: unknown[]; lorryRoute: { drawn: boolean } };
    expect(s.lorryRoute.drawn).toBe(false);
    expect(s.lorries.length).toBeGreaterThan(0);
    site.dispose();
  });
});

describe("site kit on the 45 s plan (spec §6.3 27-30.5 s: hoarding, crane and scaffold go)", () => {
  it("the crane and yard sink at 27 s, the hoarding by 28 s; no school-run queue", () => {
    const site = createSite({ geom, roleUniforms: createRoleUniforms() });
    const byName = (n: string) => site.group.getObjectByName(n) as THREE.Object3D;
    site.update(frameAt(C7, 26.9));
    expect(byName("devsim-crane").position.y).toBe(-0);
    expect(byName("devsim-yard").visible).toBe(true);
    expect(byName("devsim-hoarding").visible).toBe(true);
    site.update(frameAt(C7, 27.9));
    expect(byName("devsim-yard").visible).toBe(false);
    expect(byName("devsim-crane").position.y).toBeLessThan(-40);
    site.update(frameAt(C7, 28.1));
    expect(byName("devsim-hoarding").visible).toBe(false);
    // the 66 s school-run queue (44-52 s) never shows on the 45 s plan
    for (let t = 33; t <= 45; t += 0.5) {
      site.update(frameAt(C7, t));
      expect(site.vehicles?.().filter((v) => Number.isFinite(v[0])).length ?? 0).toBe(
        (demo(site) as { lorries: unknown[] }).lorries.length,
      );
    }
    site.dispose();
  });
});

describe("scaffold and netting (AC-W4)", () => {
  it("scaffold top = top built floor + 1 floor; it starts on the podium (lobby) top", () => {
    for (const fb of [0.2, 1, 7.4, 15, 29.2, 30]) {
      const e = scaffoldExtent(fb, 30);
      expect(e.topFloor).toBe(Math.ceil(fb));
      expect(Math.abs(e.top - (Math.ceil(fb) + 1) * TOWER_STOREY_M)).toBeLessThanOrEqual(0.5);
      expect(e.base).toBe(TOWER_STOREY_M);
    }
  });

  it("rises with the tower's floors, netting while floors < total, gone at Handover", () => {
    const sc = createScaffold({ geom });
    const tw = createTower({ geom, roleUniforms: createRoleUniforms() });
    let rising = 0;
    let toppedOut = 0;
    for (let t = 4; t < C7.total_s; t += 0.5) {
      const f = frameAt(C7, t);
      sc.update(f);
      tw.update(f);
      const st = demo(sc) as { scaffoldTop: number; topFloor: number; netting: boolean };
      // schedule mode: up until Handover starts (27 s), whatever the act is called
      const building = t < SET_PIECE_S.moveIn.t0;
      if (building && tw.floorsShown() > 0 && f.s.floorsBuilt < geom.storeys) {
        expect(st.netting).toBe(true);
        expect(st.topFloor).toBe(tw.floorsShown());
        expect(
          Math.abs(st.scaffoldTop - (tw.floorsShown() + 1) * TOWER_STOREY_M),
        ).toBeLessThanOrEqual(0.5);
        rising++;
      }
      // topped out: the netting comes off, the scaffold stays until Handover
      if (building && f.s.floorsBuilt >= geom.storeys) {
        expect(st.netting).toBe(false);
        expect(sc.group.visible).toBe(true);
        expect(sc.group.getObjectByName("devsim-netting")?.visible).toBe(false);
        toppedOut++;
      }
      if (!building) {
        expect(st.netting).toBe(false);
        expect(sc.group.visible).toBe(false);
      }
    }
    expect(rising).toBeGreaterThan(10);
    expect(toppedOut).toBeGreaterThan(3);
    sc.dispose();
    tw.dispose();
  });
});

describe("piling rig (AC-W4)", () => {
  it("visits the footprint grid; visible 3.5-8.5 s only", () => {
    const piles = pileGrid(geom);
    expect(piles.length).toBeGreaterThan(3);
    const rig = createPilingRig({ geom });
    const vis = (t: number) => {
      rig.update(frameAt(C7, t));
      return (demo(rig) as { rig: { visible: boolean } }).rig.visible;
    };
    expect(vis(3.4)).toBe(false);
    expect(vis(3.6)).toBe(true);
    expect(vis(6)).toBe(true);
    expect(vis(8.4)).toBe(true);
    expect(vis(8.6)).toBe(false);
    // the mast ends on each pile
    expect(rigAt(piles, 1).p).toEqual(piles[piles.length - 1]);
    expect(rigAt(piles, 0).p).toEqual(piles[0]);
    rig.dispose();
  });

  it("legacy plan: the rig stands at the start of Construction", () => {
    const g = siteGeom(LEGACY, frame);
    const rig = createPilingRig({ geom: g });
    rig.update(frameAt(LEGACY, SET_PIECE_S.legacyPiling[0] + 0.5));
    expect((demo(rig) as { rig: { visible: boolean } }).rig.visible).toBe(true);
    rig.update(frameAt(LEGACY, 20));
    expect((demo(rig) as { rig: { visible: boolean } }).rig.visible).toBe(false);
    rig.dispose();
  });
});

describe("demo hook (bld state)", () => {
  it("the layer merges every part's fields into window.__tl.demo state()", () => {
    const l = createDevsimLayer({ plan: C7, frame, anchors: false });
    l.setTower(createTower({ geom: l.geom, roleUniforms: createRoleUniforms() }));
    l.add(createSite({ geom: l.geom, roleUniforms: createRoleUniforms() }));
    l.add(createScaffold({ geom: l.geom }));
    l.add(createPilingRig({ geom: l.geom }));
    l.add(createRain());
    const off = registerDemoState("bld", () => l.demoState());
    const hook = createDemoHook();
    hook.set("bld");
    l.setT(21);
    const st = hook.state() as Record<string, unknown>;
    for (const k of ["crane", "rain", "rig", "lorries", "scaffoldTop", "topFloor", "netting"])
      expect(st, k).toHaveProperty(k);
    expect(st.rain).toBe(true);
    expect((st.crane as { wetBeat: boolean; stopped: boolean }).wetBeat).toBe(true);
    expect((st.crane as { stopped: boolean }).stopped).toBe(true);
    l.setT(12);
    expect(hook.state().rain).toBe(false);
    expect((hook.state().crane as { hold: boolean }).hold).toBe(true);
    off();
    l.dispose();
  });
});
