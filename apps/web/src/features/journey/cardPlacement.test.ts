import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPlaceholderHero } from "../scene/three/characters/placeholderHero";
import { placeCard, type Rect } from "./cardPlacement";
import { BONE_PAD_M, boxOnScreen, heroBodyBox, heroScreenRect } from "./three/heroScreen";

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

  it("her box fills the view: a smaller card beside her, else the least overlap", () => {
    // the measured case: 923 x 836 map area, her box 360 x 420 px in the middle
    const v = { w: 923, h: 836, top: 96 };
    const hero: Rect = { x: 270, y: 200, w: 363, h: 420 };
    const p = placeCard({ x: 450, y: 180 }, { w: 290, h: 206 }, { ...v, keepClear: [hero] });
    const s = p.scale ?? 1;
    expect(s).toBeLessThan(1);
    const w = 290 * s;
    const h = 206 * s;
    const over =
      p.left < hero.x + hero.w &&
      p.left + w > hero.x &&
      p.top < hero.y + hero.h &&
      p.top + h > hero.y;
    expect(over).toBe(false);
    expect(p.left + w).toBeLessThanOrEqual(v.w);
    expect(p.top + h).toBeLessThanOrEqual(v.h);
    // no free spot even small: the smallest card, covering as little of her as possible
    const huge: Rect = { x: 20, y: 20, w: 880, h: 790 };
    const q = placeCard({ x: 450, y: 300 }, { w: 290, h: 206 }, { ...v, keepClear: [huge] });
    expect(q.scale).toBe(0.65);
    expect(placeCard({ x: 450, y: 300 }, { w: 290, h: 206 }, v).scale).toBeUndefined();
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

  it("GLB hero: bounds from the posed bones (padded), hidden LODs left out", () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const n = g.getAttribute("position").count;
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    g.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(
        Array.from({ length: n * 4 }, (_, i) => (i % 4 ? 0 : 1)),
        4,
      ),
    );
    const hips = new THREE.Bone();
    const head = new THREE.Bone();
    hips.add(head);
    const body = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    body.add(hips);
    body.bind(new THREE.Skeleton([hips, head]));
    head.position.y = 2.2; // posed: the head bone 2.2 m up (the bind-pose geometry is 1 m)
    const lod1 = new THREE.Group();
    lod1.visible = false;
    lod1.add(new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50)));
    const root = new THREE.Group();
    root.add(body, lod1);
    const b = heroBodyBox(root) as THREE.Box3;
    // hips at her root on the ground: the pad never reaches under the ground she stands on
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(2.2 + BONE_PAD_M, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(2 * BONE_PAD_M, 6); // the 50 m hidden LOD is left out
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
