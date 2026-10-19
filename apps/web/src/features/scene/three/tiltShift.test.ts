import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THREE_TIERS } from "./quality";
import {
  CityBokehPass,
  dofActive,
  focusDepth,
  SLAB_FACTOR_GLSL,
  blurAt as slabBlur,
  TILT_SHIFT,
  tiltShiftParams,
} from "./tiltShift";

describe("tilt-shift presets (B-T5, AC-B5)", () => {
  it("depth of field is on High only; Low also has no AO", () => {
    expect(THREE_TIERS.high.dof).toBe(true);
    expect(THREE_TIERS.medium.dof).toBe(false);
    expect(THREE_TIERS.low.dof).toBe(false);
    expect(THREE_TIERS.low.ao).toBe(false);
  });
  it("the FX toggle, Low/Medium and prefers-reduced-motion each turn it off", () => {
    expect(dofActive({ tier: "high", fx: true, reducedMotion: false })).toBe(true);
    expect(dofActive({ tier: "high", fx: false, reducedMotion: false })).toBe(false);
    expect(dofActive({ tier: "high", fx: true, reducedMotion: true })).toBe(false);
    expect(dofActive({ tier: "medium", fx: true, reducedMotion: false })).toBe(false);
    expect(dofActive({ tier: "low", fx: true, reducedMotion: false })).toBe(false);
  });
});

describe("tiltShiftParams (aperture by camera distance, prototype values)", () => {
  it("uses the prototype's near values close in and its far values at ~300 m", () => {
    const near = tiltShiftParams(30);
    const far = tiltShiftParams(300); // the prototype tuned its far values at ~300 m
    expect(near.aperture).toBeCloseTo(TILT_SHIFT.near.aperture, 9);
    expect(near.maxblur).toBeCloseTo(TILT_SHIFT.near.maxblur, 9);
    expect(far.aperture).toBeCloseTo(TILT_SHIFT.far.aperture, 9);
    expect(far.maxblur).toBeCloseTo(TILT_SHIFT.far.maxblur, 9);
    expect(TILT_SHIFT.near.aperture).toBe(0.00016);
    expect(TILT_SHIFT.far.aperture).toBe(0.000022);
  });
  it("blends continuously (no pop at the prototype's 120 m step) and monotonically", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let d = 20; d <= 1000; d += 5) {
      const a = tiltShiftParams(d).aperture;
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
    const a119 = tiltShiftParams(119).aperture;
    const a121 = tiltShiftParams(121).aperture;
    expect(Math.abs(a119 - a121) / a119).toBeLessThan(0.05);
  });
});

describe("tiltShiftParams at range (overview: a focus band, not a blurred map)", () => {
  // BokehPass blur = clamp((focus - depth) * aperture, maxblur). The prototype's far aperture
  // (0.000022) saturates the blur at a depth difference of ~0.9 x a ~300 m focus; at the 7 km
  // overview it saturated everywhere (the first GPU run: the whole map soft, the far slab edge's
  // soil lost: AC-A5/AC-B10 N side). The band keeps the prototype's ratio at every range.
  const blurAt = (focus: number, depth: number) => {
    const p = tiltShiftParams(focus);
    return Math.min(p.maxblur, Math.abs(focus - depth) * p.aperture);
  };
  it("saturates the blur no closer than BAND_K x the focus depth, at any range", () => {
    for (const f of [300, 800, 2000, 7000, 9000]) {
      const p = tiltShiftParams(f);
      expect(p.maxblur / p.aperture, `${f}`).toBeGreaterThanOrEqual(TILT_SHIFT.bandK * f * 0.999);
    }
  });
  it("at the overview keeps a sharp band (+-10% depth) and a soft but readable far edge", () => {
    const f = 7000;
    expect(blurAt(f, f * 1.1) / tiltShiftParams(f).maxblur).toBeLessThan(0.15);
    // The far slab edge (~9.7 km): blurred, at most the overview cap (about 4 px at 1440 px).
    expect(blurAt(f, 9700)).toBeGreaterThan(0);
    expect(blurAt(f, 9700)).toBeLessThanOrEqual(TILT_SHIFT.overviewMaxblur);
    expect(TILT_SHIFT.overviewMaxblur * 1440).toBeLessThanOrEqual(4.5);
  });
  it("keeps the prototype values near the subject (follow camera)", () => {
    expect(tiltShiftParams(30).aperture).toBeCloseTo(TILT_SHIFT.near.aperture, 9);
    expect(tiltShiftParams(240).maxblur).toBeCloseTo(TILT_SHIFT.far.maxblur, 9);
  });
});

describe("tiltShiftParams in follow mode (a subject: her chest; AC-B4)", () => {
  // BokehShader: the kernel's outer ring is at 0.4 x the blur (UV of the width).
  const px = (blur: number) => blur * 0.4 * 1440;
  const blurAt = (cam: number, focus: number, depth: number) =>
    slabBlur(tiltShiftParams(cam, true), focus, depth);
  it("blurs the far field (> 60 m) strongly at the follow distances and keeps her sharp", () => {
    for (const d of [10, 14, 20, 30]) {
      // The follow pose is ~10.5 m from her chest (8.5 back, 4.5 side, 4.2 up); holds frame wider.
      // The far field (> 60 m) and canopies 2x her distance: at the max blur, >= 6 px.
      expect(px(blurAt(d, d, 60 + d)), `${d} far`).toBeGreaterThanOrEqual(6);
      expect(blurAt(d, d, 2 * d), `${d} canopy`).toBeCloseTo(tiltShiftParams(d, true).maxblur, 9);
      // Her, the walker and the bench (+-2 m of the focus): inside the slab, not blurred at all.
      expect(blurAt(d, d, d + 2), `${d} hero`).toBe(0);
      expect(blurAt(d, d, d - 2), `${d} hero`).toBe(0);
    }
  });
  it("is at least the plain blur and fades to it by fadeM (no pop on the dive or pull-back)", () => {
    for (const d of [5, 50, 200, 800, 1500]) {
      const s = tiltShiftParams(d, true);
      const p = tiltShiftParams(d);
      expect(s.maxblur).toBeGreaterThanOrEqual(p.maxblur);
      expect(s.aperture).toBeGreaterThanOrEqual(p.aperture * 0.999);
    }
    for (const d of [TILT_SHIFT.subject.fadeM, 4000, 7000])
      expect(tiltShiftParams(d, true)).toEqual(tiltShiftParams(d));
    let last = tiltShiftParams(TILT_SHIFT.subject.fullM, true);
    for (let d = TILT_SHIFT.subject.fullM; d <= TILT_SHIFT.subject.fadeM; d *= 1.02) {
      const p = tiltShiftParams(d, true);
      expect(Math.abs(p.maxblur - last.maxblur) / last.maxblur).toBeLessThan(0.03);
      expect(Math.abs(p.aperture - last.aperture) / last.aperture).toBeLessThan(0.06);
      last = p;
    }
  });
});

describe("focusDepth (BokehPass focus = depth along the view axis)", () => {
  it("is the focus point's distance along the look direction, never negative", () => {
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 10000);
    cam.position.set(0, 100, 100);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    expect(focusDepth(cam, new THREE.Vector3(0, 0, 0))).toBeCloseTo(Math.hypot(100, 100), 6);
    // A point to the side at the same depth plane gives the same focus.
    const side = new THREE.Vector3(50, 0, 0);
    expect(focusDepth(cam, side)).toBeCloseTo(Math.hypot(100, 100), 6);
    // Behind the camera: clamped to the near plane.
    expect(focusDepth(cam, new THREE.Vector3(0, 200, 200))).toBe(cam.near);
  });
});

describe("CityBokehPass", () => {
  afterEach(() => vi.restoreAllMocks());
  it("hides the skip list (lines, ribbon) for its depth render and restores it", () => {
    const scene = new THREE.Scene();
    const ribbon = new THREE.Group();
    const hidden = new THREE.Group();
    hidden.visible = false;
    scene.add(ribbon, hidden);
    let seen: boolean[] = [];
    vi.spyOn(BokehPass.prototype, "render").mockImplementation(() => {
      seen = [ribbon.visible, hidden.visible];
    });
    const pass = new CityBokehPass(scene, new THREE.PerspectiveCamera(), () => [ribbon, hidden]);
    const t = {} as THREE.WebGLRenderTarget;
    pass.render({} as THREE.WebGLRenderer, t, t, 0, false);
    expect(seen).toEqual([false, false]);
    expect(ribbon.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    pass.dispose();
  });
  it("aims at a focus depth with the distance's aperture", () => {
    const pass = new CityBokehPass(new THREE.Scene(), new THREE.PerspectiveCamera(), () => []);
    pass.aim(250, 30);
    const u = pass.uniforms as Record<string, { value: number }>;
    expect(u.focus?.value).toBe(250);
    expect(u.aperture?.value).toBeCloseTo(TILT_SHIFT.near.aperture, 9);
    expect(u.maxblur?.value).toBeCloseTo(TILT_SHIFT.near.maxblur, 9);
    expect(u.slab?.value).toBe(0);
    pass.aim(10, 10, true);
    expect(u.aperture?.value).toBeCloseTo(tiltShiftParams(10, true).aperture, 9);
    expect(u.maxblur?.value).toBeCloseTo(TILT_SHIFT.subject.maxblur, 9);
    expect(u.slab?.value).toBeCloseTo(TILT_SHIFT.subject.slabM, 9);
    pass.dispose();
  });
  it("patches the bokeh shader with the in-focus slab (0 = the stock blur)", () => {
    const pass = new CityBokehPass(new THREE.Scene(), new THREE.PerspectiveCamera(), () => []);
    const fs = pass.materialBokeh.fragmentShader;
    expect(fs).toContain("uniform float slab;");
    expect(fs).toContain(SLAB_FACTOR_GLSL);
    expect(fs).not.toContain("float factor = ( focus + viewZ );");
    // slab 0: sign(f) * max(0, |f|) = f, the stock factor.
    expect(slabBlur({ aperture: 0.001, maxblur: 1, slab: 0 }, 10, 25)).toBeCloseTo(0.015, 9);
    pass.dispose();
  });
});
