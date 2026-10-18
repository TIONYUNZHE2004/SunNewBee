import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { centreMapMarker } from "../../../../lib/routeStatus";
import { createFrame } from "../frame";
import { createMarkers, LABEL_RANGE_M, markerIdAt } from "./markers";

const frame = createFrame([101.5, 3.0]);
const at = (dx: number) => [101.5 + dx * 1e-5, 3.0] as [number, number]; // ~1.1 m per unit
const places = [
  { id: "p1", name: "Playground", type: "park", coord: at(0) },
  { id: "p2", name: "Clinic", type: "clinic", coord: at(100) },
];
const waste = [{ id: "w1", name: "Bin A", type: "waste", coord: at(50) }];
const evac = [
  {
    centre: { id: "e1", name: "Hall", coord: at(10) },
    reachable: true,
    route_status: "confirmed",
  },
  {
    centre: { id: "e2", name: "Surau", coord: at(20) },
    reachable: false,
    route_status: "no_data",
  },
  {
    centre: { id: "e3", name: "School", coord: at(30) },
    reachable: true,
    route_status: "confirmed",
  },
];
const fakeCanvas = () => {
  const ctx = {
    font: "",
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillRect() {},
    fillText() {},
    roundRect() {},
    fill() {},
    beginPath() {},
  };
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
};
const make = (input = { places, waste, evac }) => createMarkers(input, frame, fakeCanvas);
const points = (g: THREE.Group) =>
  g.children.filter((o) => o instanceof THREE.Points) as THREE.Points[];
const sprites = (g: THREE.Group) =>
  g.children.filter((o) => o instanceof THREE.Sprite) as THREE.Sprite[];
const size = (p: THREE.Points) =>
  (p.material as THREE.ShaderMaterial).uniforms.uSize!.value as number;
const hex = (p: THREE.Points) =>
  ((p.material as THREE.ShaderMaterial).uniforms.uColor!.value as THREE.Color).getHexString();
const byKind = (g: THREE.Group, kind: string) =>
  points(g).filter((p) => p.userData.pick?.kind === kind);
const cam = (m: ReturnType<typeof make>, x = 0, z = 0) => m.setView({ x, y: 300, z }, 40, 800);

describe("markers", () => {
  it("places are #0f5c63 at 9 px, waste #6B46C1 at 9 px, evac centres 12 px", () => {
    const m = make();
    const [pl] = byKind(m.group, "place");
    expect(size(pl!)).toBe(9);
    expect(hex(pl!)).toBe("0f5c63");
    const [w] = byKind(m.group, "waste");
    expect(size(w!)).toBe(9);
    expect(hex(w!)).toBe("6b46c1");
    for (const e of byKind(m.group, "evac")) expect(size(e)).toBe(12);
  });

  it("evacuation centres take their colour from centreMapMarker, grouped by colour", () => {
    const m = make();
    const evacPts = byKind(m.group, "evac");
    const want = new Set(evac.map((r) => centreMapMarker(r).color.slice(1).toLowerCase()));
    expect(new Set(evacPts.map(hex))).toEqual(want);
    expect(evacPts).toHaveLength(want.size);
    // the no_data centre is neutral grey, never green
    const grey = evacPts.find((p) => hex(p) === "6b7280");
    expect(markerIdAt(grey!, 0)).toBe("e2");
  });

  it("markers carry pick data and name the id by index", () => {
    const m = make();
    const [pl] = byKind(m.group, "place");
    expect(pl!.userData.pick).toEqual({ kind: "place" });
    expect(markerIdAt(pl!, 0)).toBe("p1");
    expect(markerIdAt(pl!, 1)).toBe("p2");
    expect(markerIdAt(pl!, 9)).toBeNull();
    expect(markerIdAt(byKind(m.group, "waste")[0]!, 0)).toBe("w1");
    expect(m.group.userData.decorative).toBeUndefined();
  });

  it("a focused place is 16 px with a label; a second focus replaces it", () => {
    const m = make();
    cam(m);
    expect(sprites(m.group).filter((s) => s.visible)).toHaveLength(evac.length + waste.length);
    m.setFocus("p2");
    cam(m);
    const f = points(m.group).filter((p) => size(p) === 16);
    expect(f).toHaveLength(1);
    expect(f[0]!.userData.pick).toEqual({ kind: "place" });
    expect(markerIdAt(f[0]!, 0)).toBe("p2");
    const labels = sprites(m.group).filter((s) => s.visible);
    expect(labels.map((s) => s.userData.id)).toContain("p2");
    expect(labels.map((s) => s.userData.id)).not.toContain("p1");
    m.setFocus(null);
    expect(points(m.group).some((p) => size(p) === 16)).toBe(false);
  });

  it("labels beyond 1500 m are hidden unless focused", () => {
    const m = make();
    expect(LABEL_RANGE_M).toBe(1500);
    cam(m, 0, 0);
    const shown = () =>
      sprites(m.group)
        .filter((s) => s.visible)
        .map((s) => s.userData.id as string);
    expect(shown()).toEqual(expect.arrayContaining(["e1", "e2", "e3", "w1"]));
    cam(m, 5000, 0);
    expect(shown()).toEqual([]);
    m.setFocus("e2");
    cam(m, 5000, 0);
    expect(shown()).toEqual(["e2"]);
  });

  it("labels read centre name and status for evac, 'Waste point:' for waste", () => {
    const drawn: string[] = [];
    const canvas = () => {
      const c = fakeCanvas();
      const ctx = c.getContext("2d") as unknown as { fillText: (t: string) => void };
      ctx.fillText = (t: string) => drawn.push(t);
      return c;
    };
    const m = createMarkers({ places, waste, evac }, frame, canvas);
    cam(m);
    expect(drawn).toContain("Hall: Reachable");
    expect(drawn).toContain("Surau: No mapped connection");
    expect(drawn).toContain("Waste point: Bin A");
    expect(drawn.some((t) => t === "Playground")).toBe(false);
  });

  it("label sprites are screen-sized (no attenuation) and cap the draw count", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`,
      name: `W${i}`,
      type: "waste",
      coord: at(i),
    }));
    const m = createMarkers({ places: [], waste: many, evac: [] }, frame, fakeCanvas);
    cam(m);
    const vis = sprites(m.group).filter((s) => s.visible);
    expect(vis.length).toBeLessThanOrEqual(12);
    for (const s of sprites(m.group))
      expect((s.material as THREE.SpriteMaterial).sizeAttenuation).toBe(false);
  });

  it("draws on top, without depth, and disposes", () => {
    const m = make();
    cam(m);
    for (const p of points(m.group)) {
      const mat = p.material as THREE.ShaderMaterial;
      expect(mat.depthTest).toBe(false);
      expect(mat.depthWrite).toBe(false);
      expect(p.renderOrder).toBeGreaterThanOrEqual(14);
    }
    m.dispose();
    expect(m.group.children).toHaveLength(0);
  });

  it("empty input gives an empty group", () => {
    expect(make({ places: [], waste: [], evac: [] }).group.children).toHaveLength(0);
  });
});
