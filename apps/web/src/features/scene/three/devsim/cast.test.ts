import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createFrame } from "../frame";
import {
  castAt,
  castSlots,
  createCast,
  HALIM_STAND_U,
  MOVERS,
  tagTextColour,
  WORKERS,
} from "./cast";
import { along, distToLine, lengthOf, siteGeom } from "./geom";
import { KIDS } from "./moveIn";
import { stateAt } from "./state";

const P = plan as DevelopmentPlan;
const g = siteGeom(P, createFrame([101.5076, 3.1794]));
const at = (t: number) => castAt(t, g, { workersActive: stateAt(t, P).workersActive });

describe("devsim cast script", () => {
  it("Halim walks the detour path in Construction, and stands still while he talks", () => {
    const halim = (t: number) => {
      const p = at(t).get("halim");
      if (!p) throw new Error(`no Halim at ${t}`);
      return p;
    };
    const a = halim(17);
    const b = halim(22.6);
    expect(distToLine(g.halimPath, a.x, a.z)).toBeLessThan(0.5);
    expect(distToLine(g.halimPath, b.x, b.z)).toBeLessThan(0.5);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(10);
    expect(halim(17).walk).toBe(true);
    expect(halim(19).walk).toBe(false);
    expect(halim(22).walk).toBe(true);
    // he stands where the old walk had him at 19 s (the gate-checked frame)
    const stand = along(g.halimPath, lengthOf(g.halimPath) * HALIM_STAND_U).p;
    expect(Math.hypot(halim(20).x - stand[0], halim(20).z - stand[1])).toBeLessThan(0.01);
  });

  it("owner fix: every speaker stands still for their whole bubble (all 7)", () => {
    expect(P.bubbles).toHaveLength(7);
    for (const b of P.bubbles) {
      const first = at(b.t0).get(b.who);
      if (!first) throw new Error(`bubble ${b.n}: ${b.who} not drawn`);
      for (let t = b.t0; t < b.t1; t += 0.05) {
        const p = at(t).get(b.who);
        if (!p) throw new Error(`bubble ${b.n}: ${b.who} not drawn at ${t}`);
        expect(Math.hypot(p.x - first.x, p.z - first.z), `bubble ${b.n} at ${t}`).toBeLessThan(
          1e-6,
        );
        expect(p.walk, `bubble ${b.n} at ${t}`).toBe(false);
      }
    }
  });

  it("Farid stands by the hoarding (24 s); movers queue on the path (37 s)", () => {
    expect(at(24).get("farid")).toMatchObject({ x: g.farid[0], z: g.farid[1], walk: false });
    const movers = [...at(37).keys()].filter((k) => k.startsWith("mover"));
    expect(movers.length).toBeGreaterThan(3);
  });

  it("Halim and Mei Ling face each other at the door (41 s)", () => {
    const s = at(41);
    const h = s.get("halim")!;
    const m = s.get("meiling")!;
    const yawTo = (a: typeof h, b: typeof h) => Math.atan2(b.x - a.x, b.z - a.z);
    expect(h.yaw).toBeCloseTo(yawTo(h, m), 5);
    expect(m.yaw).toBeCloseTo(yawTo(m, h), 5);
    expect(Math.hypot(h.x - g.door[0], h.z - g.door[1])).toBeLessThan(15);
  });

  it("residents leave (45 s); Mei Ling at the queue (48 s); Zainab at the park; Arjun at the mall", () => {
    expect([...at(45).keys()].filter((k) => k.startsWith("mover")).length).toBeGreaterThan(0);
    expect(at(48).get("meiling")).toBeTruthy();
    expect(at(54).get("zainab")).toMatchObject({ x: g.park[0], z: g.park[1] });
    expect(at(60).get("arjun")).toMatchObject({ x: g.mall[0], z: g.mall[1] });
  });

  it("workers by day only", () => {
    let day = 0;
    let night = 0;
    for (let t = 4; t < 31; t += 0.25) {
      const s = stateAt(t, P);
      const n = [...castAt(t, g, { workersActive: s.workersActive }).keys()].filter((k) =>
        k.startsWith("worker"),
      ).length;
      if (s.sun.isNight) night += n;
      else day += n;
    }
    expect(night).toBe(0);
    expect(day).toBeGreaterThan(0);
  });

  it("slots are fixed: cast, kid, movers, children, workers", () => {
    const s = castSlots(P);
    expect(s).toHaveLength(P.cast.length + 1 + MOVERS + KIDS + WORKERS);
    const c = createCast({ plan: P, geom: g });
    c.update({ s: stateAt(19, P), t: 19, night: 0 });
    const n1 = c.people?.().length;
    c.update({ s: stateAt(54, P), t: 54, night: 0 });
    expect(c.people?.().length).toBe(n1);
    expect(c.personBox?.("zainab")).toMatchObject({ x: g.park[0], z: g.park[1] });
    c.dispose();
  });

  it("name tag text picks the higher-contrast colour", () => {
    expect(tagTextColour("#5c6bc0")).toBe("#ffffff");
    expect(tagTextColour("#f4f1ea")).toBe("#1b1b1b");
  });

  it("no hat or vest floats alone while the crowd kit is not loaded", () => {
    const c = createCast({ plan: P, geom: g });
    let t = 4;
    while (!stateAt(t, P).workersActive) t += 0.25;
    c.update({ s: stateAt(t, P), t, night: 0 });
    const hats = c.group.getObjectByName("devsim-worker-hats") as import("three").InstancedMesh;
    expect(hats.count).toBe(0);
    c.dispose();
  });
});
