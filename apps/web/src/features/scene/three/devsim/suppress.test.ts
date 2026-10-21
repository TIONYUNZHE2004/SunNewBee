import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { Placement } from "../assets/fit";
import { createFrame } from "../frame";
import {
  PARCEL_EDGE_M,
  parcelPolys,
  parcelSuppress,
  suppressKits,
  suppressTracks,
} from "./suppress";

const P = plan as unknown as DevelopmentPlan;
const frame = createFrame([101.5076, 3.1794]);
const sq = (x0: number, y0: number, d: number) => [
  [x0, y0],
  [x0 + d, y0],
  [x0 + d, y0 + d],
  [x0, y0 + d],
  [x0, y0],
];
const lc = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { class: "construction", osm: P.site.parcel_id },
      geometry: { type: "Polygon", coordinates: [sq(101.507, 3.179, 0.001)] },
    },
    {
      type: "Feature",
      properties: { class: "construction", osm: "way/1" },
      geometry: { type: "Polygon", coordinates: [sq(101.51, 3.18, 0.001)] },
    },
  ],
};
const pl = (asset: string, x: number, z: number): Placement =>
  ({
    id: `${asset}${x}`,
    asset,
    variant: "v",
    x,
    z,
    yaw: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    palette: ["#000", "#000", "#000"],
  }) as Placement;

describe("devsim suppresses the city's construction dressing on the parcel", () => {
  it("finds only the plan's parcel and filters construction props inside it", () => {
    const polys = parcelPolys(P, lc, frame);
    expect(polys).toHaveLength(1);
    const [cx, cz] = frame.toLocal(101.5075, 3.1795);
    const [ox, oz] = frame.toLocal(101.5105, 3.1805);
    const inside = (x: number, z: number) => Math.hypot(x - cx, z - cz) < 30;
    const kits = new Map([
      ["construction/a", [pl("construction", cx, cz), pl("construction", ox, oz)]],
      ["trees/a", [pl("trees", cx, cz)]],
    ]);
    const out = suppressKits(kits, inside);
    expect(out.get("construction/a")?.map((p) => p.x)).toEqual([ox]);
    expect(out.get("trees/a")).toHaveLength(1);
    expect(suppressKits(kits, null)).toBe(kits);
  });

  it("hoardings standing on the parcel outline are suppressed too (the 30 s grey panels)", () => {
    const polys = parcelPolys(P, lc, frame);
    const on = parcelSuppress(polys);
    const ring = polys[0]?.[0] as [number, number][];
    let n = 0;
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i] as [number, number];
      const c = ring[i + 1] as [number, number];
      // the city's hoardings: every 6 m along each edge, exactly on it
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let d = 3; d < len; d += 6) {
        const x = a[0] + ((c[0] - a[0]) * d) / len;
        const z = a[1] + ((c[1] - a[1]) * d) / len;
        expect(on(x, z)).toBe(true);
        // and just outside the outline: still the parcel's; 3 m out: not
        const nx = (c[1] - a[1]) / len;
        const nz = -(c[0] - a[0]) / len;
        const o1 = on(x + nx * (PARCEL_EDGE_M - 0.2), z + nz * (PARCEL_EDGE_M - 0.2));
        const o2 = on(x - nx * (PARCEL_EDGE_M - 0.2), z - nz * (PARCEL_EDGE_M - 0.2));
        expect(o1 && o2).toBe(true);
        const f1 = on(x + nx * 3, z + nz * 3);
        const f2 = on(x - nx * 3, z - nz * 3);
        expect(f1 !== f2).toBe(true); // one side inside, the other 3 m out
        n++;
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it("drops earth-track segments inside, keeps identity when nothing is dropped", () => {
    const tracks = new Float32Array([0, 0, 2, 0, 100, 100, 102, 100]);
    const near0 = (x: number, z: number) => Math.hypot(x, z) < 10;
    expect([...suppressTracks(tracks, near0)]).toEqual([100, 100, 102, 100]);
    const none = () => false;
    expect(suppressTracks(tracks, none)).toBe(tracks);
  });
});
