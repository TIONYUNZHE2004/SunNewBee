import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { facadeInputs, roofInputs } from "../assets/plan";
import { HERO_CENTRE, HERO_RADIUS_M } from "../bookmarks";
import { BASE_WATER_COLOUR, buildCityGeometry } from "../cityMesh";
import { propsByBuildingId } from "../fallbackStyle";
import { createFrame } from "../frame";
import { ROOF_TINTS, roofDressing } from "./roofPlan";

const read = (url: string) => readFileSync(new URL(url, import.meta.url), "utf8");
const manifest = JSON.parse(read("../../../../../public/city/manifest.json"));
const seed = (p: string) => JSON.parse(read(`../../../../../../../data/seed/elmina/${p}`));

/** [hue 0-360, saturation 0-1] of a #rrggbb colour (HSL). Reusable by the Phase B clay token guard. */
export function hueSat(hex: string): [number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [
    number,
    number,
    number,
  ];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const d = hi - lo;
  if (d === 0) return [0, 0];
  const s = d / (1 - Math.abs(hi + lo - 1));
  let h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [(h + 360) % 360, s];
}

/** True when a roof colour would read as water: within +-25 deg of the water hue and saturation > 0.15. */
export function readsAsWater(hex: string, water: string): boolean {
  const [h, s] = hueSat(hex);
  if (s <= 0.15) return false;
  const dh = Math.abs(h - hueSat(water)[0]);
  return Math.min(dh, 360 - dh) <= 25;
}

describe("AC-A11: no roof colour reads as water", () => {
  it("the guard flags the water colour and cool blues, not terracotta or grey", () => {
    expect(readsAsWater(BASE_WATER_COLOUR, BASE_WATER_COLOUR)).toBe(true);
    expect(readsAsWater("#8fa7b4", BASE_WATER_COLOUR)).toBe(true); // the retired cool membrane tint;
    expect(readsAsWater("#b8735a", BASE_WATER_COLOUR)).toBe(false);
    expect(readsAsWater("#4a4e55", BASE_WATER_COLOUR)).toBe(false);
  });

  it("the large-roof tints avoid the water hue", () => {
    for (const c of ROOF_TINTS) expect(readsAsWater(c, BASE_WATER_COLOUR), c).toBe(false);
  });

  it("every archetype roof colour in the manifest avoids the water hue", () => {
    const bad: string[] = [];
    for (const [k, spec] of Object.entries(
      manifest.assets as Record<string, { palettes: Record<string, string[][]> }>,
    ))
      for (const list of Object.values(spec.palettes))
        for (const p of list) if (readsAsWater(p[1]!, BASE_WATER_COLOUR)) bad.push(`${k}:${p[1]}`);
    expect(bad).toEqual([]);
  });

  it("every roof drawn over the Elmina seed (palette or tint) avoids the water hue", () => {
    const frame = createFrame(seed("site.json").center);
    const layer = { buildings: seed("base/buildings.geojson") } as unknown as BuildingsLayer;
    const g = buildCityGeometry(layer, frame);
    const bad = new Set<string>();
    for (const { b, palette } of roofInputs(g.footprints, layer, manifest, frame))
      for (const c of [palette.roof, roofDressing(b, palette).tint])
        if (readsAsWater(c, BASE_WATER_COLOUR)) bad.add(c);
    expect([...bad]).toEqual([]);
  }, 120_000);
});

describe("AC-A10: hero district facade and roof variety", () => {
  it("flat-roof blocks use >= 5 wall colours, >= 3 window patterns, >= 2 roof-detail kinds", () => {
    const frame = createFrame(seed("site.json").center);
    const layer = { buildings: seed("base/buildings.geojson") } as unknown as BuildingsLayer;
    const g = buildCityGeometry(layer, frame);
    const [hx, hz] = frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]);
    const inHero = new Set(
      g.footprints
        .filter((f) => {
          const cx = f.ring.reduce((a, p) => a + p[0], 0) / f.ring.length;
          const cz = f.ring.reduce((a, p) => a + p[1], 0) / f.ring.length;
          return Math.hypot(cx - hx, cz - hz) <= HERO_RADIUS_M;
        })
        .map((f) => f.id),
    );
    const feet = g.footprints.filter((f) => inHero.has(f.id));
    const props = propsByBuildingId(layer.buildings);
    // Flat-roof blocks: everything except the pitched low-rise house archetypes.
    const HOUSES = new Set([
      "link_intermediate",
      "link_long",
      "superlink",
      "semi_d",
      "bungalow",
      "townhouse",
    ]);
    const blocks = feet.filter((f) => !HOUSES.has(String(props.get(f.id)?.archetype)));
    const facades = facadeInputs(blocks, layer, manifest);
    const walls = new Set(facades.map((f) => f.spec.palette.wall));
    const styles = new Set(facades.map((f) => f.spec.windowStyle));
    const kinds = new Set<string>();
    let dressed = 0;
    for (const { b, palette } of roofInputs(blocks, layer, manifest, frame)) {
      const d = roofDressing(b, palette);
      if (d.band.length === 0) continue;
      dressed++;
      if (d.units.length) kinds.add("units");
      if (d.skylights.length) kinds.add("skylights");
      kinds.add("band");
    }
    process.stderr.write(
      `${JSON.stringify({ hero: feet.length, blocks: blocks.length, walls: [...walls], styles: [...styles], kinds: [...kinds], dressed })}
`,
    );
    expect(walls.size).toBeGreaterThanOrEqual(5);
    expect(styles.size).toBeGreaterThanOrEqual(3);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
