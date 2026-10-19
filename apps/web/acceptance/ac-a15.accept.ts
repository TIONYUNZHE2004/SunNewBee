import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { type BookmarkName, gotoBookmark, HOOK } from "./support/bookmarks";

/**
 * AC-A15 (task A-T12): why are decorative people not visible at street level? Measures, at the
 * `street` bookmark and (for comparison) `hero-mid`: the agents the layer was planned with, those
 * that hold instance matrices (inside the frustum plus the layer's 50 m margin), their distance
 * distribution, display scale, LOD bucket, on-screen height (projected head and feet) and whether
 * a surface hides them. Also counts the people-eligible walk edges (footway / path / pedestrian)
 * and the street edges around the camera, straight from the seed. Writes metrics.json and a
 * screenshot per bookmark to ACCEPTANCE_OUT (default: the ledger folder `acceptance/A-T12`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T12";
const WALK = resolve(process.cwd(), "../../data/seed/elmina/base/walk.geojson");

interface Row {
  kind: "person" | "vehicle";
  variant: string;
  lod: number;
  distM: number;
  scale: number;
  heightM: number;
  heightPx: number | null;
  inCanvas: boolean;
  occluded: boolean;
}

const PEOPLE_TYPES = new Set(["footway", "path", "pedestrian"]);
const VEHICLE_TYPES = new Set(["street", "major_road"]);

/** Metres from (lon, lat) to the nearest vertex of each eligible edge, by type group. */
function edgesNear(lon: number, lat: number) {
  const fc = JSON.parse(readFileSync(WALK, "utf8")) as {
    features: { properties: { type?: string }; geometry: { coordinates: [number, number][] } }[];
  };
  const mLat = 110_574;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const out = {
    person: [] as number[],
    vehicle: [] as number[],
    types: {} as Record<string, number>,
  };
  for (const f of fc.features) {
    const t = String(f.properties.type ?? "");
    out.types[t] = (out.types[t] ?? 0) + 1;
    const g = f.geometry.coordinates;
    if (!Array.isArray(g)) continue;
    const d = Math.min(...g.map((c) => Math.hypot((c[0] - lon) * mLon, (c[1] - lat) * mLat)));
    if (PEOPLE_TYPES.has(t)) out.person.push(d);
    else if (VEHICLE_TYPES.has(t)) out.vehicle.push(d);
  }
  const within = (a: number[], r: number) => a.filter((d) => d <= r).length;
  return {
    walkTypes: out.types,
    personEdgesWithin: {
      "50": within(out.person, 50),
      "100": within(out.person, 100),
      "200": within(out.person, 200),
      "400": within(out.person, 400),
    },
    vehicleEdgesWithin: {
      "50": within(out.vehicle, 50),
      "100": within(out.vehicle, 100),
      "200": within(out.vehicle, 200),
      "400": within(out.vehicle, 400),
    },
    nearestPersonEdgeM: out.person.length ? Math.min(...out.person) : null,
    nearestVehicleEdgeM: out.vehicle.length ? Math.min(...out.vehicle) : null,
  };
}

const q = (a: number[], f: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s[Math.min(s.length - 1, Math.floor(f * s.length))] as number) : null;
};

function summarise(rows: Row[], kind: Row["kind"]) {
  const r = rows.filter((x) => x.kind === kind);
  const vis = r.filter((x) => x.inCanvas && !x.occluded);
  const px = vis.map((x) => x.heightPx ?? 0);
  const lods: Record<string, number> = {};
  for (const x of r) lods[`LOD${x.lod}`] = (lods[`LOD${x.lod}`] ?? 0) + 1;
  return {
    withMatrices: r.length,
    onCanvas: r.filter((x) => x.inCanvas).length,
    occludedOnCanvas: r.filter((x) => x.inCanvas && x.occluded).length,
    visible: vis.length,
    visibleOver12px: vis.filter((x) => (x.heightPx ?? 0) >= 12).length,
    visibleOver30px: vis.filter((x) => (x.heightPx ?? 0) >= 30).length,
    distM: {
      min: q(
        r.map((x) => x.distM),
        0,
      ),
      p50: q(
        r.map((x) => x.distM),
        0.5,
      ),
      p90: q(
        r.map((x) => x.distM),
        0.9,
      ),
      max: q(
        r.map((x) => x.distM),
        1,
      ),
    },
    visibleHeightPx: { min: q(px, 0), p50: q(px, 0.5), max: q(px, 1) },
    scale: {
      min: q(
        r.map((x) => x.scale),
        0,
      ),
      max: q(
        r.map((x) => x.scale),
        1,
      ),
    },
    lodBuckets: lods,
  };
}

const NAMES: BookmarkName[] = ["street", "hero-mid"];

test("AC-A15: agents in view and their on-screen size (street vs hero-mid)", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const result: Record<string, unknown> = {
    task: "A-T12 AC-A15",
    capturedAt: new Date().toISOString(),
  };
  for (const name of NAMES) {
    const b = await gotoBookmark(page, name);
    // Agents stream and plan after the tiles settle: poll until the layer holds some.
    let rep = { planned: { person: 0, vehicle: 0 }, rows: [] as Row[] };
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      rep = (await page.evaluate((h) => {
        const api = (window as unknown as Record<string, { crowd(): unknown }>)[h];
        return api?.crowd();
      }, HOOK)) as typeof rep;
      if (rep.planned.person + rep.planned.vehicle > 0) break;
    }
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    result[name] = {
      bookmark: b,
      planned: rep.planned,
      people: summarise(rep.rows, "person"),
      vehicles: summarise(rep.rows, "vehicle"),
      seed: edgesNear(b.centre[0], b.centre[1]),
      // The 12 nearest people (what the street view could show).
      nearestPeople: rep.rows
        .filter((x) => x.kind === "person")
        .sort((x, y) => x.distM - y.distM)
        .slice(0, 12),
    };
  }
  writeFileSync(join(OUT, "metrics.json"), `${JSON.stringify(result, null, 2)}\n`);
  const street = result.street as { planned: { person: number; vehicle: number } };
  expect(
    street.planned.person + street.planned.vehicle,
    "the layer planned agents",
  ).toBeGreaterThan(0);
});
