import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { useDevsimAnchors } from "../../../devsim/anchors";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createFrame } from "../frame";
import { createDevsimLayer, type DevsimPart, labelFits, type TowerPart } from "./devsimLayer";
import { stateAt } from "./state";

const P = plan as unknown as DevelopmentPlan;
const frame = createFrame([P.site.footprint[0]?.[0] as number, P.site.footprint[0]?.[1] as number]);

function cameraAt(pos: [number, number, number], look: [number, number, number]) {
  const c = new THREE.PerspectiveCamera(40, 1440 / 900, 2, 30000);
  c.position.set(...pos);
  c.lookAt(...look);
  c.updateMatrixWorld();
  return c;
}

function fakeTower(top: number): TowerPart {
  return {
    group: new THREE.Group(),
    update() {},
    topM: () => top,
    litFraction: () => 0,
    dispose() {},
  };
}

afterEach(() => useDevsimAnchors.getState().clear());

describe("createDevsimLayer", () => {
  it("setT reads the timeline once and poses every part with it", () => {
    const l = createDevsimLayer({ plan: P, frame });
    const seen: number[] = [];
    const part: DevsimPart = {
      group: new THREE.Group(),
      update: (f) => seen.push(f.t),
      dispose() {},
    };
    l.add(part);
    l.setT(12.5);
    expect(seen).toEqual([12.5]);
    expect(l.state()).toEqual(stateAt(12.5, P));
    expect(l.group.children).toContain(part.group);
    l.dispose();
  });

  it("projects the tower rect and top into the anchors and the probe; dispose clears them", () => {
    const l = createDevsimLayer({ plan: P, frame });
    l.setTower(fakeTower(60));
    l.setT(20);
    const [cx, cz] = l.geom.centre;
    l.beforeRender(cameraAt([cx - 150, 120, cz + 200], [cx, 30, cz]), [1440, 900], 0);
    const a = useDevsimAnchors.getState();
    expect(a.tower).not.toBeNull();
    expect(a.towerTop).not.toBeNull();
    expect(a.labelPoint).toEqual(a.towerTop);
    const pr = l.probe();
    expect(pr.rects?.tower).toEqual(a.tower);
    expect(pr.cameraInsideBuilding).toBe(false);
    l.dispose();
    expect(useDevsimAnchors.getState().tower).toBeNull();
  });

  it("a camera inside the tower volume is reported (Q2 probe)", () => {
    const l = createDevsimLayer({ plan: P, frame });
    l.setTower(fakeTower(90));
    l.setT(30);
    const [cx, cz] = l.geom.centre;
    l.beforeRender(cameraAt([cx, 40, cz], [cx + 50, 40, cz]), [1440, 900], 0);
    expect(l.probe().cameraInsideBuilding).toBe(true);
    l.dispose();
  });

  it("probe people keep one entry per agent in a stable order, hidden ones at [-1, -1]", () => {
    let pts: [number, number, number][] = [
      [0, 0, 0],
      [Number.NaN, 0, 0],
      [5, 0, 5],
    ];
    const l = createDevsimLayer({
      plan: P,
      frame,
      flowSamples: () => ({ people: pts, vehicles: [] }),
    });
    l.setT(12);
    const cam = cameraAt([0, 80, 120], [0, 0, 0]);
    l.beforeRender(cam, [1440, 900], 0);
    const first = l.probe().people ?? [];
    expect(first).toHaveLength(3);
    expect(first[1]).toEqual([-1, -1]);
    pts = [
      [1, 0, 0],
      [Number.NaN, 0, 0],
      [6, 0, 5],
    ];
    l.beforeRender(cam, [1440, 900], 0);
    const second = l.probe().people ?? [];
    expect(second).toHaveLength(3);
    expect(second[0]?.[0]).toBeGreaterThan(first[0]?.[0] as number);
    l.dispose();
  });

  it("gives the probe a subject point for the current beat", () => {
    const l = createDevsimLayer({ plan: P, frame });
    l.setTower(fakeTower(60));
    l.setT(12);
    const [cx, cz] = l.geom.centre;
    l.beforeRender(cameraAt([cx - 150, 120, cz + 200], [cx, 30, cz]), [1440, 900], 0);
    const s = l.probe().subject;
    expect(s).toBeDefined();
    expect(s?.x).toBeGreaterThan(0);
    expect(s?.x).toBeLessThan(1440);
    l.dispose();
  });

  it("the label anchor is given only where the whole label fits on the stage (AC-H3)", () => {
    const size: [number, number] = [920, 830];
    expect(labelFits([460, 400], size)).toBe(true);
    expect(labelFits([460, 20], size)).toBe(false); // would hang above the top edge
    expect(labelFits([60, 400], size)).toBe(false); // half off the left
    expect(labelFits([900, 400], size)).toBe(false);
    expect(labelFits(null, size)).toBe(false);
  });

  it("the probe is computed on demand from the last rendered view", () => {
    const l = createDevsimLayer({ plan: P, frame });
    l.setTower(fakeTower(60));
    l.setT(20);
    expect(l.probe()).toEqual({});
    const [cx, cz] = l.geom.centre;
    l.beforeRender(cameraAt([cx - 150, 120, cz + 200], [cx, 30, cz]), [1440, 900], 0);
    const a = l.probe();
    expect(a.rects?.tower).toBeDefined();
    expect(l.probe()).toEqual(a);
    l.dispose();
  });
});
