import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPlaceholderHero } from "../scene/three/characters/placeholderHero";
import { placeCard, type Rect } from "./cardPlacement";
import { boxOnScreen, heroBodyBox, heroScreenRect } from "./three/heroScreen";

const card = { w: 290, h: 180 };
const vp = { w: 1040, h: 830, top: 96 };
const mini: Rect = { x: 820, y: 16, w: 200, h: 150 };
const overlaps = (l: number, t: number, r: Rect) =>
  l < r.x + r.w && l + card.w > r.x && t < r.y + r.h && t + card.h > r.y;

describe("event cards keep clear of the hero (D-T5 ruling)", () => {
  it("a card that would cover her moves beside, above or below her, inside the viewport", () => {
    const hero: Rect = { x: 420, y: 300, w: 120, h: 220 };
    const anchor = { x: 480, y: 360 }; // the marker over her: the card would sit on her
    const plain = placeCard(anchor, card, vp);
    expect(overlaps(plain.left, plain.top, hero)).toBe(true);
    const p = placeCard(anchor, card, { ...vp, keepClear: [hero] });
    expect(overlaps(p.left, p.top, hero)).toBe(false);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + card.w).toBeLessThanOrEqual(vp.w - 12);
    expect(p.top).toBeGreaterThanOrEqual(vp.top + 12);
    expect(p.top + card.h).toBeLessThanOrEqual(vp.h - 12);
    expect(p.anchored).toBe(true);
  });

  it("never covers her nor the mini-map when a free spot exists (random anchors and boxes)", () => {
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 2000; i++) {
      const hero: Rect = {
        x: 100 + rnd() * 700,
        y: 150 + rnd() * 450,
        w: 40 + rnd() * 160,
        h: 80 + rnd() * 260,
      };
      const anchor = rnd() < 0.1 ? null : { x: rnd() * vp.w, y: rnd() * vp.h };
      const p = placeCard(anchor, card, { ...vp, avoid: [mini], keepClear: [hero] });
      expect(overlaps(p.left, p.top, hero)).toBe(false);
      expect(overlaps(p.left, p.top, mini)).toBe(false);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + card.w).toBeLessThanOrEqual(vp.w);
      expect(p.top + card.h).toBeLessThanOrEqual(vp.h);
    }
  });

  it("a card clear of her is not moved", () => {
    const hero: Rect = { x: 100, y: 600, w: 80, h: 150 };
    const a = { x: 700, y: 500 };
    expect(placeCard(a, card, { ...vp, keepClear: [hero] })).toEqual(placeCard(a, card, vp));
  });
});

describe("hero screen box", () => {
  const hero = createPlaceholderHero();
  hero.setPose({ x: 0, y: 0.08, z: 0 }, 0);
  hero.play("walk", 0.3, 1);

  it("is her body and walker, without the ground ring", () => {
    const b = heroBodyBox(hero.object3d) as THREE.Box3;
    const all = new THREE.Box3().setFromObject(hero.object3d);
    expect(b.max.y).toBeGreaterThan(2.2);
    // the ring (radius ~1.3 m) widens the full box; the body box is narrower
    expect(b.max.x - b.min.x).toBeLessThan(all.max.x - all.min.x);
    expect(b.max.x - b.min.x).toBeLessThan(1.8);
  });

  it("projects to a screen rectangle, null when she is behind the camera", () => {
    const cam = new THREE.PerspectiveCamera(30, 1.2, 0.5, 1000);
    cam.position.set(-8, 4, 5);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld();
    const r = heroScreenRect(hero.object3d, cam, [1200, 1000]);
    expect(r).not.toBeNull();
    expect((r as Rect).w).toBeGreaterThan(20);
    cam.lookAt(-20, 4, 5);
    cam.updateMatrixWorld();
    expect(boxOnScreen(heroBodyBox(hero.object3d) as THREE.Box3, cam, [1200, 1000])).toBeNull();
  });
});
