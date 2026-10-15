import { describe, expect, it, vi } from "vitest";
import { buildBuildingPrimitives, type CesiumLike } from "./buildingsPrimitive";
import { groupByClass, toBuildings } from "./model";
import { paletteFor } from "./palette";

const sq = (x: number, y: number, d = 0.0003) => [
  [
    [x, y],
    [x + d, y],
    [x + d, y + d],
    [x, y + d],
    [x, y],
  ],
];
const feature = (id: string, x: number, h: number) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: sq(x, 3.18) },
  properties: { id, height_m: h },
});

/** Minimal fake of the Cesium surface the builder uses: records constructions and uniform writes. */
function fakeCesium() {
  const primitives: FakePrimitive[] = [];
  const materials: FakeMaterial[] = [];
  class FakePrimitive {
    destroyed = false;
    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    isDestroyed = () => this.destroyed;
    constructor(public options: Record<string, unknown>) {
      primitives.push(this);
    }
  }
  class FakeMaterial {
    uniforms: Record<string, unknown>;
    writes: string[] = [];
    destroy = vi.fn();
    isDestroyed = () => false;
    constructor(options: { fabric: { uniforms: Record<string, unknown> } }) {
      const writes = this.writes;
      // Record every uniform assignment, like Cesium's uniform setters.
      this.uniforms = new Proxy(
        { ...options.fabric.uniforms },
        {
          set(target, key, value) {
            writes.push(String(key));
            target[key as string] = value;
            return true;
          },
        },
      );
      materials.push(this);
    }
  }
  class Plain {
    constructor(public options?: unknown) {}
  }
  const C = {
    Primitive: FakePrimitive,
    GeometryInstance: Plain,
    Geometry: Plain,
    GeometryAttribute: Plain,
    ComponentDatatype: { DOUBLE: 5130, FLOAT: 5126 },
    PrimitiveType: { TRIANGLES: 4 },
    BoundingSphere: { fromVertices: () => ({}) },
    MaterialAppearance: Object.assign(Plain, {
      MaterialSupport: { TEXTURED: { vertexFormat: {} } },
    }),
    Material: FakeMaterial,
    Color: { fromCssColorString: (c: string) => ({ css: c }) },
    Cartesian2: class {
      constructor(
        public x = 0,
        public y = 0,
      ) {}
    },
    Cartesian3: class {
      constructor(
        public x = 0,
        public y = 0,
        public z = 0,
      ) {}
    },
    PolygonPipeline: {
      triangulate: (pts: unknown[]) => [0, 1, 2, 0, 2, 3].slice(0, (pts.length - 2) * 3),
    },
  } as unknown as CesiumLike;
  return { C, primitives, materials };
}

const classesOf = (fc: unknown) => groupByClass(toBuildings(fc).buildings);
const twoClasses = () =>
  classesOf({
    features: [feature("a", 101.5, 4), feature("b", 101.501, 4), feature("c", 101.502, 60)],
  });

describe("buildBuildingPrimitives", () => {
  it("creates one primitive per non-empty class and adds each to the collection", () => {
    const { C, primitives } = fakeCesium();
    const classes = twoClasses();
    classes.set("empty", []);
    const add = vi.fn();
    const out = buildBuildingPrimitives(C, classes, paletteFor("night"), "night", {
      add,
      remove: vi.fn(),
    });
    expect(classes.size).toBe(3);
    expect(primitives).toHaveLength(2);
    expect(out.primitives).toHaveLength(2);
    expect(add).toHaveBeenCalledTimes(2);
    for (const p of primitives) {
      // Custom geometry is synchronous-only in Cesium; st carries window units, so no compression.
      expect(p.options).toMatchObject({
        asynchronous: false,
        compressVertices: false,
        allowPicking: false,
      });
    }
  });

  it("setTheme mutates material uniforms in place and never creates primitives", () => {
    const { C, primitives, materials } = fakeCesium();
    const out = buildBuildingPrimitives(C, twoClasses(), paletteFor("night"), "night");
    const n = primitives.length;
    const glowAt = () => materials.map((m) => m.uniforms.glow);
    expect(glowAt()).toEqual([1, 1]);
    out.setTheme("day");
    expect(glowAt()).toEqual([0, 0]);
    expect(materials[0]!.uniforms.wallWarm).toEqual({ css: paletteFor("day").wall.warm });
    out.setTheme("night");
    expect(glowAt()).toEqual([1, 1]);
    expect(materials[0]!.uniforms.wallWarm).toEqual({ css: paletteFor("night").wall.warm });
    expect(primitives).toHaveLength(n);
    expect(materials).toHaveLength(n);
    for (const m of materials) expect(m.writes).toContain("litA");
  });

  it("destroy removes and destroys every primitive and is idempotent", () => {
    const { C, primitives, materials } = fakeCesium();
    const remove = vi.fn();
    const out = buildBuildingPrimitives(C, twoClasses(), paletteFor("day"), "day", {
      add: vi.fn(),
      remove,
    });
    out.destroy();
    out.destroy();
    expect(remove).toHaveBeenCalledTimes(2);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    for (const m of materials) expect(m.destroy).toHaveBeenCalledTimes(1);
    expect(out.primitives).toHaveLength(0);
    // setTheme after destroy is a no-op, not a throw.
    expect(() => out.setTheme("night")).not.toThrow();
  });

  it("an empty class map yields no primitives and no throw", () => {
    const { C, primitives } = fakeCesium();
    const out = buildBuildingPrimitives(C, new Map(), paletteFor("night"), "night");
    expect(out.primitives).toEqual([]);
    expect(primitives).toHaveLength(0);
    expect(() => {
      out.setTheme("day");
      out.destroy();
    }).not.toThrow();
  });
});
