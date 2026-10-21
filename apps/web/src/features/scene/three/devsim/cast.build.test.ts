import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { useDevsimAnchors } from "../../../devsim/anchors";
import elmina from "../../../devsim/fixtures/plan.elmina.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { CAST_S, castAt, castBeats, castMoveIn, createCast, isCrew, WORKERS } from "./cast";
import { createDevsimLayer } from "./devsimLayer";
import { DEVSIM_FOV_DEG, devsimCamera } from "./devsimView";
import { distToLine, inRing, siteGeom } from "./geom";
import { onStage } from "./project";
import { createTower } from "./tower";

/** The 45 s Elmina building plan (C7). */
const P = elmina as unknown as DevelopmentPlan;
const frame = createFrame(P.anchors.junction as [number, number]);
const g = siteGeom(P, frame);
const beats = castBeats(P);
const SIZE: [number, number] = [1440, 900];

afterEach(() => useDevsimAnchors.getState().clear());

const poses = (t: number, workersActive = false) =>
  castAt(t, g, { workersActive, moveIn: castMoveIn(P, g), beats });

describe("45 s cast (spec §6.3, C-align)", () => {
  it("the speaker windows are the plan's bubbles, the same as spec §6.3", () => {
    expect(beats).not.toBeNull();
    const b = beats as NonNullable<typeof beats>;
    expect(b.halim).toEqual(CAST_S.halim);
    expect(b.farid).toEqual(CAST_S.farid);
    expect(b.worker).toEqual(CAST_S.worker);
    expect(b.meiling).toEqual(CAST_S.meiling);
    expect(b.welcome).toEqual(CAST_S.welcome);
    expect(b.zainab).toEqual(CAST_S.zainab);
    expect(b.arjun).toEqual(CAST_S.arjun);
    expect(b.end).toBe(45);
  });

  it("every bubble's speaker is on stage through its whole window (AC-W8: none falls back to the stack)", () => {
    for (const bub of P.bubbles) {
      const who = bub.who;
      for (let t = bub.t0; t < bub.t1; t += 0.05)
        expect(poses(t).has(who), `${who} at ${t.toFixed(2)}`).toBe(true);
      expect(poses(bub.t0 + 0.05).has(who)).toBe(true);
    }
  });

  it("the site worker speaks the monsoon bubble at anchors.worker, outside the tower, in a hard hat", () => {
    const w = poses(21).get("worker");
    expect(w).toBeDefined();
    expect(w?.x).toBeCloseTo(g.worker[0], 6);
    expect(w?.z).toBeCloseTo(g.worker[1], 6);
    expect(inRing(g.ring, g.worker[0], g.worker[1])).toBe(false);
    expect(poses(17).has("worker")).toBe(false);
    expect(poses(24).has("worker")).toBe(false);
    // the crew are not the speaker
    expect(isCrew("worker")).toBe(false);
    expect(isCrew("worker3")).toBe(true);
    const l = createDevsimLayer({ plan: P, frame, anchors: false });
    l.add(createCast({ plan: P, geom: l.geom }));
    type St = { workers: number; castOn: string[] };
    l.setT(21);
    const st = l.demoState() as unknown as St;
    expect(st.castOn).toContain("worker");
    expect(st.workers).toBe(WORKERS); // the crew alone
    l.setT(12); // the Raya hold: the site is closed
    expect((l.demoState() as unknown as St).workers).toBe(0);
    expect((l.demoState() as unknown as St).castOn).not.toContain("worker");
    l.dispose();
  });

  it("Halim stands on the detour path through bubble 1, then at the door to welcome Mei Ling", () => {
    const h = (t: number) => poses(t).get("halim");
    for (const t of [5.5, 7, 8.9]) {
      const p = h(t);
      expect(p?.walk).toBe(false);
      expect(distToLine(g.halimPath, p?.x ?? 0, p?.z ?? 0)).toBeLessThan(0.5);
    }
    expect(h(4)?.walk).toBe(true);
    expect(h(12)).toBeUndefined();
    // the welcome: Halim near Mei Ling and facing her from 31 s
    const ml = poses(31.5).get("meiling");
    const hw = h(31.5);
    expect(ml && hw).toBeTruthy();
    expect(Math.hypot((ml?.x ?? 0) - (hw?.x ?? 0), (ml?.z ?? 0) - (hw?.z ?? 0))).toBeLessThan(4);
    expect(hw?.walk).toBe(false);
    expect(h(33.5)).toBeUndefined();
  });

  it("no legacy 66 s staging leaks in (no Halim at 20 s, no Farid at 25 s, no exit at 45 s)", () => {
    expect(poses(20).has("halim")).toBe(false);
    expect(poses(25).has("farid")).toBe(false);
    expect(poses(40).has("meiling")).toBe(false);
    expect(poses(40).has("zainab")).toBe(true);
    expect(poses(40).has("arjun")).toBe(true);
  });

  it("each bubble anchors to a drawn speaker whose head is on stage at the beat camera", () => {
    const l = createDevsimLayer({ plan: P, frame });
    const ru = createRoleUniforms();
    l.setTower(createTower({ geom: l.geom, roleUniforms: ru }));
    l.add(createCast({ plan: P, geom: l.geom }));
    const cam = new THREE.PerspectiveCamera(DEVSIM_FOV_DEG, SIZE[0] / SIZE[1], 1, 30000);
    for (const bub of P.bubbles) {
      // the start, middle and end of the bubble (AC-W8 samples at t0 + 0.05 and t1 - 0.05)
      for (const t of [bub.t0 + 0.05, (bub.t0 + bub.t1) / 2, bub.t1 - 0.05]) {
        l.setT(t);
        const s = l.state();
        if (!s) throw new Error("no state");
        // the bubble on at t is the speaker the overlay anchors (the first bubble on)
        const who = s.bubbles[0]?.who;
        const pose = devsimCamera(s, frame, l.geom, l.towerTopM(), null);
        cam.position.set(...pose.position);
        cam.lookAt(...pose.look);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();
        l.beforeRender(cam, SIZE, 0);
        const a = useDevsimAnchors.getState();
        const tag = `${who} at ${t.toFixed(2)}`;
        expect(a.speaker, tag).not.toBeNull();
        expect(onStage(a.speakerHead, SIZE), tag).toBe(true);
        expect(l.demoState().speaker, tag).toMatchObject({
          who,
          anchored: true,
          headOnStage: true,
        });
      }
    }
    l.dispose();
  });
});
