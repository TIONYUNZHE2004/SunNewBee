import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { dayness } from "./ease";
import { siteGeom } from "./geom";
import { createSite, nearQueue, queueSlot, ribbonGeometry, yardRing } from "./site";
import { stateAt } from "./state";

const P = plan as DevelopmentPlan;
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
      const d = queueSlot(i);
      // no car body within 3 m of the crossing at the junction, even creeping forward
      expect(d - CAR_M / 2 > 3 || d + CREEP_M + CAR_M / 2 < -3).toBe(true);
      // and the decorative traffic keeps off every queue slot
      const x = geom.junction[0] + geom.street[0] * d + geom.kerbOut[0] * 4.5;
      const z = geom.junction[1] + geom.street[1] * d + geom.kerbOut[1] * 4.5;
      expect(nearQueue(geom, x, z)).toBe(true);
    }
    // the far side of the street is not the queue's lane
    const fx = geom.junction[0] - geom.kerbOut[0] * 6;
    const fz = geom.junction[1] - geom.kerbOut[1] * 6;
    expect(nearQueue(geom, fx, fz)).toBe(false);
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
