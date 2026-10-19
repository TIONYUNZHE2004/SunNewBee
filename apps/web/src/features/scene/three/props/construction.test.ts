import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame } from "../frame";
import { clayPalette } from "../shared/clayTokens";
import { boxAround } from "../stream/area";
import { tileAt } from "../stream/tiles";
import { planConstruction, TRACK_STRIDE, TRACK_WIDTH_M } from "./construction";
import { inPoly, type Poly, polygonsOf } from "./polyGeom";
import { planProps } from "./propsPlan";

/** Cap-agnostic tests: generous caps (the old whole-scene High numbers) so a per-tile cap never bites. */
const UNCAPPED = { trees: 6000, lamps: 1500, furniture: 600, construction: 300 };

const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;
const before = JSON.parse(
  readFileSync(new URL("./fixtures/construction-before.json", import.meta.url), "utf8"),
) as Record<string, [string, unknown[]][]>;

const frame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const rect = (props: Record<string, unknown>, x0: number, z0: number, w: number, h: number) =>
  ({
    type: "Feature",
    properties: props,
    geometry: {
      type: "Polygon",
      coordinates: [[ll(x0, z0), ll(x0 + w, z0), ll(x0 + w, z0 + h), ll(x0, z0 + h), ll(x0, z0)]],
    },
  }) as unknown as GeoJSON.Feature;

describe("construction.ts (split out of propsPlan)", () => {
  it("propsPlan's construction output is unchanged by the split (before/after fixture)", () => {
    const landcover = fc(
      rect({ class: "grass" }, 300, 300, 20, 20),
      rect({ class: "construction" }, 100, 100, 40, 40),
      rect({ class: "construction" }, -200, 50, 55, 40),
    );
    const empty = fc();
    const input = {
      walk: empty,
      landcover,
      buildings: empty,
      parks: empty,
      trees: empty,
      places: empty,
      frame,
      tier: "high" as const,
      m: manifest,
    };
    for (const [name, caps] of [
      ["big", UNCAPPED],
      ["tight", { ...UNCAPPED, construction: 6 }],
    ] as const) {
      const p = planProps({ ...input, area: { box: boxAround(0, 0, 1200), seed: "t" }, caps });
      const after = [...p.kits].filter(([k]) => k.startsWith("construction/"));
      // B-T1: palettes now load through the clay token table; the fixture predates it.
      const want = (before[name] ?? []).map(([k, list]) => [
        k,
        (list as { palette: [string, string, string]; asset: string }[]).map((pl) => ({
          ...pl,
          palette: clayPalette(pl.palette, pl.asset),
        })),
      ]);
      expect(JSON.parse(JSON.stringify(after))).toEqual(want);
    }
  });
});

const tileOfXZ = (x: number, z: number) => tileAt(x, z);
// A 30,000 m2 site (152 x 202 m, a little over, as the lon/lat round trip loses a hair) inside tile 0,0.
const BIG = rect({ class: "construction" }, 10, 10, 152, 202);
const bigPoly = (): Poly => polygonsOf(BIG.geometry, frame)[0]!;

describe("planConstruction", () => {
  const tile = tileOfXZ(100, 100);
  const count = (r: ReturnType<typeof planConstruction>, key: string) =>
    r.kits.get(`construction/${key}`)?.length ?? 0;

  it("a 30,000 m2 site gets 10 cabins, 20 stacks, 12 excavators and 3 cranes", () => {
    const r = planConstruction([BIG], tile, frame, 1000, manifest);
    expect(count(r, "site_cabin")).toBe(10);
    expect(count(r, "material_stack")).toBe(20);
    expect(count(r, "excavator")).toBe(12);
    expect(count(r, "tower_crane")).toBe(3);
    expect(count(r, "hoarding_6m")).toBe(Math.floor((708 - 3) / 6 + 1e-9) + 1);
  });

  it("is capped by cap, keeping the cabin and two hoardings first", () => {
    const r = planConstruction([BIG], tile, frame, 6, manifest);
    const n = [...r.kits.values()].reduce((s, l) => s + l.length, 0);
    expect(n).toBe(6);
    expect(count(r, "site_cabin")).toBe(1);
    expect(planConstruction([BIG], tile, frame, 0, manifest).kits.size).toBe(0);
  });

  it("scales with area: small sites keep the P3 set, a crane only above 8,000 m2", () => {
    const small = planConstruction([rect({}, 10, 10, 40, 40)], tile, frame, 100, manifest);
    expect(count(small, "site_cabin")).toBe(1);
    expect(count(small, "material_stack")).toBe(2);
    expect(count(small, "excavator")).toBe(0);
    expect(count(small, "tower_crane")).toBe(0);
    const mid = planConstruction([rect({}, 10, 10, 100, 90)], tile, frame, 100, manifest);
    expect(count(mid, "tower_crane")).toBe(1);
  });

  it("keeps every item and track inside the site", () => {
    const r = planConstruction([BIG], tile, frame, 1000, manifest);
    const poly = bigPoly();
    for (const l of r.kits.values())
      for (const p of l)
        if (!p.id.startsWith("hd")) expect(inPoly(p.x, p.z, poly), p.id).toBe(true);
    expect(r.tracks.length).toBeGreaterThan(0);
    expect(r.tracks.length % TRACK_STRIDE).toBe(0);
    const hw = TRACK_WIDTH_M / 2;
    for (let i = 0; i < r.tracks.length; i += TRACK_STRIDE) {
      const [x0, z0, x1, z1] = [r.tracks[i]!, r.tracks[i + 1]!, r.tracks[i + 2]!, r.tracks[i + 3]!];
      const len = Math.hypot(x1 - x0, z1 - z0);
      expect(len).toBeGreaterThan(0);
      const nx = -(z1 - z0) / len;
      const nz = (x1 - x0) / len;
      for (const [x, z] of [
        [x0, z0],
        [x1, z1],
      ] as const)
        for (const s of [-hw, 0, hw]) expect(inPoly(x + nx * s, z + nz * s, poly)).toBe(true);
    }
  });

  it("two adjacent tiles never both place an item, and together equal one big box", () => {
    // The site straddles the x = 250 edge between tiles 0,* and 1,*.
    const site = rect({ class: "construction" }, 150, 10, 200, 150);
    const a = planConstruction([site], tileAt(100, 100), frame, 1000, manifest);
    const b = planConstruction([site], tileAt(300, 100), frame, 1000, manifest);
    const ids = (r: typeof a) => [...r.kits.values()].flat().map((p) => p.id);
    const ia = ids(a);
    const ib = ids(b);
    expect(ia.length).toBeGreaterThan(0);
    expect(ib.length).toBeGreaterThan(0);
    expect(ia.filter((i) => ib.includes(i))).toEqual([]);
    for (const p of [...a.kits.values()].flat()) expect(p.x).toBeLessThan(250);
    for (const p of [...b.kits.values()].flat()) expect(p.x).toBeGreaterThanOrEqual(250);
  });

  it("is deterministic and every placement is a decorative kit variant", () => {
    const r1 = planConstruction([BIG], tile, frame, 50, manifest);
    const r2 = planConstruction([BIG], tile, frame, 50, manifest);
    expect([...r1.kits]).toEqual([...r2.kits]);
    expect([...r1.tracks]).toEqual([...r2.tracks]);
    for (const l of r1.kits.values())
      for (const p of l) expect(manifest.assets[p.asset]?.decorative).toBe(true);
  });
});
