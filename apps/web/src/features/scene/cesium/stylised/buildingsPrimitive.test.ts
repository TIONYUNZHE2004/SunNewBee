import { describe, expect, it, vi } from "vitest";
import {
  buildBuildingPrimitives,
  type CesiumLike,
  chunkBuildings,
  WINDOW_SHADER,
} from "./buildingsPrimitive";
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
    ShadowMode: { ENABLED: 1, CAST_ONLY: 2 },
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
  it("puts every class into one primitive with one material (the draw count is not per class)", () => {
    const { C, primitives, materials } = fakeCesium();
    const classes = twoClasses();
    classes.set("empty", []);
    const add = vi.fn();
    const out = buildBuildingPrimitives(C, classes, paletteFor("night"), {
      add,
      remove: vi.fn(),
    });
    expect(classes.size).toBe(3);
    expect(primitives).toHaveLength(1);
    expect(materials).toHaveLength(1);
    expect(out.primitives).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(1);
    for (const p of primitives) {
      // Custom geometry is synchronous-only in Cesium; st carries window units, so no compression.
      expect(p.options).toMatchObject({
        asynchronous: false,
        compressVertices: false,
        allowPicking: false,
        shadows: 2, // CAST_ONLY: faces never self-shadow (acne)
      });
    }
  });

  it("setPalette mutates material uniforms in place and never creates primitives", () => {
    const { C, primitives, materials } = fakeCesium();
    const out = buildBuildingPrimitives(C, twoClasses(), paletteFor("night"));
    const n = primitives.length;
    const glowAt = () => materials.map((m) => m.uniforms.glow);
    expect(glowAt()).toEqual([1]);
    out.setPalette(paletteFor("day"), true);
    expect(glowAt()).toEqual([0]);
    expect(materials[0]!.uniforms.wall3).toEqual({ css: paletteFor("day").wall.t3 });
    out.setPalette(paletteFor("night"), true);
    expect(glowAt()).toEqual([1]);
    expect(materials[0]!.uniforms.wall3).toEqual({ css: paletteFor("night").wall.t3 });
    expect(primitives).toHaveLength(n);
    expect(materials).toHaveLength(n);
    for (const m of materials) expect(m.writes).toContain("litA");
  });

  it("setTime writes the time uniform; a later setPalette keeps it", () => {
    const { C, materials } = fakeCesium();
    const out = buildBuildingPrimitives(C, twoClasses(), paletteFor("day"));
    expect(materials.map((m) => m.uniforms.time)).toEqual([0]);
    out.setTime(42);
    expect(materials.map((m) => m.uniforms.time)).toEqual([42]);
    out.setPalette(paletteFor("dusk"), true);
    expect(materials.map((m) => m.uniforms.time)).toEqual([42]);
    expect(materials[0]!.uniforms.cloudShadow).toBe(0.15);
    out.setPalette(paletteFor("night"), true);
    expect(materials[0]!.uniforms.cloudShadow).toBe(0);
  });

  it("windows flip about 3% of lit cells every 20 s, only while glow is on", () => {
    expect(WINDOW_SHADER).toContain("float epoch = floor(time / 20.0);");
    expect(WINDOW_SHADER).toMatch(
      /step\(0\.97, tl_hash\(cell \+ epoch \* 13\.0\)\) \* step\(0\.5, glow\)/,
    );
    expect(WINDOW_SHADER).toContain("float isLit = abs(step(tl_hash(cell), litFrac) - flip);");
    // Day has glow 0, so the flip term is always 0 and the lit set is unchanged.
    expect(paletteFor("day").glow).toBe(0);
  });

  it("the window shader shades roofs and walls with the cloud shadow", () => {
    expect(WINDOW_SHADER).toContain(
      "vec3 positionWC = (czm_inverseView * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;",
    );
    expect(WINDOW_SHADER.match(/\* cloud\b/g)?.length).toBe(2);
  });

  it("passes six wall and roof tones, the shopfront and the glass sky; the shader reads them", () => {
    const { C, materials } = fakeCesium();
    buildBuildingPrimitives(C, twoClasses(), paletteFor("dusk"));
    const u = materials[0]!.uniforms;
    const p = paletteFor("dusk");
    const want = [
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => [`wall${i}`, `roof${i}`]),
      "shopfront",
      "glassSky0",
      "glassSky1",
    ];
    for (const name of want) {
      expect(u).toHaveProperty(name);
      expect(WINDOW_SHADER).toMatch(new RegExp(`\\b${name}\\.rgb\\b`));
    }
    expect(u.roof5).toEqual({ css: p.roof.t5 });
    expect(u.shopfront).toEqual({ css: p.shopfront });
    expect(u.glassSky1).toEqual({ css: p.glassSky[1] });
    // Every `<name>.rgb` the shader samples is a uniform the material provides.
    const sampled = new Set(
      [...WINDOW_SHADER.matchAll(/\b([a-zA-Z]\w*)\.rgb\b/g)].map((m) => m[1]),
    );
    for (const name of sampled) if (name !== "p3") expect(u).toHaveProperty(name!);
    expect(u).not.toHaveProperty("wallWarm");
  });

  it("destroy removes and destroys every primitive and is idempotent", () => {
    const { C, primitives, materials } = fakeCesium();
    const remove = vi.fn();
    const out = buildBuildingPrimitives(C, twoClasses(), paletteFor("day"), {
      add: vi.fn(),
      remove,
    });
    out.destroy();
    out.destroy();
    expect(remove).toHaveBeenCalledTimes(1);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    for (const m of materials) expect(m.destroy).toHaveBeenCalledTimes(1);
    expect(out.primitives).toHaveLength(0);
    // setPalette after destroy is a no-op, not a throw.
    expect(() => out.setPalette(paletteFor("night"), true)).not.toThrow();
  });

  it("splits into more primitives only past the vertex cap, all sharing the one material", () => {
    const { C, primitives, materials } = fakeCesium();
    const classes = twoClasses();
    const all = [...classes.values()].flat();
    const chunks = chunkBuildings(all, 1); // a cap below one building: one run per building
    expect(chunks).toHaveLength(3);
    expect(chunks.flat()).toEqual(all);
    expect(chunkBuildings(all)).toEqual([all]);
    buildBuildingPrimitives(C, classes, paletteFor("day"), undefined, 1);
    expect(primitives).toHaveLength(3);
    expect(materials).toHaveLength(1);
    const appearances = primitives.map(
      (p) => (p.options.appearance as { options: { material: unknown } }).options.material,
    );
    expect(new Set(appearances).size).toBe(1);
  });

  it("an empty class map yields no primitives and no throw", () => {
    const { C, primitives } = fakeCesium();
    const out = buildBuildingPrimitives(C, new Map(), paletteFor("night"));
    expect(out.primitives).toEqual([]);
    expect(primitives).toHaveLength(0);
    expect(() => {
      out.setPalette(paletteFor("day"), true);
      out.destroy();
    }).not.toThrow();
  });
});
