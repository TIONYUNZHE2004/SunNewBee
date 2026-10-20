import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../lib/api";
import { HERO_CENTRE } from "../scene/three/bookmarks";
import { createClearance, obstaclesFromCity } from "../scene/three/clearance";
import { createFrame } from "../scene/three/frame";
import type { FollowScene } from "../scene/three/journey/followRig";
import { heroPositionAt } from "../scene/three/journey/heroDriver";
import {
  type CardPlacement,
  type CardViewport,
  cardViewportWith,
  type PlacementLock,
  placeCardLocked,
  type Rect,
} from "./cardPlacement";
import { cardGeometryAt, holdCardLock } from "./cardTrack";
import demoPlan from "./fixtures/demoPlan.json";
import { createRoutePath } from "./routePath";
import { MARKER_LIFT_M, MARKER_STACK_M } from "./three/journeyLayer";
import { createViewFit, safeRectOf } from "./three/viewFit";
import { buildTimeline, type JourneyPlan, stateAt } from "./timeline";

/**
 * Iteration 2 (owner's recording, ITER2-verify 12.7 s / 65.6 s / 75.3 s): the event card jumped
 * 150-190 px sideways in one frame when its spot switched sides of her mid-hold, which read as the
 * picture shaking. The demo trip on the seed city, sampled at 60 Hz through every hold as the
 * acceptance view frames it: the card moves smoothly, never covers her, stays inside the UI-safe
 * viewport, and is the same at a beat however the hold was reached (a pure function of t).
 */
const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame(HERO_CENTRE);
const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));
const tl = buildTimeline(plan);
const helpers = { pointAt: path.pointAt };
const SEED = new URL("../../../../../data/seed/elmina/base/buildings.geojson", import.meta.url);
const HZ = 60;
/** Largest card move between two 60 Hz frames of one hold (CSS px). */
const MAX_STEP_PX = 8;

const size: [number, number] = [920, 875];
const card = { w: 290, h: 180 };
// the acceptance view's map area at 1440 x 900: the top stack, and the mini-map at the top right
const viewport: CardViewport = {
  w: 920,
  h: 860,
  top: 235,
  avoid: [{ x: 700, y: 16, w: 204, h: 150 }],
};

function sceneOf(): FollowScene {
  const cam = new THREE.PerspectiveCamera(30, size[0] / size[1], 0.5, 30000);
  cam.updateProjectionMatrix();
  const markerOf = (i: number): [number, number, number] | null => {
    const e = plan.events[i];
    if (!e) return null;
    const [x, z] = path.pointAt(e.at_m);
    const stacked = plan.events.filter((f, j) => j < i && Math.abs(f.at_m - e.at_m) < 3).length;
    return [x, MARKER_LIFT_M + stacked * MARKER_STACK_M, z];
  };
  const layer = { buildings: JSON.parse(readFileSync(SEED, "utf8")) } as unknown as BuildingsLayer;
  return {
    timeline: tl,
    pointAt: path.pointAt,
    overview: { pos: [0, 5600, 5600], look: [0, 0, 0] },
    pullBackTo: { pos: [10, 600, 450], look: [10, 0, 0] },
    heroAt: (t) => heroPositionAt(tl, t, helpers),
    clearance: createClearance(obstaclesFromCity(layer, frame)),
    view: createViewFit(cam, size, safeRectOf(viewport)),
    markerOf,
  };
}

const sc = sceneOf();

const locks = new Map<number, PlacementLock | null>();
const lockOf = (idx: number) => {
  if (!locks.has(idx)) locks.set(idx, holdCardLock(sc, idx, "follow", card, viewport));
  return locks.get(idx) ?? null;
};

/** The card at trip time t, as EventCard places it (null outside a hold). */
function cardAt(t: number): {
  p: CardPlacement;
  hero: Rect | null;
  anchor: { x: number; y: number } | null;
  idx: number;
} | null {
  const st = stateAt(tl, t);
  if (st.phase.kind !== "event" || st.eventIndex === undefined) return null;
  const idx = st.eventIndex;
  const g = cardGeometryAt(sc, t, idx, "follow");
  if (!g) return null;
  const lock = lockOf(idx);
  const p = placeCardLocked(g.anchor, card, cardViewportWith(viewport, g.hero, g.anchor), lock);
  return { p, hero: g.hero, anchor: g.anchor, idx };
}

const overlap = (p: CardPlacement, r: Rect) => {
  const k = p.scale ?? 1;
  return (
    p.left < r.x + r.w && p.left + card.w * k > r.x && p.top < r.y + r.h && p.top + card.h * k > r.y
  );
};

describe("event card track over the demo trip (60 Hz)", () => {
  const n = Math.floor(tl.total * HZ);
  const samples = Array.from({ length: n + 1 }, (_, i) => ({ t: i / HZ, c: cardAt(i / HZ) }));

  it("moves at most MAX_STEP_PX more than the picture under it between two frames of a hold", () => {
    // the card rides with the marker and her: while the hold fit eases the camera in and out the
    // whole picture moves (up to ~20 px a frame); a jump is the card moving off that motion
    let worst = 0;
    let worstAt = 0;
    let most = 0;
    const jumps: string[] = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]?.c;
      const b = samples[i]?.c;
      if (!a || !b || a.idx !== b.idx) continue;
      // both corners: a size change counts as a move too
      const d = Math.max(
        Math.hypot(b.p.left - a.p.left, b.p.top - a.p.top),
        Math.hypot(
          b.p.left + card.w * (b.p.scale ?? 1) - a.p.left - card.w * (a.p.scale ?? 1),
          b.p.top + card.h * (b.p.scale ?? 1) - a.p.top - card.h * (a.p.scale ?? 1),
        ),
      );
      const da =
        a.anchor && b.anchor ? Math.hypot(b.anchor.x - a.anchor.x, b.anchor.y - a.anchor.y) : 0;
      const dh = a.hero && b.hero ? Math.hypot(b.hero.x - a.hero.x, b.hero.y - a.hero.y) : 0;
      const off = d - Math.max(da, dh);
      most = Math.max(most, d);
      if (off > MAX_STEP_PX) jumps.push(`${samples[i]?.t.toFixed(2)}s ${d.toFixed(0)}px`);
      if (off > worst) {
        worst = off;
        worstAt = samples[i]?.t ?? 0;
      }
    }
    expect(samples.filter((s) => s.c).length).toBeGreaterThan(HZ * 20);
    expect(
      jumps,
      `worst ${worst.toFixed(1)} px off the picture at t=${worstAt.toFixed(2)} s`,
    ).toEqual([]);
    // and never a sideways jump in absolute terms either (the camera's own fastest hold move)
    expect(most).toBeLessThan(30);
  });

  it("never covers her and stays inside the viewport, under the top band", () => {
    const bad: string[] = [];
    for (const { t, c } of samples) {
      if (!c) continue;
      const k = c.p.scale ?? 1;
      if (c.hero && overlap(c.p, c.hero)) bad.push(`hero@${t.toFixed(2)}`);
      if (
        c.p.left < 12 - 1e-6 ||
        c.p.left + card.w * k > viewport.w - 12 + 1e-6 ||
        c.p.top < (viewport.top ?? 0) + 12 - 1e-6 ||
        c.p.top + card.h * k > viewport.h - 12 + 1e-6
      )
        bad.push(`viewport@${t.toFixed(2)}`);
      for (const r of viewport.avoid ?? [])
        if (overlap(c.p, r)) bad.push(`minimap@${t.toFixed(2)}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("is a pure function of t: the same card at a beat in any visiting order", () => {
    const beats = tl.phases.filter((p) => p.kind === "event").map((p) => (p.t0 + p.t1) / 2 + 0.37);
    const fwd = beats.map((t) => cardAt(t)?.p);
    const back = [...beats].reverse().map((t) => cardAt(t)?.p);
    expect(fwd).toEqual(back.reverse());
  });
});
