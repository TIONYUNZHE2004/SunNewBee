import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THREE_TIERS } from "./quality";
import { CityBokehPass, dofActive, focusDepth, TILT_SHIFT, tiltShiftParams } from "./tiltShift";

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
  it("uses the prototype's near values close in and its far values far out", () => {
    const near = tiltShiftParams(30);
    const far = tiltShiftParams(800);
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
    pass.dispose();
  });
});
