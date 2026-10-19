import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CrowdManifest, parseCrowdManifest } from "../assets/crowdManifest";
import { type Agent, easedDistance, peopleScale } from "./agents";
import {
  advanceGait,
  framePair,
  type GaitState,
  gaitCyclesPerSecond,
  gaitPlaybackRate,
  IDLE_BELOW_MPS,
  seedPhase,
} from "./crowdGait";

const m = parseCrowdManifest(
  JSON.parse(
    readFileSync(
      new URL("../../../../../public/city/characters/crowd.json", import.meta.url),
      "utf8",
    ),
  ),
).manifest as CrowdManifest;

const person = (id: string, speed: number): Agent => ({
  id,
  kind: "person",
  variant: "v",
  path: new Float32Array([0, 0, 500, 0]),
  length: 500,
  speed,
  offset: 0,
});

describe("P5 gait timing maths", () => {
  it("cycle rate = speed / (stride x display scale); playback = cycles x duration", () => {
    expect(gaitCyclesPerSecond(1.2, 0.6, 1)).toBeCloseTo(2, 9);
    expect(gaitCyclesPerSecond(1.2, 0.6, 2)).toBeCloseTo(1, 9);
    expect(gaitPlaybackRate(1.2, { stride: 0.6, duration: 1.1 }, 1)).toBeCloseTo(2.2, 9);
    // No stride (idle) or no scale: no cycling.
    expect(gaitCyclesPerSecond(1.2, 0, 1)).toBe(0);
    expect(gaitCyclesPerSecond(1.2, 0.6, 0)).toBe(0);
  });

  it("every walk clip of every look: integrated cycle rate x stride x scale matches the eased speed within 10 %", () => {
    for (const look of m.looks) {
      const clip = m.bodies[look.body].clips[look.clips.walk];
      const idle = m.bodies[look.body].clips[look.clips.idle];
      if (!clip || !idle) throw new Error(look.id);
      expect(clip.stride, look.id).toBeGreaterThan(0);
      const a = person(`p:${look.id}`, 1.2 + 0.3 * ((look.id.length % 7) / 7));
      const st: GaitState = { phase: seedPhase(a.id), dist: easedDistance(a, 0), idle: false };
      const dt = 1 / 60;
      // Camera moves so the display scale changes during the run (the R-J7 people curve, P6).
      let cycles = 0;
      for (let i = 1; i <= 600; i++) {
        const t = i * dt;
        const k = peopleScale(100 + i); // 101..700 m
        const before = st.phase;
        const dist = easedDistance(a, t);
        const speed = (dist - st.dist) / dt;
        advanceGait(st, dist, dt, k, clip, idle);
        const dPhase = (((st.phase - before) % 1) + 1) % 1;
        cycles += dPhase;
        // Instantaneous: feet move over the ground at the agent's speed.
        const footSpeed = (dPhase / dt) * clip.stride * k;
        expect(Math.abs(footSpeed / speed - 1), look.id).toBeLessThan(0.1);
      }
      expect(cycles).toBeGreaterThan(0);
      expect(st.idle).toBe(false);
    }
  });

  it("a standing agent plays idle at its own clip rate (real time / idle duration)", () => {
    const clip = { stride: 0.6, duration: 1 };
    const idle = { stride: 0, duration: 3 };
    const st: GaitState = { phase: 0.25, dist: 10, idle: false };
    advanceGait(st, 10 + IDLE_BELOW_MPS * 0.5 * 0.1, 0.1, 1, clip, idle);
    expect(st.idle).toBe(true);
    expect(st.phase).toBeCloseTo(0.25 + 0.1 / 3, 9);
  });

  it("agents start at random (seeded) phases: no synchronised marching", () => {
    const ph = Array.from({ length: 400 }, (_, i) => seedPhase(`person:w${i}:0:0:0`));
    expect(seedPhase("x")).toBe(seedPhase("x"));
    const bins = new Array(10).fill(0) as number[];
    for (const p of ph) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      bins[Math.floor(p * 10)]! += 1;
    }
    for (const b of bins) expect(b).toBeLessThan(400 * 0.2);
  });

  it("framePair: bracketing baked frames and blend; the last segment ends on frame n (seamless loop)", () => {
    expect(framePair(0, 30)).toEqual({ f0: 0, f1: 1, t: 0 });
    const p = framePair(0.5, 30);
    expect(p.f0).toBe(15);
    expect(p.f1).toBe(16);
    expect(p.t).toBeCloseTo(0, 9);
    const q = framePair(29.5 / 30, 30);
    expect(q.f0).toBe(29);
    expect(q.f1).toBe(30);
    expect(q.t).toBeCloseTo(0.5, 6);
    // Phase wraps.
    expect(framePair(1.25, 4)).toEqual(framePair(0.25, 4));
    expect(framePair(-0.25, 4)).toEqual(framePair(0.75, 4));
  });
});
