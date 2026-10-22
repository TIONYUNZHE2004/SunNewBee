import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { useDevsimAnchors } from "../../../devsim/anchors";
import elmina from "../../../devsim/fixtures/plan.elmina.json";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import { BUILD_CAM_KEYS } from "../../../devsim/timeline";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createFrame } from "../frame";
import {
  buildSubjectAt,
  buildSubjectBreaks,
  createDevsimLayer,
  type DevsimPart,
  labelFits,
  type TowerPart,
} from "./devsimLayer";
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

  it("publishes one anchor per speaker when two bubbles overlap (Zainab and Arjun at 36.5–37 s)", () => {
    const B = elmina as unknown as DevelopmentPlan;
    const l = createDevsimLayer({ plan: B, frame });
    const [cx, cz] = l.geom.centre;
    const at: Record<string, [number, number]> = {
      zainab: [cx - 20, cz],
      arjun: [cx + 20, cz],
      halim: [cx, cz + 25],
    };
    l.add({
      group: new THREE.Group(),
      update() {},
      personBox: (id) => (at[id] ? { x: at[id][0], z: at[id][1], h: 1.7 } : null),
      dispose() {},
    });
    l.setT(36.7);
    expect(l.state()?.bubbles.map((b) => b.who)).toEqual(["zainab", "arjun"]);
    l.beforeRender(cameraAt([cx, 60, cz + 120], [cx, 0, cz]), [1440, 900], 0);
    const a = useDevsimAnchors.getState();
    expect(a.speakers.map((s) => s.id)).toEqual(["zainab", "arjun"]);
    const [z, r] = a.speakers;
    expect(z?.rect).toEqual(a.speaker);
    // each rect is its own speaker's: Zainab left of Arjun on screen
    expect((z?.rect.x ?? 0) + (z?.rect.w ?? 0)).toBeLessThan(r?.rect.x ?? 0);
    // a speaker is not also a listener; Halim (not speaking) is
    expect(a.others.map((o) => o.id)).toEqual(["halim"]);
    l.dispose();
    expect(useDevsimAnchors.getState().speakers).toEqual([]);
  });
});

describe("buildSubject (45 s plan beat subjects)", () => {
  it("derives its beat breaks from BUILD_CAM_KEYS", () => {
    expect(buildSubjectBreaks()).toEqual([
      { t: 0, subject: "site" },
      { t: 3.4, subject: "halim" },
      { t: 10.4, subject: "tower" },
      { t: 13.6, subject: "farid" },
      { t: 17, subject: "tower" },
      { t: 28.2, subject: "door" },
      { t: 33, subject: "tower" },
    ]);
    expect(buildSubjectBreaks(BUILD_CAM_KEYS)).toEqual(buildSubjectBreaks());
  });

  it("moves with the camera keys", () => {
    const moved = BUILD_CAM_KEYS.map((k) => (k.t === 13.6 ? { ...k, t: 14.2 } : k));
    const br = buildSubjectBreaks(moved);
    expect(buildSubjectAt(13.9, br)).toBe("tower");
    expect(buildSubjectAt(14.2, br)).toBe("farid");
    expect(buildSubjectAt(3.39)).toBe("site");
    expect(buildSubjectAt(3.4)).toBe("halim");
    expect(buildSubjectAt(32.99)).toBe("door");
    expect(buildSubjectAt(45)).toBe("tower");
  });
});
