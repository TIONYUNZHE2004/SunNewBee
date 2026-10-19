import { describe, expect, it } from "vitest";
import type { Placement } from "../assets/fit";
import type { ActiveTile, TileContent } from "../stream/streamer";
import { tileAt } from "../stream/tiles";
import { unionKits } from "./union";

const pl = (id: string, variant: string): Placement => ({
  id,
  asset: "trees",
  variant,
  x: 0,
  z: 0,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#000000", "#000000", "#000000"],
});
const tile = (x: number, c: Partial<TileContent>): ActiveTile => {
  const t = tileAt(x, 0);
  return {
    key: t.key,
    tile: t,
    ring: 0,
    content: { kits: new Map(), lamps: [], agents: [], signs: [], ribbons: [], ...c },
  };
};

describe("unionKits", () => {
  it("adds the verge shrubs to the kit buckets (trees/<variant>), deduplicated by id", () => {
    const a = tile(10, {
      kits: new Map([["trees/rain_tree", [pl("t1", "rain_tree")]]]),
      verges: {
        strips: new Float32Array(0),
        skirts: new Float32Array(0),
        shrubs: [pl("vg1", "shrub_round"), pl("vg2", "shrub_hedge")],
      },
    });
    const b = tile(260, {
      verges: {
        strips: new Float32Array(0),
        skirts: new Float32Array(0),
        shrubs: [pl("vg1", "shrub_round")],
      },
    });
    const u = unionKits([a, b]);
    expect(u.get("trees/rain_tree")?.map((p) => p.id)).toEqual(["t1"]);
    expect(u.get("trees/shrub_round")?.map((p) => p.id)).toEqual(["vg1"]);
    expect(u.get("trees/shrub_hedge")?.map((p) => p.id)).toEqual(["vg2"]);
  });
});
