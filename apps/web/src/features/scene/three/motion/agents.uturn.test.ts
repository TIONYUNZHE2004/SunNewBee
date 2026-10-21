import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame, type LocalFrame } from "../frame";
import { boxAround } from "../stream/area";
import { type Agent, alongPath, fadeAt, planAgents, poseAt, RESPAWN_APART_M } from "./agents";
import { buildRoadGraph, type RoadGraph } from "./roadGraph";
import { createReversalWatch } from "./uturnWatch";
import { MIN_SHARE } from "./walkPath";

const alongPathPose = (a: Agent, s: number, out: { x: number; z: number; yaw: number }) =>
  alongPath(a.path, s, out);

/**
 * AC-L1 / AC-L2 (demo polish A1): over 60 s at 30 Hz no planned agent reverses its heading by more
 * than 150 deg within 2 s except at a real dead end (graph degree 1), and vehicles really drive
 * through junctions. Three road sets: the tiny fixture's walk layer, a synthetic 5 x 5 street grid
 * and the committed 1 km² Elmina extract (`fixtures/elmina-hero-walk.json`). The dead ends are taken
 * from a graph built here from the walk layer, not from what the planner says about its paths.
 */
const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;

type FC = {
  features: {
    properties: { id: string; type: string };
    geometry: { coordinates: [number, number][] };
  }[];
};
const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const VEHICLE_TYPES = new Set(["street", "major_road"]);
const PEOPLE_TYPES = new Set(["footway", "path", "pedestrian", "sidewalk", "crossing"]);
/** A U-turn half circle has the lane / pavement offset as radius (at most 5 + 1.2 m). */
const DEAD_END_NEAR_M = 9;

interface RoadSet {
  name: string;
  walk: FC;
  frame: LocalFrame;
  caps: { vehicles: number; people: number };
}

function tinySet(): RoadSet {
  const walk = readJson(
    "../../../../../../../packages/spatial/tests/fixtures/tiny/base/walk.geojson",
  );
  return {
    name: "tiny",
    walk,
    frame: createFrame([101.5105, 3.181]),
    caps: { vehicles: 0, people: 200 },
  };
}

function gridSet(): RoadSet {
  const frame = createFrame([101.5, 3.18]);
  const S = 100;
  const features: FC["features"] = [];
  const ll = (x: number, z: number) => frame.toLonLat(x, z) as [number, number];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      const x = (i - 2) * S;
      const z = (j - 2) * S;
      if (i < 4)
        features.push({
          properties: { id: `h${i}${j}`, type: "street" },
          geometry: { coordinates: [ll(x, z), ll(x + S, z)] },
        });
      if (j < 4)
        features.push({
          properties: { id: `v${i}${j}`, type: "street" },
          geometry: { coordinates: [ll(x, z), ll(x, z + S)] },
        });
    }
  const walk = {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      ...f,
      geometry: { type: "LineString", ...f.geometry },
    })),
  } as unknown as FC;
  return { name: "grid5x5", walk, frame, caps: { vehicles: 120, people: 200 } };
}

function elminaSet(): RoadSet {
  const walk = readJson("./fixtures/elmina-hero-walk.json") as FC & { centre: [number, number] };
  return {
    name: "elmina",
    walk,
    frame: createFrame(walk.centre),
    caps: { vehicles: 250, people: 400 },
  };
}

const planFor = (s: RoadSet) =>
  planAgents({
    walk: s.walk,
    places: { type: "FeatureCollection", features: [] },
    frame: s.frame,
    area: { box: boxAround(0, 0, 3000), seed: `uturn-${s.name}` },
    tier: "medium",
    caps: s.caps,
    m: manifest,
  });

/** Degree-1 nodes of both graphs, gridded, and the edge type of each walk feature id. */
function deadEndsOf(s: RoadSet) {
  const graphs: Record<"road" | "foot", RoadGraph> = {
    road: buildRoadGraph(s.walk, s.frame, VEHICLE_TYPES),
    foot: buildRoadGraph(s.walk, s.frame, PEOPLE_TYPES),
  };
  const typeOf = new Map(s.walk.features.map((f) => [String(f.properties.id), f.properties.type]));
  const cell = (v: number) => Math.floor(v / DEAD_END_NEAR_M);
  const grids = {
    road: new Map<string, [number, number][]>(),
    foot: new Map<string, [number, number][]>(),
  };
  for (const k of ["road", "foot"] as const) {
    const g = graphs[k];
    g.nodes.forEach((p, n) => {
      if (g.degree(n) !== 1) return;
      const key = `${cell(p[0])},${cell(p[1])}`;
      const l = grids[k].get(key) ?? [];
      l.push(p);
      grids[k].set(key, l);
    });
  }
  const near = (k: "road" | "foot", x: number, z: number) => {
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const p of grids[k].get(`${cell(x) + di},${cell(z) + dj}`) ?? [])
          if (Math.hypot(p[0] - x, p[1] - z) <= DEAD_END_NEAR_M) return true;
    return false;
  };
  /** The graph an agent walks: its chunk's feature type (ids are `kind:fid:run:chunk:j`). */
  const graphOf = (a: Agent): "road" | "foot" =>
    VEHICLE_TYPES.has(typeOf.get(a.id.split(":")[1] ?? "") ?? "") ? "road" : "foot";
  return { graphs, near, graphOf };
}

const DT = 1 / 30;
const SECONDS = 60;

/** Reversals not at a dead end, and position jumps (not at a respawn), per agent. */
function simulate(s: RoadSet, agents: Agent[]) {
  const { near, graphOf } = deadEndsOf(s);
  const bad: string[] = [];
  const jumps: string[] = [];
  const pose = { x: 0, z: 0, yaw: 0 };
  const lap = { opacity: 1, lap: 0 };
  for (const a of agents) {
    const g = graphOf(a);
    const w = createReversalWatch();
    let px = Number.NaN;
    let pz = Number.NaN;
    let plap = Number.NaN;
    for (let i = 0; i <= SECONDS * 30; i++) {
      const t = i * DT;
      poseAt(a, t, pose);
      fadeAt(a, t, lap);
      if (w.push(t, pose.yaw, near(g, pose.x, pose.z), lap.lap))
        bad.push(`${a.id} t=${t.toFixed(2)} (${pose.x.toFixed(1)}, ${pose.z.toFixed(1)})`);
      if (lap.lap === plap && Math.hypot(pose.x - px, pose.z - pz) > a.speed * 1.2 * DT + 0.01)
        jumps.push(`${a.id} t=${t.toFixed(2)}`);
      px = pose.x;
      pz = pose.z;
      plap = lap.lap;
    }
  }
  return { bad, jumps };
}

/** Distinct graph edges a vehicle drives along (sampled away from the nodes) in 60 s. */
function edgesDriven(s: RoadSet, a: Agent, g: RoadGraph): number {
  const seen = new Set<number>();
  const pose = { x: 0, z: 0, yaw: 0 };
  for (let t = 0; t <= SECONDS; t += 0.2) {
    poseAt(a, t, pose);
    let best = -1;
    let bd = Number.POSITIVE_INFINITY;
    let bAlong = 0;
    let bLen = 0;
    for (const e of g.edges) {
      let walked = 0;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const [ax, az] = e.pts[i]!;
        const [bx, bz] = e.pts[i + 1]!;
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz;
        const l = Math.sqrt(l2);
        const u =
          l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pose.x - ax) * dx + (pose.z - az) * dz) / l2));
        const d = Math.hypot(pose.x - ax - dx * u, pose.z - az - dz * u);
        if (d < bd) {
          bd = d;
          best = e.id;
          bAlong = walked + u * l;
          bLen = e.length;
        }
        walked += l;
      }
    }
    if (best >= 0 && bd <= 4 && bAlong >= 8 && bLen - bAlong >= 8) seen.add(best);
  }
  void s;
  return seen.size;
}

describe("AC-L1: no agent reverses in place (60 s at 30 Hz)", () => {
  for (const make of [tinySet, gridSet, elminaSet]) {
    const s = make();
    it(`${s.name}: zero reversals above 150 deg within 2 s away from degree-1 nodes; no jumps`, () => {
      const agents = planFor(s);
      const people = agents.filter((a) => a.kind === "person").length;
      const vehicles = agents.length - people;
      expect(people).toBeGreaterThan(10);
      if (s.caps.vehicles > 0) expect(vehicles).toBeGreaterThan(10);
      for (const a of agents) expect(a.ends).toBe("fade");
      const { bad, jumps } = simulate(s, agents);
      expect(bad, bad.slice(0, 10).join("\n")).toEqual([]);
      expect(jumps, jumps.slice(0, 10).join("\n")).toEqual([]);
    });
  }
});

describe("AC-L2: vehicles drive through junctions", () => {
  for (const [make, share] of [
    [gridSet, 0.9],
    [elminaSet, 0.7],
  ] as const) {
    const s = make();
    it(`${s.name}: at least ${share * 100}% of vehicles drive 3 or more distinct edges in 60 s`, () => {
      const g = buildRoadGraph(s.walk, s.frame, VEHICLE_TYPES);
      const cars = planFor(s).filter((a) => a.kind === "vehicle");
      expect(cars.length).toBeGreaterThan(20);
      const counts = cars.map((a) => edgesDriven(s, a, g));
      const ok = counts.filter((n) => n >= 3).length / counts.length;
      console.log(
        `[AC-L2] ${s.name}: ${cars.length} vehicles, ${(ok * 100).toFixed(1)}% drive >= 3 edges`,
      );
      expect(ok).toBeGreaterThanOrEqual(share);
    });
  }
});

describe("review fix round 1 (Elmina extract)", () => {
  const s = elminaSet();
  const agents = planFor(s);
  it("Important 1: no vehicle turns more than 145 deg within 3 s while moving under 5 m (a pivot), away from dead ends", () => {
    const { near, graphOf } = deadEndsOf(s);
    const pose = { x: 0, z: 0, yaw: 0 };
    const lap = { opacity: 1, lap: 0 };
    const bad: string[] = [];
    const W = 3 * 30;
    for (const a of agents.filter((x) => x.kind === "vehicle")) {
      const g = graphOf(a);
      const hist: { x: number; z: number; yaw: number; lap: number; dead: boolean }[] = [];
      for (let i = 0; i <= SECONDS * 30; i++) {
        const t = i * DT;
        poseAt(a, t, pose);
        fadeAt(a, t, lap);
        hist.push({
          x: pose.x,
          z: pose.z,
          yaw: pose.yaw,
          lap: lap.lap,
          dead: near(g, pose.x, pose.z),
        });
        if (hist.length > W) hist.shift();
        const now = hist[hist.length - 1]!;
        for (const h of hist) {
          if (h.lap !== now.lap) continue;
          const turn = Math.abs(Math.atan2(Math.sin(now.yaw - h.yaw), Math.cos(now.yaw - h.yaw)));
          if (turn <= (145 * Math.PI) / 180) continue;
          if (Math.hypot(now.x - h.x, now.z - h.z) >= 5) continue;
          if (hist.some((q) => q.dead)) continue;
          bad.push(`${a.id} t=${t.toFixed(2)} (${now.x.toFixed(1)}, ${now.z.toFixed(1)})`);
          break;
        }
        if (bad.length && bad[bad.length - 1]!.startsWith(a.id)) break;
      }
    }
    expect(bad, bad.slice(0, 10).join("\n")).toEqual([]);
  });

  it("Important 1: no stretch away from a dead end is walked below MIN_SHARE of the speed", () => {
    for (const a of agents) {
      const w = a.warp;
      if (!w) continue;
      for (let i = 2; i < w.length; i += 2) {
        const dn = (w[i] as number) - (w[i - 2] as number);
        const ds = (w[i + 1] as number) - (w[i - 1] as number);
        if (dn <= 1e-6 || ds < 0.05) continue; // millimetre segments: Float32 noise
        // Float32 knots: a 2 % tolerance
        if (ds / dn >= MIN_SHARE * 0.98) continue;
        // only a dead-end U-turn half circle may be slower: it lies within 9 m of a dead end
        const p = { x: 0, z: 0, yaw: 0 };
        let atDead = false;
        if (a.deadEnds)
          for (let k = 0; k < a.deadEnds.length; k += 2) {
            const s0 = (w[i - 1] as number) + ds / 2;
            const q = alongPathPose(a, s0, p);
            if (Math.hypot(q.x - a.deadEnds[k]!, q.z - a.deadEnds[k + 1]!) <= 9) atDead = true;
          }
        expect(atDead, `${a.id} share ${(ds / dn).toFixed(3)}`).toBe(true);
      }
    }
  });

  it("M3: every path ends at least RESPAWN_APART_M from where the agent reappears", () => {
    expect(agents.length).toBeGreaterThan(100);
    for (const a of agents) {
      const n = a.path.length;
      expect(
        Math.hypot(a.path[n - 2]! - a.path[0]!, a.path[n - 1]! - a.path[1]!),
        a.id,
      ).toBeGreaterThanOrEqual(RESPAWN_APART_M - 0.01); // Float32 path
    }
  });
});
