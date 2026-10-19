import { existsSync, readFileSync } from "node:fs";
import { ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../shared/roads";
import { type CrowdManifest, parseCrowdManifest } from "../assets/crowdManifest";
import { parseManifest } from "../assets/manifest";
import { createFrame, type LocalFrame } from "../frame";
import { boundaryOf } from "../ground/boundary";
import { inPoly, type Poly, polygonsOf } from "../props/polyGeom";
import { seedFor } from "../stream/area";
import { tileCap } from "../stream/caps";
import { type Tile, tileAt, tileOf } from "../stream/tiles";
import { type Agent, type MoodMix, PAVEMENT_FLOOR_M, planAgents } from "./agents";
import { assignLooks, lookSpeed } from "./crowdRules";

/**
 * Test fixture (C-T8): the crowd planned from the Elmina seed along the D-T4 demo route, as the
 * streamer plans it at High (route tiles ring 0, their neighbours ring 1), with the seed's
 * footprints and base water as obstacles. Test-only (reads files with node:fs).
 */
const SEED = (p: string) => new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url);
const PUB = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const DEMO = new URL("../../../journey/fixtures/demoPlan.json", import.meta.url);

export const HAVE_SEED =
  existsSync(SEED("base/walk.geojson")) &&
  existsSync(SEED("base/buildings.geojson")) &&
  existsSync(SEED("base/hydrology.geojson"));

const read = (u: URL) => JSON.parse(readFileSync(u, "utf8"));

export interface Corridor {
  frame: LocalFrame;
  walk: unknown;
  /** Footprints and base water (closed polygons of the hydrology layer, as the API serves `water`). */
  obstacles: { buildings: unknown; water: unknown };
  footprints: Poly[];
  water: Poly[];
  /** The demo route polyline in local metres and its cumulative length. */
  route: [number, number][];
  cum: number[];
  crowd: CrowdManifest;
  /** Plan the crowd around tiles `ring0` (+ their 8 neighbours at ring 1) as the streamer does. */
  plan(ring0: Tile[], weights?: MoodMix): Agent[];
  /** One tile's agents as `planTile` plans them at High. */
  planTile(tile: Tile, ring: 0 | 1, weights?: MoodMix): Agent[];
  /** People of `plan` with their crowd look and the look's speed, as the motion layer draws them. */
  dress(agents: Agent[]): { agent: Agent; look: number }[];
  /** Distance (m) from a point to the nearest drawn walk ribbon (centre-line distance - half width). */
  ribbonGap(x: number, z: number): number;
  inObstacle(x: number, z: number): boolean;
  /** Point and tangent yaw (atan2(dx, dz)) at route metre m. */
  at(m: number): { x: number; z: number; yaw: number };
}

let cached: Corridor | null = null;

export function corridor(): Corridor {
  if (cached) return cached;
  const site = read(SEED("site.json"));
  const frame = createFrame(site.center);
  const walk = read(SEED("base/walk.geojson"));
  const buildings = read(SEED("base/buildings.geojson"));
  const hydro = read(SEED("base/hydrology.geojson"));
  const water = {
    type: "FeatureCollection",
    features: hydro.features.filter(
      (f: { geometry?: { type?: string } }) =>
        f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
    ),
  };
  const boundaryFc = existsSync(SEED("base/boundary.geojson"))
    ? read(SEED("base/boundary.geojson"))
    : null;
  const boundary = boundaryFc ? boundaryOf(boundaryFc.features[0].geometry, frame) : null;
  const manifest = parseManifest(read(PUB("/city/manifest.json"))).manifest;
  if (!manifest) throw new Error("city manifest");
  const crowd = parseCrowdManifest(read(PUB("/city/characters/crowd.json"))).manifest;
  if (!crowd) throw new Error("crowd manifest");
  const demo = read(DEMO) as { polyline: [number, number][] };
  const route = demo.polyline.map(([lon, lat]) => frame.toLocal(lon, lat));
  const cum = [0];
  for (let i = 1; i < route.length; i++)
    cum.push(
      (cum[i - 1] as number) +
        Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![1] - route[i - 1]![1]),
    );

  const polysOf = (fc: { features: { geometry: unknown }[] }) =>
    fc.features.flatMap((f) => polygonsOf(f.geometry, frame));
  const footprints = polysOf(buildings);
  const waterPolys = polysOf(water);
  const CELL = 25;
  const key = (i: number, j: number) => `${i},${j}`;
  const polyGrid = new Map<string, Poly[]>();
  for (const p of [...footprints, ...waterPolys]) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of p[0]!) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = key(i, j);
        const l = polyGrid.get(k);
        if (l) l.push(p);
        else polyGrid.set(k, [p]);
      }
  }
  // Walk ribbons gridded by bounds padded by half width + 2 m (queries up to 1.5 m out).
  type Seg = { ax: number; az: number; bx: number; bz: number; half: number };
  const segGrid = new Map<string, Seg[]>();
  for (const f of walk.features as {
    properties: { type?: string };
    geometry: { type: string; coordinates: [number, number][] };
  }[]) {
    if (f.geometry?.type !== "LineString") continue;
    const half = (WIDTH_BY_TYPE[f.properties.type ?? ""] ?? ROAD_WIDTH_UNKNOWN) / 2;
    const pts = f.geometry.coordinates.map(([lon, lat]) => frame.toLocal(lon, lat));
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[i + 1]!;
      const s = { ax, az, bx, bz, half };
      const r = half + 2;
      for (
        let ci = Math.floor((Math.min(ax, bx) - r) / CELL);
        ci <= Math.floor((Math.max(ax, bx) + r) / CELL);
        ci++
      )
        for (
          let cj = Math.floor((Math.min(az, bz) - r) / CELL);
          cj <= Math.floor((Math.max(az, bz) + r) / CELL);
          cj++
        ) {
          const k = key(ci, cj);
          const l = segGrid.get(k);
          if (l) l.push(s);
          else segGrid.set(k, [s]);
        }
    }
  }
  const segDist = (px: number, pz: number, s: Seg) => {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2));
    return Math.hypot(px - s.ax - dx * t, pz - s.az - dz * t);
  };
  const ribbonGap = (x: number, z: number) => {
    let best = Infinity;
    for (const s of segGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [])
      best = Math.min(best, Math.max(0, segDist(x, z, s) - s.half));
    return best;
  };
  const inObstacle = (x: number, z: number) =>
    (polyGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []).some((p) =>
      inPoly(x, z, p),
    );
  const obstacles = { buildings, water };

  const planTile = (tile: Tile, ring: 0 | 1, weights?: MoodMix) =>
    planAgents({
      walk,
      places: walk,
      frame,
      area: { box: tile.box, seed: seedFor(tile.key, "motion") },
      tier: "high",
      caps: {
        vehicles: tileCap("high", ring, "vehicles", tile, frame),
        people: tileCap("high", ring, "people", tile, frame),
      },
      m: manifest,
      boundary,
      obstacles,
      floorPerM: 1 / PAVEMENT_FLOOR_M,
      ...(weights ? { weights } : {}),
    });
  const plan = (ring0: Tile[], weights?: MoodMix) => {
    const rings = new Map<string, { tile: Tile; ring: 0 | 1 }>();
    for (const t of ring0) rings.set(t.key, { tile: t, ring: 0 });
    for (const t of ring0) {
      const i = Math.floor(t.box.x0 / (t.box.x1 - t.box.x0));
      const j = Math.floor(t.box.z0 / (t.box.z1 - t.box.z0));
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const n = tileOf(i + di, j + dj);
          if (!rings.has(n.key)) rings.set(n.key, { tile: n, ring: 1 });
        }
    }
    return [...rings.values()].flatMap(({ tile, ring }) => planTile(tile, ring, weights));
  };
  const dress = (agents: Agent[]) => {
    const people = agents.filter((a) => a.kind === "person");
    const looks = assignLooks(people, crowd.looks);
    return people.map((a) => {
      const look = looks.get(a.id) as number;
      const spec = crowd.looks[look]!;
      const stride = crowd.bodies[spec.body].clips[spec.clips.walk]?.stride ?? 0;
      return { agent: { ...a, speed: lookSpeed(a, spec, stride) }, look };
    });
  };
  const at = (m: number) => {
    const total = cum[cum.length - 1] as number;
    const s = Math.max(0, Math.min(total, m));
    let i = 1;
    while (i < route.length - 1 && (cum[i] as number) < s) i++;
    const a = route[i - 1]!;
    const b = route[i]!;
    const l = (cum[i] as number) - (cum[i - 1] as number);
    const t = l > 0 ? (s - (cum[i - 1] as number)) / l : 0;
    return {
      x: a[0] + (b[0] - a[0]) * t,
      z: a[1] + (b[1] - a[1]) * t,
      yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
    };
  };
  cached = {
    frame,
    walk,
    obstacles,
    footprints,
    water: waterPolys,
    route,
    cum,
    crowd,
    plan,
    planTile,
    dress,
    ribbonGap,
    inObstacle,
    at,
  };
  return cached;
}

/** The tiles the demo route passes through (ring 0 while the camera follows her). */
export function routeTiles(c: Corridor): Tile[] {
  const seen = new Map<string, Tile>();
  const total = c.cum[c.cum.length - 1] as number;
  for (let m = 0; m <= total; m += 10) {
    const p = c.at(m);
    const t = tileAt(p.x, p.z);
    seen.set(t.key, t);
  }
  return [...seen.values()];
}
