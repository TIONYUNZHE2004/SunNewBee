import { vi } from "vitest";

/**
 * Minimal fake of the Cesium surface used by ground.ts / props.ts / sky.ts: records primitive and material
 * constructions and every uniform write. Primitives start not ready (as with asynchronous: true).
 */
export function fakeCesium() {
  const primitives: FakePrimitive[] = [];
  const materials: FakeMaterial[] = [];
  const geometries: { kind: string; options: Record<string, unknown> }[] = [];
  class FakePrimitive {
    destroyed = false;
    ready = false;
    show = true;
    kind = "Primitive";
    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    isDestroyed = () => this.destroyed;
    modelMatrix?: unknown;
    constructor(public options: Record<string, unknown>) {
      this.modelMatrix = options.modelMatrix;
      primitives.push(this);
    }
    /** Per-instance attributes by id, like Cesium (only once ready). */
    attrs = new Map<string, Record<string, unknown>>();
    getGeometryInstanceAttributes = vi.fn((id: string) => {
      if (!this.ready) throw new Error("not ready");
      const a = this.attrs.get(id) ?? {};
      this.attrs.set(id, a);
      return a;
    });
  }
  class FakeClassificationPrimitive extends FakePrimitive {
    override kind = "ClassificationPrimitive";
  }
  class FakeGroundPrimitive extends FakePrimitive {
    override kind = "GroundPrimitive";
  }
  class FakeMaterial {
    uniforms: Record<string, unknown>;
    writes: string[] = [];
    destroy = vi.fn();
    isDestroyed = () => false;
    constructor(
      public type: string,
      uniforms: Record<string, unknown>,
    ) {
      const writes = this.writes;
      this.uniforms = new Proxy(
        { ...uniforms },
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
  const geom = (kind: string) =>
    class {
      constructor(public options: Record<string, unknown> = {}) {
        geometries.push({ kind, options });
      }
    };
  class Plain {
    constructor(public options?: unknown) {}
  }
  class FakeColor {
    constructor(public css: string) {}
    withAlpha(a: number) {
      return { css: this.css, alpha: a };
    }
  }
  /** Records the last translation written into it (`t`), so tests can follow moving primitives. */
  class Matrix4 {
    t?: number[];
    static fromScale = () => new Matrix4();
    static fromRotationTranslation = () => new Matrix4();
    static fromTranslation = (v: Cartesian3, r = new Matrix4()) =>
      Object.assign(r, { t: [v.x, v.y, v.z] });
    static multiply = () => new Matrix4();
    static multiplyByMatrix3 = (_m: Matrix4, _r: unknown, out = new Matrix4()) => out;
    static multiplyByScale = (_m: Matrix4, _s: unknown, out = new Matrix4()) => out;
    static multiplyByTranslation = (_m: Matrix4, v: Cartesian3, out = new Matrix4()) =>
      Object.assign(out, { t: [v.x, v.y, v.z] });
    /** Identity rotation: ENU vectors come back unchanged. */
    static multiplyByPointAsVector = (_m: Matrix4, v: Cartesian3, out = new Cartesian3()) =>
      Object.assign(out, { x: v.x, y: v.y, z: v.z });
  }
  class Cartesian3 {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
    static fromDegreesArray = (a: number[]) => a.map((v) => ({ deg: v }));
    static fromDegrees = (lon: number, lat: number, h = 0) => ({ lon, lat, h });
  }
  const imageryLayers: FakeImageryLayer[] = [];
  /** ImageryLayer: records its provider; alpha and show like Cesium's defaults. */
  class FakeImageryLayer {
    alpha = 1;
    show = true;
    constructor(public provider: FakeProvider) {
      imageryLayers.push(this);
    }
  }
  const RAD = Math.PI / 180;
  /** Geographic tiling like Cesium's: level 0 is two 180-degree tiles; rectangles in radians. */
  class GeographicTilingScheme {
    rectangle = { deg: [-180, -90, 180, 90] };
    tileXYToRectangle(x: number, y: number, level: number) {
      const d = 180 / 2 ** level;
      return {
        west: (-180 + x * d) * RAD,
        east: (-180 + (x + 1) * d) * RAD,
        north: (90 - y * d) * RAD,
        south: (90 - (y + 1) * d) * RAD,
      };
    }
  }
  const C = {
    ImageryLayer: FakeImageryLayer,
    GeographicTilingScheme,
    Rectangle: {
      fromDegrees: (west: number, south: number, east: number, north: number) => ({
        deg: [west, south, east, north],
      }),
    },
    Event: class {
      listeners = [];
    },
    Math: { toDegrees: (r: number) => r / RAD },
    Primitive: FakePrimitive,
    ClassificationPrimitive: FakeClassificationPrimitive,
    GroundPrimitive: FakeGroundPrimitive,
    PerInstanceColorAppearance: Plain,
    ColorGeometryInstanceAttribute: {
      fromColor: (c: { css: string }) => ({ value: c.css }),
      toValue: (c: { css: string }) => `rgba:${c.css}`,
    },
    VertexFormat: { POSITION_ONLY: { position: true } },
    GeometryInstance: Plain,
    GeometryInstanceAttribute: Plain,
    GeometryOffsetAttribute: { ALL: 2 },
    CorridorGeometry: geom("corridor"),
    PolygonGeometry: geom("polygon"),
    PolygonHierarchy: Plain,
    EllipsoidGeometry: geom("ellipsoid"),
    CylinderGeometry: geom("cylinder"),
    BoxGeometry: Object.assign(geom("box"), {
      fromDimensions: (o: Record<string, unknown>) => {
        geometries.push({ kind: "box", options: o });
        return { box: true };
      },
    }),
    EllipsoidSurfaceAppearance: Object.assign(Plain, { VERTEX_FORMAT: { st: true } }),
    MaterialAppearance: Object.assign(Plain, {
      MaterialSupport: {
        BASIC: { vertexFormat: { basic: true } },
        TEXTURED: { vertexFormat: { textured: true } },
      },
    }),
    Geometry: Plain,
    GeometryAttribute: Plain,
    ComponentDatatype: { DOUBLE: 5130, FLOAT: 5126 },
    PrimitiveType: { TRIANGLES: 4 },
    BoundingSphere: { fromVertices: () => ({}) },
    Material: class extends FakeMaterial {
      constructor(o: { fabric: { uniforms: Record<string, unknown> } }) {
        super("fabric", o.fabric.uniforms);
      }
      static fromType = (type: string, u: Record<string, unknown>) => new FakeMaterial(type, u);
    },
    Color: {
      fromCssColorString: (c: string) => new FakeColor(c),
    },
    EllipseGeometry: geom("ellipse"),
    DistanceDisplayCondition: Plain,
    DistanceDisplayConditionGeometryInstanceAttribute: {
      fromDistanceDisplayCondition: (c: unknown) => ({ ddc: c }),
    },
    ClassificationType: { TERRAIN: 0, BOTH: 2 },
    ShadowMode: { DISABLED: 0, ENABLED: 1, CAST_ONLY: 2 },
    CornerType: { ROUNDED: 0 },
    Cartesian3,
    Matrix4,
    Matrix3: { fromRotationZ: () => ({}) },
    Transforms: { eastNorthUpToFixedFrame: () => ({}) },
  };
  return { C, primitives, materials, geometries, imageryLayers };
}

/** What decalProvider returns, as far as tests read it. */
export interface FakeProvider {
  maximumLevel: number;
  hasAlphaChannel: boolean;
  rectangle: { deg: number[] };
  requestImage(x: number, y: number, level: number): Promise<unknown> | undefined;
}

/** Fake scene.imageryLayers: an ordered list with Cesium's add(layer, index) / remove semantics. */
export function fakeLayers<L>() {
  const list: L[] = [];
  return {
    list,
    add: vi.fn((l: L, index?: number) => {
      list.splice(index ?? list.length, 0, l);
    }),
    remove: vi.fn((l: L, _destroy?: boolean) => {
      const i = list.indexOf(l);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    }),
    indexOf: (l: L) => list.indexOf(l),
    contains: (l: L) => list.includes(l),
  };
}

/** A CanvasRenderingContext2D recorder: every call and style assignment, in order. */
export function recorder2d() {
  const ops: string[] = [];
  const ctx = {
    ops,
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    beginPath: () => ops.push("begin"),
    moveTo: (x: number, y: number) => ops.push(`M${x.toFixed(1)},${y.toFixed(1)}`),
    lineTo: (x: number, y: number) => ops.push(`L${x.toFixed(1)},${y.toFixed(1)}`),
    closePath: () => ops.push("close"),
    arc: (x: number, y: number, r: number) =>
      ops.push(`arc${x.toFixed(1)},${y.toFixed(1)},${r.toFixed(2)}`),
    fill(rule?: string) {
      ops.push(`fill:${String(this.fillStyle)}${rule ? `:${rule}` : ""}`);
    },
    stroke() {
      ops.push(`stroke:${String(this.strokeStyle)}@${this.lineWidth.toFixed(2)}`);
    },
  };
  return ctx;
}

/** Fake scene.postRender: `fire()` runs every live listener once. */
export function fakeEvent() {
  const listeners = new Set<() => void>();
  return {
    listeners,
    addEventListener: vi.fn((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    fire: () => {
      for (const cb of [...listeners]) cb();
    },
  };
}

export function fakeCollection() {
  return { add: vi.fn((p: unknown) => p), remove: vi.fn(() => true), lowerToBottom: vi.fn() };
}
