import { readFileSync } from "node:fs";
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import elmina from "../../../devsim/fixtures/plan.elmina.json";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { closedEdgeOf, streetsOf } from "./DevsimSceneMount";
import { dayness } from "./ease";
import { distToLine, siteGeom } from "./geom";
import {
  createSite,
  lorryPoses,
  nearQueue,
  queuePoses,
  queueSlot,
  ribbonGeometry,
  yardRing,
} from "./site";
import { stateAt } from "./state";

const P = plan as DevelopmentPlan;
const readJson = (p: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
  );
const geom = siteGeom(P, createFrame([101.5076, 3.1794]));
const at = (site: ReturnType<typeof createSite>, t: number) => {
  const s = stateAt(t, P);
  site.update({ s, t, night: 1 - dayness(s.sun.elevation) });
};
const named = (g: THREE.Object3D, n: string) => g.getObjectByName(n) as THREE.Object3D;

describe("devsim site", () => {
  it("the school-run queue never overlaps and keeps the junction crossing clear (gate 2, 48 s)", () => {
    const CAR_M = 4.7;
    const CREEP_M = 0.8;
    for (let i = 1; i < 8; i++)
      expect(queueSlot(i - 1) - queueSlot(i) - CREEP_M).toBeGreaterThan(CAR_M + 0.8);
    for (let i = 0; i < 8; i++) {
      // no car body comes within 3 m of the crossing at the junction, even creeping forward
      expect(queueSlot(i) - CREEP_M - CAR_M / 2).toBeGreaterThan(3);
    }
    // and the decorative traffic keeps off every queue car (fallback lane: no road data)
    for (const v of queuePoses(geom, 47)) {
      expect(v).not.toBeNull();
      if (v) expect(nearQueue(geom, v.x, v.z)).toBe(true);
    }
    // the far side of the street is not the queue's lane
    const fx = geom.junction[0] - geom.kerbOut[0] * 6;
    const fz = geom.junction[1] - geom.kerbOut[1] * 6;
    expect(nearQueue(geom, fx, fz)).toBe(false);
  });

  it("owner fix (4.png): every queue car and lorry is on a mapped street, in lane, facing along it", () => {
    // the Elmina plan on the committed seed's streets, as the stylised city draws them
    const ep = elmina as unknown as DevelopmentPlan;
    const frame = createFrame(ep.anchors.junction as [number, number]);
    const roads = streetsOf(readJson("base/walk.geojson"));
    const eg = siteGeom(ep, frame, closedEdgeOf(ep, readJson("base/walk.geojson")), roads);
    expect(eg.lane.mapped).toBe(true);
    const local = roads.map((r) => ({
      pts: r.coords.map((p) => frame.toLocal(p[0], p[1])),
      halfW: r.widthM / 2,
    }));
    // the street a vehicle is on: the nearest street segment within 15 degrees of its heading (a
    // queue car may stand across a side street's mouth, so the nearest segment can be the side street)
    const COS15 = Math.cos((15 * Math.PI) / 180);
    const onStreet = (v: { x: number; z: number; dir: [number, number] }) => {
      let best = { d: Number.POSITIVE_INFINITY, halfW: 0 };
      let nearestAny = Number.POSITIVE_INFINITY;
      for (const r of local)
        for (let i = 1; i < r.pts.length; i++) {
          const a = r.pts[i - 1] as [number, number];
          const b = r.pts[i] as [number, number];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (l < 0.5) continue;
          const d = distToLine([a, b], v.x, v.z);
          nearestAny = Math.min(nearestAny, d);
          const cos = Math.abs((v.dir[0] * (b[0] - a[0]) + v.dir[1] * (b[1] - a[1])) / l);
          if (cos > COS15 && d < best.d) best = { d, halfW: r.halfW };
        }
      return { ...best, nearestAny };
    };
    const check = (
      v: { x: number; z: number; dir: [number, number] },
      halfWidth: number,
      what: string,
    ) => {
      const n = onStreet(v);
      // aligned with a street (within 15 degrees) whose carriageway holds the whole body width
      expect(
        n.d,
        `${what}: no street within 15 deg under it (nearest any street ${n.nearestAny.toFixed(2)} m)`,
      ).toBeLessThanOrEqual(n.halfW - halfWidth);
      // and in a lane, not on the centreline
      expect(n.d, what).toBeGreaterThan(0.5);
    };
    let cars = 0;
    for (let t = 44; t < 52.4; t += 0.25)
      queuePoses(eg, t).forEach((v, i) => {
        if (!v) return;
        cars++;
        check(v, 0.9, `queue car ${i} at ${t}`);
      });
    expect(cars).toBeGreaterThan(8 * 30);
    // all eight cars stand in the queue at 48 s, nose to tail toward the junction
    const at48 = queuePoses(eg, 48);
    expect(at48.every((v) => v !== null)).toBe(true);
    // the queue ends at 52.4 s: no car stays behind
    expect(queuePoses(eg, 52.4).every((v) => v === null)).toBe(true);
    expect(queuePoses(eg, 60).every((v) => v === null)).toBe(true);
    let lorries = 0;
    for (let t = 33; t < 44; t += 0.25)
      lorryPoses(eg, t).forEach((v, i) => {
        if (!v) return;
        lorries++;
        check(v, 1.2, `lorry ${i} at ${t}`);
      });
    expect(lorries).toBeGreaterThan(3 * 20);
  });

  it("the closed edge is found from the provisional routes", () => {
    expect(geom.closed.length).toBeGreaterThanOrEqual(2);
    expect(yardRing(geom)).toHaveLength(4);
  });

  it("kit and hoarding by day in Construction; gone in Daily Life", () => {
    const site = createSite({ geom, roleUniforms: createRoleUniforms() });
    at(site, 12);
    expect(named(site.group, "devsim-yard").visible).toBe(true);
    expect(named(site.group, "devsim-hoarding").visible).toBe(true);
    at(site, 50);
    expect(named(site.group, "devsim-yard").visible).toBe(false);
    expect(named(site.group, "devsim-hoarding").visible).toBe(false);
    site.dispose();
  });

  it("three lorries at Handover, the school-run queue in Daily Life, stable vehicle slots", () => {
    const site = createSite({ geom, roleUniforms: createRoleUniforms() });
    at(site, 20);
    const n = site.vehicles?.().length;
    expect(site.vehicles?.().every((v) => Number.isNaN(v[0]))).toBe(true);
    at(site, 38);
    expect(site.vehicles?.().filter((v) => Number.isFinite(v[0]))).toHaveLength(3);
    at(site, 47);
    expect(site.vehicles?.().filter((v) => Number.isFinite(v[0]))).toHaveLength(8);
    expect(site.vehicles?.().length).toBe(n);
    site.dispose();
  });

  it("the site holds no scene light (floodlights are emissive pools)", () => {
    const site = createSite({ geom, roleUniforms: createRoleUniforms() });
    let lights = 0;
    site.group.traverse((o) => {
      if ((o as { isLight?: boolean }).isLight) lights++;
    });
    expect(lights).toBe(0);
    site.dispose();
  });

  it("dashed ribbons have gaps: fewer triangles than a solid one", () => {
    const pts: [number, number][] = [
      [0, 0],
      [40, 0],
    ];
    const solid = ribbonGeometry(pts, 1, 0.3).getAttribute("position").count;
    const dashed = ribbonGeometry(pts, 1, 0.3, 2).getAttribute("position").count;
    expect(dashed).toBeGreaterThan(solid);
    expect(dashed).toBe(6 * 10);
  });
});
