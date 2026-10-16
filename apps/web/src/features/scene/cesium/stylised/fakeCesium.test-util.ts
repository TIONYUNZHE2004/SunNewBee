import { vi } from "vitest";

/**
 * Minimal fake of the Cesium surface used by ground.ts / props.ts: records primitive and material
 * constructions and every uniform write. Primitives start not ready (as with asynchronous: true).
 */
export function fakeCesium() {
  const primitives: FakePrimitive[] = [];
  const materials: FakeMaterial[] = [];
  const geometries: { kind: string; options: Record<string, unknown> }[] = [];
  class FakePrimitive {
    destroyed = false;
    ready = false;
    kind = "Primitive";
    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    isDestroyed = () => this.destroyed;
    constructor(public options: Record<string, unknown>) {
      primitives.push(this);
    }
  }
  class FakeClassificationPrimitive extends FakePrimitive {
    override kind = "ClassificationPrimitive";
    /** Per-instance attributes by id, like Cesium (only once ready). */
    attrs = new Map<string, { color?: unknown }>();
    getGeometryInstanceAttributes = vi.fn((id: string) => {
      if (!this.ready) throw new Error("not ready");
      const a = this.attrs.get(id) ?? {};
      this.attrs.set(id, a);
      return a;
    });
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
  class Cartesian3 {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
    static fromDegreesArray = (a: number[]) => a.map((v) => ({ deg: v }));
    static fromDegrees = (lon: number, lat: number, h = 0) => ({ lon, lat, h });
  }
  const C = {
    Primitive: FakePrimitive,
    ClassificationPrimitive: FakeClassificationPrimitive,
    PerInstanceColorAppearance: Plain,
    ColorGeometryInstanceAttribute: {
      fromColor: (c: { css: string }) => ({ value: c.css }),
      toValue: (c: { css: string }) => `rgba:${c.css}`,
    },
    VertexFormat: { POSITION_ONLY: { position: true } },
    GeometryInstance: Plain,
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
      MaterialSupport: { BASIC: { vertexFormat: { basic: true } } },
    }),
    Material: Object.assign(
      // biome-ignore lint/complexity/useArrowFunction: called with `new`, must stay a function
      function (o: { fabric: { uniforms: Record<string, unknown> } }) {
        return new FakeMaterial("fabric", o.fabric.uniforms);
      },
      { fromType: (type: string, u: Record<string, unknown>) => new FakeMaterial(type, u) },
    ),
    Color: { fromCssColorString: (c: string) => ({ css: c }) },
    ClassificationType: { TERRAIN: 0, BOTH: 2 },
    ShadowMode: { ENABLED: 1, CAST_ONLY: 2 },
    CornerType: { ROUNDED: 0 },
    Cartesian3,
    Matrix4: {
      fromScale: () => ({}),
      fromRotationTranslation: () => ({}),
      multiply: () => ({}),
      multiplyByMatrix3: () => ({}),
      multiplyByScale: () => ({}),
    },
    Matrix3: { fromRotationZ: () => ({}) },
    Transforms: { eastNorthUpToFixedFrame: () => ({}) },
  };
  return { C, primitives, materials, geometries };
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
