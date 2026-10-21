import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WIDTH_BY_TYPE } from "../../shared/roads";
import { parseManifest } from "../assets/manifest";
import { createFrame, type LocalFrame } from "../frame";
import { boxAround } from "../stream/area";
import {
  type Agent,
  BIKE_LANE_SHARE,
  MAJOR_MIX,
  pickVariant,
  planAgents,
  STREET_MIX,
} from "./agents";
import { buildRoadGraph } from "./roadGraph";

/**
 * Demo polish A4w: the weighted local traffic mix (AC-L8) and bicycles on streets (AC-L6). The kit
 * is the committed manifest; road sets are a synthetic street grid (only `street` edges, so every
 * vehicle draws from the street mix) and the committed 1 km² Elmina extract (streets and major
 * roads). Decorative traffic: the shares are a look, never a measured count.
 */
const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;

type Feature = {
  type: "Feature";
  properties: { id: string; type: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};
interface RoadSet {
  walk: { type: "FeatureCollection"; features: Feature[] };
  frame: LocalFrame;
}

/** An n x n street grid with blocks of `S` m, plus a major road along z = 0 when `major`. */
function grid(n: number, S: number, major = false): RoadSet {
  const frame = createFrame([101.5, 3.18]);
  const ll = (x: number, z: number) => frame.toLonLat(x, z) as [number, number];
  const features: Feature[] = [];
  const h = (n - 1) / 2;
  const line = (id: string, type: string, a: [number, number], b: [number, number]) =>
    features.push({
      type: "Feature",
      properties: { id, type },
      geometry: { type: "LineString", coordinates: [ll(...a), ll(...b)] },
    });
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = (i - h) * S;
      const z = (j - h) * S;
      const onMajor = major && z === 0;
      if (i < n - 1) line(`h${i}_${j}`, onMajor ? "major_road" : "street", [x, z], [x + S, z]);
      if (j < n - 1) line(`v${i}_${j}`, "street", [x, z], [x, z + S]);
    }
  return { walk: { type: "FeatureCollection", features }, frame };
}

function elmina(): RoadSet {
  const w = JSON.parse(
    readFileSync(new URL("./fixtures/elmina-hero-walk.json", import.meta.url), "utf8"),
  ) as RoadSet["walk"] & { centre: [number, number] };
  return { walk: w, frame: createFrame(w.centre) };
}

const plan = (s: RoadSet, seed: string, vehicles: number, people = 0) =>
  planAgents({
    walk: s.walk,
    places: { type: "FeatureCollection", features: [] },
    frame: s.frame,
    area: { box: boxAround(0, 0, 5000), seed },
    tier: "medium",
    caps: { vehicles, people },
    m: manifest,
  });

/** The walk feature type of an agent's chunk (ids are `kind:fid:run:chunk:j`). */
const typeOfAgent = (s: RoadSet) => {
  const t = new Map(s.walk.features.map((f) => [f.properties.id, f.properties.type]));
  return (a: Agent) => t.get(a.id.split(":")[1] ?? "") ?? "";
};

/** Centre-line segments of one type, local metres. */
function segmentsOf(s: RoadSet, type: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const f of s.walk.features) {
    if (f.properties.type !== type) continue;
    const c = f.geometry.coordinates.map(([lon, lat]) => s.frame.toLocal(lon, lat));
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i] as [number, number];
      const b = c[i + 1] as [number, number];
      out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}
function distTo(segs: [number, number, number, number][], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [ax, az, bx, bz] of segs) {
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const share = (mix: Readonly<Record<string, number>>) => {
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  return (v: string) => (mix[v] ?? 0) / sum;
};

describe("pickVariant: weights", () => {
  it("normalises the shares over the pool, ignores unknown ids and falls back to uniform", () => {
    const pool = ["a", "b"];
    const w = { a: 1, b: 3, zzz: 50 };
    expect(pickVariant(pool, 0.2, w)).toBe("a");
    expect(pickVariant(pool, 0.3, w)).toBe("b");
    expect(pickVariant(pool, 0.999, w)).toBe("b");
    // no pool id has weight: uniform
    expect(pickVariant(["x", "y"], 0.6, w)).toBe("y");
  });
  it("the street mix is the spec §4 A4 table; buses and lorries only in the major mix, bicycles only in the street mix", () => {
    expect(STREET_MIX).toEqual({
      compact_hatch: 30,
      micro_hatch: 12,
      small_sedan: 20,
      mpv: 10,
      pickup: 6,
      kapchai: 12,
      delivery_moto: 6,
      bicycle: 2,
    });
    expect(STREET_MIX.bus ?? 0).toBe(0);
    expect(STREET_MIX.lorry ?? 0).toBe(0);
    expect(MAJOR_MIX.bicycle ?? 0).toBe(0);
    expect(MAJOR_MIX.bus).toBeGreaterThan(0);
    expect(MAJOR_MIX.lorry).toBeGreaterThan(0);
    // every mix id is a kit variant
    const kit = Object.keys(manifest.assets.vehicles?.variants ?? {});
    for (const v of [...Object.keys(STREET_MIX), ...Object.keys(MAJOR_MIX)])
      expect(kit).toContain(v);
  });
});

describe("AC-L8: street traffic mix over 2,000 seeded spawns", () => {
  const s = grid(24, 100);
  const agents = plan(s, "mix-l8", 3000).filter((a) => a.kind === "vehicle");
  it("matches the §4 A4 shares within ±4 percentage points", () => {
    expect(agents.length).toBeGreaterThanOrEqual(2000);
    const counts = new Map<string, number>();
    for (const a of agents) counts.set(a.variant, (counts.get(a.variant) ?? 0) + 1);
    const want = share(STREET_MIX);
    const lines: string[] = [];
    for (const v of new Set([...Object.keys(STREET_MIX), ...counts.keys()])) {
      const got = (counts.get(v) ?? 0) / agents.length;
      lines.push(`${v} ${(got * 100).toFixed(1)}% (want ${(want(v) * 100).toFixed(1)}%)`);
      expect(Math.abs(got - want(v)), v).toBeLessThanOrEqual(0.04);
    }
    console.log(`[AC-L8] ${agents.length} street vehicles: ${lines.join(", ")}`);
    expect(counts.get("bus") ?? 0).toBe(0);
    expect(counts.get("lorry") ?? 0).toBe(0);
  });
});

describe("AC-L8: buses and lorries only on major_road", () => {
  for (const [name, s] of [
    ["grid with a major road", grid(13, 100, true)],
    ["elmina", elmina()],
  ] as const) {
    it(`${name}: every bus and lorry spawns on and keeps to major roads`, () => {
      const agents = plan(s, `mix-heavy-${name}`, 2000).filter((a) => a.kind === "vehicle");
      const typeOf = typeOfAgent(s);
      const major = segmentsOf(s, "major_road");
      const heavy = agents.filter((a) => a.variant === "bus" || a.variant === "lorry");
      expect(heavy.length).toBeGreaterThan(0);
      for (const a of heavy) {
        expect(typeOf(a), a.id).toBe("major_road");
        // every path point lies on a major road's carriageway (half width 5 m)
        for (let i = 0; i < a.path.length; i += 2)
          expect(
            distTo(major, a.path[i] as number, a.path[i + 1] as number),
            a.id,
          ).toBeLessThanOrEqual((WIDTH_BY_TYPE.major_road ?? 10) / 2 + 0.01);
      }
      // and no other vehicle draws them on a street
      for (const a of agents)
        if (typeOf(a) === "street") expect(["bus", "lorry"]).not.toContain(a.variant);
    });
  }
});

describe("AC-L6: bicycles ride streets only, slowly, on the kerb side", () => {
  for (const [name, s] of [
    ["grid with a major road", grid(17, 100, true)],
    ["elmina", elmina()],
  ] as const) {
    it(`${name}: on street edges, 4.0–5.5 m/s, lateral >= 0.35 x width, never on major_road, never a person`, () => {
      const all = plan(s, `mix-bike-${name}`, 3000, 600);
      const typeOf = typeOfAgent(s);
      const bikes = all.filter((a) => a.kind === "vehicle" && a.variant === "bicycle");
      expect(bikes.length).toBeGreaterThan(name === "elmina" ? 2 : 10);
      // never in the people crowd (neither the vehicle bicycle nor the people kit's cyclist)
      for (const a of all.filter((x) => x.kind === "person"))
        expect(["bicycle", "cyclist"]).not.toContain(a.variant);
      const g = buildRoadGraph(s.walk, s.frame, new Set(["street", "major_road"]));
      const streets = segmentsOf(s, "street");
      const majors = segmentsOf(s, "major_road");
      const W = WIDTH_BY_TYPE.street ?? 6;
      let sampled = 0;
      let minLat = Number.POSITIVE_INFINITY;
      for (const a of bikes) {
        expect(typeOf(a), a.id).toBe("street");
        expect(a.speed).toBeGreaterThanOrEqual(4.0);
        expect(a.speed).toBeLessThanOrEqual(5.5);
        for (let i = 0; i < a.path.length - 2; i += 2) {
          const ax = a.path[i] as number;
          const az = a.path[i + 1] as number;
          const bx = a.path[i + 2] as number;
          const bz = a.path[i + 3] as number;
          const l = Math.hypot(bx - ax, bz - az);
          for (let k = 0; k <= Math.floor(l); k++) {
            const u = l > 0 ? k / l : 0;
            const x = ax + (bx - ax) * Math.min(1, u);
            const z = az + (bz - az) * Math.min(1, u);
            // judged away from junctions (corner fillets cut across), like the U-turn tests
            if (g.nodes.some((p) => Math.hypot(p[0] - x, p[1] - z) < 12)) continue;
            sampled++;
            const ds = distTo(streets, x, z);
            // the kerb side: >= 0.35 x road width from the centre line, still on the carriageway
            const at = `${a.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`;
            expect(ds, at).toBeGreaterThanOrEqual(0.35 * W);
            expect(ds, at).toBeLessThanOrEqual(W / 2);
            minLat = Math.min(minLat, ds / W);
            // never along a major road (its carriageway is 5 m either side of its centre line)
            if (majors.length > 0) expect(distTo(majors, x, z)).toBeGreaterThan(5);
          }
        }
      }
      expect(sampled).toBeGreaterThan(100);
      console.log(
        `[AC-L6] ${name}: ${bikes.length} bicycles, ${sampled} samples, min lateral ${minLat.toFixed(3)} x width (planned ${BIKE_LANE_SHARE.join("–")})`,
      );
    });
  }
});
