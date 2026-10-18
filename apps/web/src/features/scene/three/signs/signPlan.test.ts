import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { type Box, boxAround, seedFor } from "../stream/area";
import { tileAt } from "../stream/tiles";
import { httpUrl, planSigns } from "./signPlan";

const O: [number, number] = [101.5, 3.18];
const frame = createFrame(O);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
// A 20 m (x) by 10 m (z) building at x 0..20, z 0..10, 12 m high. The street runs along z = 30.
const building = (id = "b1", h = 12) => ({
  type: "Feature",
  properties: { id, height_m: h, kind: "retail" },
  geometry: {
    type: "Polygon",
    coordinates: [[ll(0, 0), ll(20, 0), ll(20, 10), ll(0, 10), ll(0, 0)]],
  },
});
const lineAt = (z: number) => ({
  type: "Feature",
  properties: { id: "s1", type: "footway" },
  geometry: { type: "LineString", coordinates: [ll(-50, z), ll(80, z)] },
});
const sign = (over: Record<string, unknown> = {}) => ({
  type: "Feature",
  properties: {
    id: "sign-1",
    text: "Central Mart",
    building_id: "b1",
    source_url: "https://www.openstreetmap.org/way/1",
    source_label: "OpenStreetMap",
    as_of: "2026-10-17",
    ...over,
  },
  geometry: { type: "Point", coordinates: ll(10, 5) },
});
const run = (signs: unknown[], b: unknown[] = [building()]) =>
  planSigns(fc(...signs), fc(...b), fc(lineAt(30)), frame);

describe("planSigns", () => {
  it("puts the sign 0.15 m outside the facade that faces the street, at y = min(4.2, 0.45 h)", () => {
    const { signs, dropped } = run([sign()]);
    expect(dropped).toEqual({ no_source: 0, no_building: 0 });
    const s = signs[0]!;
    // the street is at z = 30, so the facade is the z = 10 edge; local z grows toward the street
    expect(s.z).toBeCloseTo(10.15, 1);
    expect(s.x).toBeCloseTo(10, 1);
    expect(s.y).toBeCloseTo(4.2, 6); // 0.45 * 12 = 5.4, capped at 4.2
    expect(s.yaw).toBeCloseTo(0, 6); // normal +z
    expect(s.source).toEqual({
      url: "https://www.openstreetmap.org/way/1",
      label: "OpenStreetMap",
      asOf: "2026-10-17",
    });
  });

  it("uses 0.45 h under the cap", () => {
    expect(run([sign()], [building("b1", 6)]).signs[0]!.y).toBeCloseTo(2.7, 6);
  });

  it("faces away from the building when the street is on the other side", () => {
    const { signs } = planSigns(fc(sign()), fc(building()), fc(lineAt(-30)), frame);
    expect(signs[0]!.z).toBeCloseTo(-0.15, 1);
    expect(Math.abs(signs[0]!.yaw)).toBeCloseTo(Math.PI, 6);
  });

  it("clamps the width to 0.45 per character, at least 2 m, at most 80% of the facade", () => {
    const w = (text: string) => run([sign({ text })]).signs[0]!.widthM;
    expect(w("Shop")).toBe(2); // 4 x 0.45 = 1.8, raised to the 2 m floor
    expect(w("A".repeat(20))).toBeCloseTo(9, 6);
    expect(w("A".repeat(60))).toBeCloseTo(16, 6); // 0.8 * 20 m
  });

  it("drops a sign without text, source_url or as_of, and counts it", () => {
    const { signs, dropped } = run([
      sign({ source_url: "" }),
      sign({ as_of: undefined }),
      sign({ text: "  " }),
      sign({ id: "ok" }),
    ]);
    expect(signs.map((s) => s.id)).toEqual(["ok"]);
    expect(dropped.no_source).toBe(3);
  });

  it("drops a sign whose building is missing or unknown, and counts it", () => {
    const { signs, dropped } = run([
      sign({ building_id: undefined }),
      sign({ building_id: "nope" }),
    ]);
    expect(signs).toEqual([]);
    expect(dropped.no_building).toBe(2);
  });

  it("still places the sign on a facade when there is no street", () => {
    const { signs } = planSigns(fc(sign()), fc(building()), fc(), frame);
    expect(signs).toHaveLength(1);
  });

  it("drops a sign whose source is not an http(s) link (honesty: no usable source)", () => {
    const { signs, dropped } = run([
      sign({ source_url: "javascript:alert(1)" }),
      sign({ source_url: "data:text/html,x" }),
      sign({ source_url: "not a url" }),
      sign({ id: "ok" }),
    ]);
    expect(signs.map((s) => s.id)).toEqual(["ok"]);
    expect(dropped.no_source).toBe(3);
  });

  it("plans only signs inside the box (the P3 circle as a 2,400 m box) and counts the rest", () => {
    const far = { ...sign({ id: "far" }), geometry: { type: "Point", coordinates: ll(5000, 0) } };
    const r = planSigns(fc(sign(), far), fc(building()), fc(lineAt(30)), frame, {
      area: { box: boxAround(0, 0, 1200), seed: "t" },
    });
    expect(r.signs.map((s) => s.id)).toEqual(["sign-1"]);
    expect(r.outside).toBe(1);
  });

  it("box membership is half-open on the sign point", () => {
    // The sign point is at (10, 5).
    const at = (box: Box) =>
      planSigns(fc(sign()), fc(building()), fc(lineAt(30)), frame, { area: { box, seed: "t" } })
        .signs.length;
    expect(at({ x0: 10, z0: 5, x1: 20, z1: 15 })).toBe(1);
    expect(at({ x0: 0, z0: 0, x1: 10, z1: 15 })).toBe(0);
    expect(at({ x0: 0, z0: 0, x1: 20, z1: 5 })).toBe(0);
  });

  it("caps the signs of a box, nearest to the box centre first", () => {
    const many = [0, 1, 2, 3].map((i) => ({
      ...sign({ id: `s${i}`, building_id: `b${i}` }),
      geometry: { type: "Point", coordinates: ll(10 + i * 40, 5) },
    }));
    const bs = [0, 1, 2, 3].map((i) => ({
      ...building(`b${i}`),
      geometry: {
        type: "Polygon",
        coordinates: [
          [ll(i * 40, 0), ll(i * 40 + 20, 0), ll(i * 40 + 20, 10), ll(i * 40, 10), ll(i * 40, 0)],
        ],
      },
    }));
    const r = planSigns(fc(...many), fc(...bs), fc(lineAt(30)), frame, {
      area: { box: { x0: 0, z0: -100, x1: 200, z1: 100 }, seed: "t" },
      cap: 2,
    });
    // Box centre x = 100: s2 (x 90) and s1 (x 50) / s3 (x 130) — s2 then the nearer of s1, s3.
    expect(r.signs.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  describe("per tile box", () => {
    const xs = [-260, -130, -5, 0, 4, 130, 249];
    const zs = [-200, -1, 0, 120];
    const pts = xs.flatMap((x) => zs.map((z) => [x, z] as [number, number]));
    const signs = pts.map(([x, z], i) => ({
      ...sign({ id: `s${i}`, building_id: `b${i}` }),
      geometry: { type: "Point", coordinates: ll(x + 5, z + 2) },
    }));
    const bs = pts.map(([x, z], i) => ({
      ...building(`b${i}`),
      geometry: {
        type: "Polygon",
        coordinates: [[ll(x, z), ll(x + 10, z), ll(x + 10, z + 4), ll(x, z + 4), ll(x, z)]],
      },
    }));
    const Q: Box[] = [
      { x0: -250, z0: -250, x1: 0, z1: 0 },
      { x0: 0, z0: -250, x1: 250, z1: 0 },
      { x0: -250, z0: 0, x1: 0, z1: 250 },
      { x0: 0, z0: 0, x1: 250, z1: 250 },
    ];
    const U: Box = { x0: -250, z0: -250, x1: 250, z1: 250 };
    const ids = (box: Box, seed = "t") =>
      planSigns(fc(...signs), fc(...bs), fc(lineAt(30)), frame, { area: { box, seed } })
        .signs.map((s) => s.id)
        .sort();

    it("four tiles planned separately give exactly the signs of their union", () => {
      const parts = Q.flatMap((b, i) => ids(b, `q${i}`));
      const union = ids(U, "u");
      expect(union.length).toBeGreaterThan(15);
      expect(new Set(parts).size).toBe(parts.length);
      expect(parts.sort()).toEqual(union);
    });

    it("is deterministic per tile key", () => {
      const t = tileAt(1, 1);
      const a = { area: { box: t.box, seed: seedFor(t.key, "signs") } };
      const once = planSigns(fc(...signs), fc(...bs), fc(lineAt(30)), frame, a);
      expect(planSigns(fc(...signs), fc(...bs), fc(lineAt(30)), frame, a)).toEqual(once);
      expect(once.signs.length).toBeGreaterThan(0);
    });
  });

  it("httpUrl accepts http(s) only", () => {
    expect(httpUrl("https://a.org/x")).toBe("https://a.org/x");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("")).toBeNull();
  });
});
