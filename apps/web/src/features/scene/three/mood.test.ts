import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitFor, fogReachM, overviewPose } from "./cameraFit";
import { poseToCamera, vfovFor } from "./cameraRig";
import { BASE_WATER_COLOUR } from "./cityMesh";
import { readsAsWater } from "./colourHue";
import { ROOF_TINTS } from "./facade/roofPlan";
import { createFrame } from "./frame";
import { boundaryOf } from "./ground/boundary";
import { blendPresets, LIGHT_PRESETS } from "./lighting";
import {
  applyFog,
  FOG_REACH_SHARE,
  fogFor,
  glowFor,
  lightDate,
  moodKeyDir,
  moodPreset,
  moodSource,
  moodWeights,
} from "./mood";
import { createSky } from "./sky";

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
    const night = glowFor({ day: 0, dusk: 0, night: 1 });
    expect(night.uWindowGlow).toBeCloseTo(1, 9);
    expect(night.uLitShare).toBeCloseTo(0.45, 9);
    expect(night.uLightGlow).toBeCloseTo(1, 9);
    expect(glowFor({ day: 1, dusk: 0, night: 0 })).toEqual({
      uWindowGlow: 0,
      uLitShare: 0.35,
      uLightGlow: 0,
    });
  });
  it("fog scales with the camera range", () => {
    expect(fogFor(LIGHT_PRESETS.day, 7000).far).toBeGreaterThanOrEqual(8400);
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
    expect((scene.fog as THREE.Fog).far).toBeGreaterThanOrEqual(8000);
  });
  it("lightDate maps the day clock onto today's KL date", () => {
    const d = lightDate({ kind: "day", t: 21 * 60 }, NOW);
    expect(d.toISOString()).toBe("2026-03-20T13:00:00.000Z");
  });
});

describe("moodKeyDir", () => {
  it("never snaps while the day clock is scrubbed", () => {
    const angle = (a: number[], b: number[]) =>
      (Math.acos(Math.min(1, Math.max(-1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!))) * 180) /
      Math.PI;
    let prev: number[] | null = null;
    let worst = 0;
    for (let t = 5 * 60; t <= 23 * 60; t++) {
      const src = { kind: "day", t } as const;
      const d = moodKeyDir(src, moodWeights(src), NOW, 3.1813, 101.5099);
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      if (prev) worst = Math.max(worst, angle(prev, d));
      prev = d;
    }
    // The old dominant-keyframe switch jumped ~100 degrees in one minute. The dusk-to-night blend
    // swings the light from the western sky to the moon over 45 minutes, so a few degrees a minute
    // is expected; BOUND is about 2x the measured worst step (5.5 degrees per minute).
    expect(worst).toBeLessThanOrEqual(BOUND_DEG_PER_MIN);
  });
});
const BOUND_DEG_PER_MIN = 10;

describe("AC-A13: sky gradient and fog (A-T11)", () => {
  it("fog is on for every mood, and it is the scene's one Fog after applyFog", () => {
    for (const p of Object.values(LIGHT_PRESETS)) {
      expect(p.fog.far).toBeGreaterThan(p.fog.near);
      expect(p.fog.nearK).toBeGreaterThan(0);
      expect(p.fog.farK).toBeGreaterThan(p.fog.nearK);
      const scene = new THREE.Scene();
      applyFog(scene, p, 7000);
      expect(scene.fog).toBeInstanceOf(THREE.Fog);
    }
  });
  it("the sky is a gradient (zenith and horizon differ) for every mood, horizon = fog colour", () => {
    for (const [theme, p] of Object.entries(LIGHT_PRESETS)) {
      const sky = createSky();
      sky.setPreset(p);
      const c = sky.colours();
      expect(c.top, theme).not.toBe(c.horizon);
      expect(c.horizon, theme).toBe(p.fog.color);
      expect(new Set([c.top, c.horizon]).size).toBeGreaterThanOrEqual(2);
      sky.dispose();
    }
  });
  it("fog at the overview range reaches full strength at about 1.45x the range, not at the centre", () => {
    const f = fogFor(LIGHT_PRESETS.day, 7000);
    const at = (d: number) => Math.min(1, Math.max(0, (d - f.near) / (f.far - f.near)));
    expect(at(7000)).toBeLessThan(0.45); // the target of the view is only lightly hazed
    expect(at(10000)).toBeGreaterThan(0.9); // the far ground blends into the fog
  });
  it("fog stays moderate at mid range (hero-mid, 800 m): the floors apply, near ground clear", () => {
    for (const p of Object.values(LIGHT_PRESETS)) {
      const f = fogFor(p, 800);
      expect(f.near).toBeGreaterThanOrEqual(400);
      expect(f.far).toBeGreaterThanOrEqual(2500);
    }
  });
  it("no fog colour reads as water, and fog over a roof tint does not make it read as water", () => {
    for (const [theme, p] of Object.entries(LIGHT_PRESETS))
      expect(readsAsWater(p.fog.color, BASE_WATER_COLOUR), theme).toBe(false);
    for (const p of Object.values(LIGHT_PRESETS))
      for (const roof of ROOF_TINTS) {
        const mixed = `#${new THREE.Color(roof).lerp(new THREE.Color(p.fog.color), 0.5).getHexString()}`;
        expect(readsAsWater(mixed, BASE_WATER_COLOUR), `${roof} + ${p.fog.color}`).toBe(false);
      }
  });
});

describe("AC-A14: night grade (A-T11)", () => {
  it("ground and road albedo multiplier: 1 by day, lower at dusk, lowest at night, blended between", () => {
    const { day, dusk, night } = LIGHT_PRESETS;
    expect(day.groundGrade).toBe(1);
    expect(dusk.groundGrade).toBeLessThan(day.groundGrade);
    expect(night.groundGrade).toBeLessThan(dusk.groundGrade);
    expect(night.groundGrade).toBeLessThanOrEqual(0.8);
    const mid = moodPreset(at(7 * 60));
    expect(mid.groundGrade).toBeGreaterThan(night.groundGrade);
    expect(mid.groundGrade).toBeLessThan(day.groundGrade);
  });
});

describe("overview fog keeps the diorama slab edge in sight (A-T11 fix round 1)", () => {
  const seed = (p: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
    );
  it("at the overview pose the farthest boundary vertex is below full fog, the top of the frame is above 70%", () => {
    const frame = createFrame(seed("site.json").center);
    const ring: [number, number][] =
      seed("base/boundary.geojson").features[0].geometry.coordinates[0];
    // The overview (A-T5): the whole slab at max range, derived from the outline.
    const geom = seed("base/boundary.geojson").features[0].geometry;
    const fit = fitFor(boundaryOf(geom, frame)!);
    const pose = overviewPose(fit);
    const rangeM = pose.rangeM;
    const cam = poseToCamera(pose).position;
    const dist = (lon: number, lat: number) => {
      const [x, z] = frame.toLocal(lon, lat);
      return Math.hypot(x - cam[0], cam[1], z - cam[2]);
    };
    const farthest = Math.max(...ring.map(([lon, lat]) => dist(lon, lat)));
    expect(farthest).toBeGreaterThan(9000); // the extent really is that far
    for (const theme of ["day", "dusk", "night"] as const) {
      const f = fogFor(LIGHT_PRESETS[theme], rangeM, fogReachM(fit, rangeM));
      const factor = (d: number) => Math.min(1, Math.max(0, (d - f.near) / (f.far - f.near)));
      expect(factor(farthest), theme).toBeLessThan(0.95);
      // Top-centre ray: -pitch - vfov / 2 below the horizon, at the widest (panel-open) and the
      // full-canvas field of view.
      for (const aspect of [1.05, 1.6]) {
        const down = -pose.pitchDeg - vfovFor(pose, fit, aspect) / 2;
        const top =
          (rangeM * Math.sin((-pose.pitchDeg * Math.PI) / 180)) / Math.sin((down * Math.PI) / 180);
        expect(factor(top), `${theme} ${aspect}`).toBeGreaterThan(0.7);
      }
    }
  });
});

describe("fog reach from the slab (A-T5, new outline)", () => {
  it("without a reach the fog is unchanged; with one the reach sits at FOG_REACH_SHARE of the ramp", () => {
    const p = LIGHT_PRESETS.day;
    expect(fogFor(p, 7900, 0)).toEqual(fogFor(p, 7900));
    const f = fogFor(p, 7900, 14000);
    expect((14000 - f.near) / (f.far - f.near)).toBeCloseTo(FOG_REACH_SHARE, 9);
    // A reach inside the range-based fog never shortens it.
    expect(fogFor(p, 7900, 6000)).toEqual(fogFor(p, 7900));
  });
});
