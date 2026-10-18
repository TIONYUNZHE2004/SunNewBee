import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { planSigns } from "./signPlan";

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
});
