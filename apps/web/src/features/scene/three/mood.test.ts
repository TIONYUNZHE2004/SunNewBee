import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { blendPresets, LIGHT_PRESETS } from "./lighting";
import { applyFog, fogFor, glowFor, lightDate, moodPreset, moodSource, moodWeights } from "./mood";

const NOW = new Date("2026-03-20T05:00:00Z"); // 13:00 KL
const at = (t: number) => moodWeights({ kind: "day", t });

describe("moodSource", () => {
  it("day playback beats a pinned theme beats the clock", () => {
    expect(moodSource({ dayOn: true, dayT: 600, choice: "night", now: NOW }).kind).toBe("day");
    expect(moodSource({ dayOn: false, dayT: 600, choice: "night", now: NOW })).toEqual({
      kind: "pinned",
      theme: "night",
    });
    expect(moodSource({ dayOn: false, dayT: 600, choice: "auto", now: NOW }).kind).toBe("clock");
  });
});

describe("moodWeights", () => {
  it("is one-hot at the keyframes", () => {
    expect(at(12 * 60).day).toBe(1);
    expect(at(19 * 60 + 15).dusk).toBe(1);
    expect(at(22 * 60).night).toBe(1);
    expect(at(3 * 60).night).toBe(1);
  });
  it("mixes day and dusk at 18:45 and sums to 1", () => {
    const w = at(18 * 60 + 45);
    expect(w.day).toBeGreaterThan(0);
    expect(w.dusk).toBeGreaterThan(0);
    expect(w.day + w.dusk + w.night).toBeCloseTo(1);
  });
  it("pinned is one-hot, and the clock reads Kuala Lumpur time", () => {
    expect(moodWeights({ kind: "pinned", theme: "dusk" })).toEqual({ day: 0, dusk: 1, night: 0 });
    expect(moodWeights({ kind: "clock", now: NOW }).day).toBe(1);
    expect(moodWeights({ kind: "clock", now: new Date("2026-03-20T14:00:00Z") }).night).toBe(1);
  });
  it("changes by at most 0.05 per minute over 05:00-23:00", () => {
    for (let t = 5 * 60; t < 23 * 60; t++) {
      const a = at(t);
      const b = at(t + 1);
      for (const k of ["day", "dusk", "night"] as const)
        expect(Math.abs(b[k] - a[k])).toBeLessThanOrEqual(0.05);
    }
  });
});

describe("moodPreset, glowFor, fogFor", () => {
  it("returns the keyframe itself for one-hot weights and a blend between", () => {
    expect(moodPreset({ day: 1, dusk: 0, night: 0 })).toBe(LIGHT_PRESETS.day);
    const mid = moodPreset(at(18 * 60 + 45));
    expect(mid.sunIntensity).toBeLessThan(LIGHT_PRESETS.day.sunIntensity);
    expect(mid.sunIntensity).toBeGreaterThan(LIGHT_PRESETS.dusk.sunIntensity);
  });
  it("glow uniforms: night and day", () => {
    expect(glowFor({ day: 0, dusk: 0, night: 1 })).toEqual({
      uWindowGlow: 1.6,
      uLitShare: 0.58,
      uLightGlow: 1.0,
    });
    expect(glowFor({ day: 1, dusk: 0, night: 0 })).toEqual({
      uWindowGlow: 0,
      uLitShare: 0.35,
      uLightGlow: 0,
    });
  });
  it("fog scales with the camera range", () => {
    expect(fogFor(LIGHT_PRESETS.day, 7000).far).toBeGreaterThanOrEqual(15400);
    expect(fogFor(LIGHT_PRESETS.day, 100)).toMatchObject({ near: 600, far: 3500 });
  });
  it("blendPresets ends are the inputs", () => {
    const { day, night } = LIGHT_PRESETS;
    expect(blendPresets(day, night, 0)).toEqual(day);
    expect(blendPresets(day, night, 1)).toEqual(night);
  });
  it("applyFog mutates the one Fog", () => {
    const scene = new THREE.Scene();
    applyFog(scene, LIGHT_PRESETS.day, 100);
    const f = scene.fog;
    applyFog(scene, LIGHT_PRESETS.night, 7000);
    expect(scene.fog).toBe(f);
    expect((scene.fog as THREE.Fog).far).toBeGreaterThanOrEqual(15400);
  });
  it("lightDate maps the day clock onto today's KL date", () => {
    const d = lightDate({ kind: "day", t: 21 * 60 }, NOW);
    expect(d.toISOString()).toBe("2026-03-20T13:00:00.000Z");
  });
});
