import type * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { describe, expect, it } from "vitest";
import { GAP_BANDS } from "../../../gaps/gapModel";
import { WHATIF_STYLE } from "../../../whatif/whatifModel";
import { ROUTE_STYLE, statusStyle } from "../../styles";
import { createFrame } from "../frame";
import { createOverlayLayer, type OverlayState } from "./accessLayers";

const attr = (b: unknown, n: string) =>
  (b as LineSegments2).geometry.getAttribute(n) as THREE.BufferAttribute;

const frame = createFrame([101.5, 3.0]);
const seg = (id: string, a: number, props: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [101.5 + a * 1e-4, 3.0],
      [101.5 + a * 1e-4 + 1e-4, 3.0],
      [101.5 + a * 1e-4 + 2e-4, 3.0001],
    ],
  },
  properties: { id, ...props },
});
const access = {
  type: "FeatureCollection",
  features: [
    seg("a", 0, { status: "blocked" }),
    seg("b", 1, { status: "blocked" }),
    seg("c", 2, { status: "unknown" }),
    seg("d", 3, { status: "ok" }),
  ],
};
const gaps = {
  type: "FeatureCollection",
  features: [
    seg("a", 0, { unknown_count: 0, relevant_count: 2 }),
    seg("b", 1, { unknown_count: 2, relevant_count: 2 }),
    seg("c", 2, { unknown_count: 1, relevant_count: 3 }),
  ],
};
const whatIf = {
  geojson: {
    type: "FeatureCollection",
    features: [
      { ...seg("x", 0), properties: { whatif: true, side: "before" } },
      { ...seg("y", 1), properties: { whatif: true, side: "after" } },
      { ...seg("z", 2), properties: { whatif: true, side: "touched" } },
    ],
  },
} as never;
const route = {
  type: "LineString",
  coordinates: [
    [101.5, 3.0],
    [101.501, 3.001],
  ],
} as never;

const base: OverlayState = {
  access: null,
  accessVisible: true,
  gaps: null,
  gapsOn: false,
  route: null,
  whatIf: null,
};
const batches = (g: THREE.Object3D) => {
  const out: LineSegments2[] = [];
  g.traverse((o) => {
    if ((o as LineSegments2).isLineSegments2) out.push(o as LineSegments2);
  });
  return out;
};
const visibleBatches = (g: THREE.Object3D) =>
  batches(g).filter((b) => {
    for (let o: THREE.Object3D | null = b; o; o = o.parent) if (!o.visible) return false;
    return true;
  });
const mat = (b: LineSegments2) => b.material as LineMaterial;
const colour = (b: LineSegments2) => `#${mat(b).color.getHexString()}`;
const lower = (s: string) => s.toLowerCase();

describe("createOverlayLayer", () => {
  it("makes one batch per status in the statusStyle colour, order 10, lift 0.4", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, access });
    const bs = visibleBatches(l.group);
    expect(bs.length).toBe(3);
    expect(bs.map(colour).sort()).toEqual(
      [statusStyle("blocked"), statusStyle("unknown"), statusStyle("ok")]
        .map((s) => lower(s.color))
        .sort(),
    );
    for (const b of bs) {
      expect(b.renderOrder).toBe(10);
      expect(attr(b, "instanceStart").getY(0)).toBeCloseTo(0.4, 6);
    }
    const blocked = bs.find((b) => colour(b) === lower(statusStyle("blocked").color));
    expect(attr(blocked, "instanceStart").count).toBe(4); // two edges x two segments
    expect(mat(blocked as LineSegments2).dashed).toBe(true);
  });

  it("the no-known-barrier network is translucent", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, access });
    const ok = batches(l.group).find((b) => colour(b) === lower(statusStyle("ok").color));
    expect(mat(ok as LineSegments2).opacity).toBe(0.6);
  });

  it("gapsOn hides the status batches and shows the gap batches", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, access, gaps, gapsOn: true });
    const bs = visibleBatches(l.group);
    expect(bs.length).toBe(3);
    expect(bs.map(colour).sort()).toEqual(
      Object.values(GAP_BANDS)
        .map((b) => lower(b.color))
        .sort(),
    );
    for (const b of bs) expect(b.renderOrder).toBe(11);
    l.update({ ...base, access, gaps, gapsOn: false });
    const after = visibleBatches(l.group);
    expect(after.length).toBe(3);
    expect(after.every((b) => b.renderOrder === 10)).toBe(true);
  });

  it("hides the access lines when the access lens is off", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, access, gaps, gapsOn: true, accessVisible: false });
    expect(visibleBatches(l.group).length).toBe(0);
  });

  it("route is #2B6CB0 at 8 px, order 13, lift 0.6", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, route });
    const bs = visibleBatches(l.group);
    expect(bs.length).toBe(1);
    const b = bs[0] as LineSegments2;
    expect(colour(b)).toBe("#2b6cb0");
    expect(ROUTE_STYLE.color).toBe("#2B6CB0");
    expect(mat(b).linewidth).toBe(8);
    expect(b.renderOrder).toBe(13);
    expect(attr(b, "instanceStart").getY(0)).toBeCloseTo(0.6, 6);
    l.update({ ...base, route: null });
    expect(visibleBatches(l.group).length).toBe(0);
  });

  it("what-if sides follow WHATIF_STYLE, order 12; before is dashed", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, whatIf });
    const bs = visibleBatches(l.group);
    expect(bs.length).toBe(3);
    const by = (side: keyof typeof WHATIF_STYLE) =>
      bs.find((b) => colour(b) === lower(WHATIF_STYLE[side].color)) as LineSegments2;
    for (const side of ["before", "after", "touched"] as const) {
      expect(mat(by(side)).linewidth).toBe(WHATIF_STYLE[side].width);
      expect(by(side).renderOrder).toBe(12);
    }
    expect(mat(by("before")).dashed).toBe(true);
    expect(mat(by("after")).dashed).toBe(false);
  });

  it("Review Focus 1: every overlay draws on top (depthTest false, renderOrder > 0)", () => {
    const l = createOverlayLayer(frame);
    const all = { access, accessVisible: true, gaps, route, whatIf };
    l.update({ ...all, gapsOn: true });
    l.update({ ...all, gapsOn: false });
    const bs = batches(l.group);
    expect(bs.length).toBeGreaterThan(6);
    for (const b of bs) {
      expect(mat(b).depthTest).toBe(false);
      expect(b.renderOrder).toBeGreaterThanOrEqual(10);
    }
  });

  it("leaves raycast alone (picking is Task 14) and is not decorative", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, access, route });
    for (const b of batches(l.group)) {
      expect(Object.hasOwn(b, "raycast")).toBe(false);
      expect(b.userData.decorative).toBeUndefined();
    }
  });

  it("setResolution reaches current and later batches; dispose frees them", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, route });
    l.setResolution(800, 600);
    l.update({ ...base, route, access });
    for (const b of batches(l.group)) {
      const r = mat(b).resolution;
      expect([r.x, r.y]).toEqual([800, 600]);
    }
    let disposed = 0;
    for (const b of batches(l.group)) b.geometry.addEventListener("dispose", () => disposed++);
    l.dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(batches(l.group).length).toBe(0);
  });

  it("an unchanged state rebuilds nothing", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, route });
    const before = batches(l.group)[0];
    l.update({ ...base, route });
    expect(batches(l.group)[0]).toBe(before);
  });

  it("setMetresPerPixel rescales dashed batches now and for batches built later", () => {
    const l = createOverlayLayer(frame);
    l.update({ ...base, access });
    const blocked = () =>
      batches(l.group).find(
        (b) => colour(b) === lower(statusStyle("blocked").color),
      ) as LineSegments2;
    const at1 = mat(blocked()).dashSize;
    l.setMetresPerPixel(4);
    expect(mat(blocked()).dashSize).toBeCloseTo(4 * at1, 6);
    l.update({ ...base, access: { ...access }, route });
    expect(mat(blocked()).dashSize).toBeCloseTo(4 * at1, 6);
  });

  it("hasVisible is false with nothing to draw", () => {
    const l = createOverlayLayer(frame);
    expect(l.hasVisible()).toBe(false);
    l.update({ ...base, route });
    expect(l.hasVisible()).toBe(true);
    l.update({ ...base, access, accessVisible: false });
    expect(l.hasVisible()).toBe(false);
  });
});
