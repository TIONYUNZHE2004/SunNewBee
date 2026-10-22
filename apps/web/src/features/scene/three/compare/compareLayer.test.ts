import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCompareTimeline, compareStateAt } from "../../../journey/compareTimeline";
import { handCompare } from "../../../journey/fixtures/compareHand";
import { createFrame } from "../frame";
import {
  COMPARE_COLOURS,
  createCompareLayer,
  ribbonGeometry,
  SHIRTS,
  STOP_EDGE_M,
  segmentMetres,
  spansWith,
  stopEdgeM,
  tintVertexColours,
} from "./compareLayer";

const playable = () => {
  const c = handCompare();
  if (!c.fastest || !c.recommended) throw new Error("fixture");
  return c as typeof c & {
    fastest: NonNullable<typeof c.fastest>;
    recommended: NonNullable<typeof c.recommended>;
  };
};

describe("spansWith", () => {
  it("cuts PASS runs around the marks, clipped to the route", () => {
    expect(spansWith(100, [[20, 30]], "UNKNOWN")).toEqual([
      [0, 20, "PASS"],
      [20, 30, "UNKNOWN"],
      [30, 100, "PASS"],
    ]);
    expect(spansWith(100, [[95, 120]], "FAIL")).toEqual([
      [0, 95, "PASS"],
      [95, 100, "FAIL"],
    ]);
    expect(spansWith(100, [], "FAIL")).toEqual([[0, 100, "PASS"]]);
  });
});

describe("ribbonGeometry", () => {
  it("is a flat strip of the given width at the lift", () => {
    const g = ribbonGeometry(new Float32Array([0, 0, 0, 0, 0, 10, 10, 0, 10]), 2, 0.3);
    const p = g.getAttribute("position");
    expect(p.count).toBe(6);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(0.3);
    // first pair is 2 m apart across the travel direction
    expect(Math.hypot(p.getX(0) - p.getX(1), p.getZ(0) - p.getZ(1))).toBeCloseTo(2);
    expect(g.getIndex()?.count).toBe(12);
  });
});

describe("tintVertexColours", () => {
  it("recolours the shirt on a geometry copy and undoes it", () => {
    const g = new THREE.BufferGeometry();
    const shirt = new THREE.Color("#8a63cc");
    const skin = new THREE.Color("#e2b08a");
    const tudung = new THREE.Color("#cdb0ee");
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(
        new Float32Array([
          shirt.r,
          shirt.g,
          shirt.b,
          skin.r,
          skin.g,
          skin.b,
          tudung.r,
          tudung.g,
          tudung.b,
        ]),
        3,
      ),
    );
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    const m = new THREE.Mesh(g);
    const undo = tintVertexColours(m, "#8a63cc", SHIRTS.recommended);
    expect(m.geometry).not.toBe(g);
    const c = m.geometry.getAttribute("color");
    const want = new THREE.Color(SHIRTS.recommended);
    expect(c.getX(0)).toBeCloseTo(want.r);
    expect(c.getX(1)).toBeCloseTo(skin.r);
    // the lilac tudung (lighter than the baju) keeps its colour
    expect(c.getX(2)).toBeCloseTo(tudung.r);
    expect(c.getZ(2)).toBeCloseTo(tudung.b);
    // the shared original is untouched
    expect(g.getAttribute("color").getX(0)).toBeCloseTo(shirt.r);
    undo();
    expect(m.geometry).toBe(g);
  });
});

describe("createCompareLayer", () => {
  const c = playable();
  const tl = buildCompareTimeline(c);
  const frame = createFrame([101.5, 3.18]);
  const layer = createCompareLayer({ payload: c, timeline: tl, frame });

  it("draws both ribbons, the unchecked run and the stop edge in the prototype colours", () => {
    const meshes = layer.group.children.filter((o) =>
      o.name.startsWith("compare-ribbon"),
    ) as THREE.Mesh[];
    const byName = Object.fromEntries(
      meshes.map((m) => [
        m.name,
        `#${(m.material as THREE.MeshBasicMaterial).color.getHexString()}`,
      ]),
    );
    const hex = (h: string) => `#${new THREE.Color(h).getHexString()}`;
    expect(byName["compare-ribbon-fastest"]).toBe(hex(COMPARE_COLOURS.fastest));
    expect(byName["compare-ribbon-recommended"]).toBe(hex(COMPARE_COLOURS.recommended));
    expect(byName["compare-ribbon-unchecked"]).toBe(hex(COMPARE_COLOURS.unchecked));
    expect(byName["compare-ribbon-stop"]).toBe(hex(COMPARE_COLOURS.stop));
  });

  it("each half draws its own route on top where they share a street (V2 N-a)", () => {
    const order = (n: string) =>
      (layer.group.getObjectByName(`compare-ribbon-${n}`) as THREE.Mesh).renderOrder;
    // one view: the recommended route on top
    expect(order("fastest")).toBeLessThan(order("recommended"));
    layer.setSide("left");
    expect(order("fastest")).toBeGreaterThan(order("recommended"));
    expect(order("fastest")).toBeLessThan(order("unchecked"));
    expect(order("fastest")).toBeLessThan(order("stop"));
    layer.setSide("right");
    expect(order("fastest")).toBeLessThan(order("recommended"));
    layer.setSide("left");
    layer.setSide(null);
    expect(order("fastest")).toBeLessThan(order("recommended"));
  });

  it("two wheelchair heroes placed by distance along their routes", () => {
    expect(layer.heroes.fastest.variant).toBe("wheelchair");
    expect(layer.heroes.recommended.variant).toBe("wheelchair");
    const st = compareStateAt(tl, 12);
    layer.update(12, st.walkers);
    const [fx, fz] = layer.paths.fastest.pointAt(st.walkers.fastest);
    const [rx, rz] = layer.paths.recommended.pointAt(st.walkers.recommended);
    const a = layer.anchors();
    expect(a.walkers.fastest[0]).toBeCloseTo(fx);
    expect(a.walkers.fastest[2]).toBeCloseTo(fz);
    expect(a.walkers.recommended[0]).toBeCloseTo(rx);
    expect(a.walkers.recommended[2]).toBeCloseTo(rz);
  });

  it("anchors every route-tied beat on its side, the greeter beside the recommended route", () => {
    const a = layer.anchors();
    for (const id of [
      "tag-kerb",
      "tag-covered",
      "tag-incline",
      "tag-rest",
      "tag-unchecked",
      "arrive",
      "greeting",
    ])
      expect(a.pois[id]?.side, id).toBe("R");
    for (const id of ["tag-stop", "tag-fastest"]) expect(a.pois[id]?.side, id).toBe("L");
    expect(a.unchecked).not.toBeNull();
    const g = a.pois.greeting?.p as [number, number, number];
    const [gx, gz] = layer.paths.recommended.pointAt(tl.greetingAtM);
    expect(Math.hypot(g[0] - gx, g[2] - gz)).toBeGreaterThan(2);
    expect(Math.hypot(g[0] - gx, g[2] - gz)).toBeLessThan(5);
  });

  it("route points cover both routes for the overview box", () => {
    expect(layer.routePoints(10)).toHaveLength(22);
  });
});

describe("wheelchair heroes with an adopted (preloaded) model", () => {
  it("tints both at once although onReady is never called, and restores before the hero is disposed", async () => {
    const baju = new THREE.Color("#8a63cc");
    const order: string[] = [];
    const meshes: THREE.Mesh[] = [];
    const originals: THREE.BufferGeometry[] = [];
    const fake = (() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
      g.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array([baju.r, baju.g, baju.b]), 3),
      );
      const mesh = new THREE.Mesh(g);
      meshes.push(mesh);
      originals.push(g);
      const root = new THREE.Group();
      root.add(mesh);
      const model = { object3d: root };
      // an adopted spare: a GLB from the start, `ready` resolved, onReady never called
      return {
        object3d: root,
        ready: Promise.resolve(true),
        variant: "wheelchair",
        kind: () => "glb",
        model: () => model,
        setPose: () => {},
        play: () => {},
        setGround: () => {},
        contacts: () => [],
        dispose: () => order.push(mesh.geometry === g ? "dispose:restored" : "dispose:tinted"),
      };
    }) as unknown as NonNullable<Parameters<typeof createCompareLayer>[0]["createHero"]>;
    const c = playable();
    const layer = createCompareLayer({
      payload: c,
      timeline: buildCompareTimeline(c),
      frame: createFrame([101.5, 3.18]),
      createHero: fake,
    });
    expect(meshes).toHaveLength(2);
    const colourOf = (m: THREE.Mesh) => {
      const a = m.geometry.getAttribute("color");
      return `#${new THREE.Color(a.getX(0), a.getY(0), a.getZ(0)).getHexString()}`;
    };
    const hex = (h: string) => `#${new THREE.Color(h).getHexString()}`;
    expect(colourOf(meshes[0] as THREE.Mesh)).toBe(hex(SHIRTS.fastest));
    expect(colourOf(meshes[1] as THREE.Mesh)).toBe(hex(SHIRTS.recommended));
    await Promise.resolve();
    await Promise.resolve();
    // `ready` resolving later tints nothing twice
    expect(meshes[0]?.geometry).not.toBe(originals[0]);
    layer.dispose();
    expect(order).toEqual(["dispose:restored", "dispose:restored"]);
    expect(meshes[0]?.geometry).toBe(originals[0]);
  });
});

describe("stop edge length", () => {
  it("reads the segment's length_m, else 12 m", () => {
    const c = playable();
    const segs = c.fastest.segments;
    expect(stopEdgeM(c.fastest, "rt-fast-e2")).toBe(STOP_EDGE_M);
    const withLen = { ...c.fastest, segments: segs.map((s) => ({ ...s, length_m: 7.5 })) };
    expect(stopEdgeM(withLen, "rt-fast-e2")).toBe(7.5);
  });
});

describe("segment metres (roadside offset)", () => {
  it("places each segment along the route by its length, scaled to the route length", () => {
    const c = playable();
    const n = c.fastest.segments.length;
    const segs = c.fastest.segments.map((s) => ({ ...s, length_m: 10, type: "street" }));
    const m = segmentMetres({ ...c.fastest, segments: segs }, 20 * n);
    expect(m?.[0]).toEqual([0, 20]);
    expect(m?.at(-1)?.[1]).toBeCloseTo(20 * n);
  });

  it("an older payload without lengths gets no offset", () => {
    expect(segmentMetres(playable().fastest, 100)).toBeNull();
  });

  it("a hero walking a street segment stands off the centre line", () => {
    const c = playable();
    const typed = (r: typeof c.fastest) => ({
      ...r,
      segments: r.segments.map((s) => ({ ...s, length_m: 10, type: "street" })),
    });
    const frame = createFrame(c.recommended.coordinates[0] as [number, number]);
    const base = createCompareLayer({ payload: c, timeline: buildCompareTimeline(c), frame });
    const off = createCompareLayer({
      payload: { ...c, fastest: typed(c.fastest), recommended: typed(c.recommended) },
      timeline: buildCompareTimeline(c),
      frame,
    });
    base.update(5, { fastest: 20, recommended: 20 });
    off.update(5, { fastest: 20, recommended: 20 });
    const a = base.anchors().walkers.recommended;
    const b = off.anchors().walkers.recommended;
    expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeGreaterThan(3);
    base.dispose();
    off.dispose();
  });
});
