import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { Placement } from "../assets/fit";
import { createFrame } from "../frame";
import { parcelPolys, suppressKits, suppressTracks } from "./suppress";

const P = plan as DevelopmentPlan;
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

  it("drops earth-track segments inside, keeps identity when nothing is dropped", () => {
    const tracks = new Float32Array([0, 0, 2, 0, 100, 100, 102, 100]);
    const near0 = (x: number, z: number) => Math.hypot(x, z) < 10;
    expect([...suppressTracks(tracks, near0)]).toEqual([100, 100, 102, 100]);
    const none = () => false;
    expect(suppressTracks(tracks, none)).toBe(tracks);
  });
});
