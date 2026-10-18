import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame } from "../frame";
import { type Box, boxAround, seedFor } from "../stream/area";
import { tileAt } from "../stream/tiles";
import {
  AGENT_CHUNK_M,
  type Agent,
  CLOSED_LOOP_M,
  densityFor,
  displayScale,
  EASE_AMP,
  EASE_PERIOD_S,
  easedDistance,
  planAgents,
  poseAt,
  slerpAngle,
  smoothYaw,
  TURN_S,
  YAW_TAU_S,
} from "./agents";

const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;

const O: [number, number] = [101.5, 3.18];
const frame = createFrame(O);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const line = (type: string, pts: [number, number][], id: string) => ({
  type: "Feature",
  properties: { id, type },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});
const point = (props: Record<string, unknown>, x: number, z: number) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Point", coordinates: ll(x, z) },
});

/** Parallel lines (none crossing), so the nearest line tells an agent's edge type. */
const LINES: Record<string, [number, number][]> = {
  street: [
    [-400, 0],
    [0, 0],
    [400, 10],
  ],
  major_road: [
    [-400, -150],
    [400, -150],
  ],
  footway: [
    [-300, 50],
    [300, 50],
  ],
  path: [
    [-300, -80],
    [300, -80],
  ],
  pedestrian: [
    [-300, 150],
    [300, 150],
  ],
  // Neither vehicles nor people use these.
  service: [
    [-200, 300],
    [200, 300],
  ],
  steps: [
    [-200, -300],
    [200, -300],
  ],
};
const walk = fc(...Object.entries(LINES).map(([type, pts]) => line(type, pts, type)));
const base = {
  walk,
  places: fc(),
  frame,
  // The P3 hero circle fixture (r = 1200 m) becomes a single 2,400 m box.
  area: { box: boxAround(0, 0, 1200), seed: "t" },
  tier: "medium" as const,
  caps: { vehicles: 20, people: 30 },
  m: manifest,
};
type In = Parameters<typeof planAgents>[0];
const plan = (over: Partial<In> = {}) => planAgents({ ...base, ...over });
const ofKind = (a: Agent[], k: Agent["kind"]) => a.filter((x) => x.kind === k);

/** Distance from a point to the nearest segment of a polyline (local xz). */
function distTo(pts: [number, number][], x: number, z: number) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
const nearestType = (x: number, z: number) => {
  let best = "";
  let bd = Number.POSITIVE_INFINITY;
  for (const [t, pts] of Object.entries(LINES)) {
    const d = distTo(pts, x, z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return { type: best, d: bd };
};
/** The edge type of an agent: the type nearest to the middle of its first segment. */
const typeOf = (a: Agent) =>
  nearestType(
    ((a.path[0] as number) + (a.path[2] as number)) / 2,
    ((a.path[1] as number) + (a.path[3] as number)) / 2,
  );

describe("planAgents", () => {
  it("is deterministic", () => {
    const a = plan();
    const b = plan();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(plan({ area: { ...base.area, seed: "other" } })).not.toEqual(a);
  });

  it("vehicles only on street or major_road, people only on footway, path or pedestrian", () => {
    const agents = plan();
    expect(ofKind(agents, "vehicle").length).toBeGreaterThan(0);
    expect(ofKind(agents, "person").length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const a of agents) {
      const { type, d } = typeOf(a);
      seen.add(type);
      // On the line, give or take the lane offset.
      expect(d).toBeLessThan(3);
      if (a.kind === "vehicle") expect(["street", "major_road"]).toContain(type);
      else expect(["footway", "path", "pedestrian"]).toContain(type);
    }
    expect([...seen].sort()).toEqual(["footway", "major_road", "path", "pedestrian", "street"]);
  });

  it("speeds: vehicles 8–11 m/s on streets and 12–16 on major roads; people 1.2–1.5, jogger 2.5, cyclist 4.5", () => {
    for (const a of plan()) {
      if (a.kind === "vehicle") {
        if (typeOf(a).type === "major_road") expect(a.speed >= 12 && a.speed <= 16).toBe(true);
        else expect(a.speed >= 8 && a.speed <= 11).toBe(true);
      } else if (a.variant === "jogger") expect(a.speed).toBe(2.5);
      else if (a.variant === "cyclist") expect(a.speed).toBe(4.5);
      else expect(a.speed >= 1.2 && a.speed <= 1.5).toBe(true);
    }
  });

  it("variants come from the manifest kits", () => {
    for (const a of plan()) {
      const asset = a.kind === "vehicle" ? "vehicles" : "people";
      expect(Object.keys(manifest.assets[asset]!.variants)).toContain(a.variant);
    }
  });

  it("counts are at most cap × density (and reach it when there are edges)", () => {
    for (const w of [
      { day: 1, dusk: 0, night: 0 },
      { day: 0, dusk: 1, night: 0 },
      { day: 0, dusk: 0, night: 1 },
      { day: 0.3, dusk: 0.3, night: 0.4 },
    ]) {
      const agents = plan({ weights: w });
      const d = densityFor(w);
      for (const [kind, cap] of [
        ["person", base.caps.people],
        ["vehicle", base.caps.vehicles],
      ] as const) {
        const n = ofKind(agents, kind).length;
        expect(n).toBeLessThanOrEqual(cap * d);
        expect(n).toBeGreaterThan(cap * d - 1);
      }
    }
    expect(plan({ tier: "low" })).toEqual([]);
    expect(plan({ caps: { vehicles: 0, people: 0 } })).toEqual([]);
  });

  it("without weights it plans for the peak density (dusk), so the layer can thin it by mood", () => {
    expect(plan().length).toBe(plan({ weights: { day: 0, dusk: 1, night: 0 } }).length);
  });

  it("spawn weight ×3 within 150 m of a school, mall or park", () => {
    // Two equal footways, one beside a school: about three quarters of the people go there.
    const w2 = fc(
      line(
        "footway",
        [
          [-500, 0],
          [-300, 0],
        ],
        "near",
      ),
      line(
        "footway",
        [
          [300, 0],
          [500, 0],
        ],
        "far",
      ),
    );
    const share = (type: string) => {
      const people = ofKind(
        plan({
          walk: w2,
          places: fc(point({ id: "p", type }, -400, 60)),
          caps: { vehicles: 0, people: 1e6 },
        }),
        "person",
      );
      return people.filter((a) => (a.path[0] as number) < 0).length / people.length;
    };
    for (const t of ["school", "mall", "park"]) {
      expect(share(t)).toBeGreaterThan(0.65);
      expect(share(t)).toBeLessThan(0.85);
    }
    expect(share("clinic")).toBeLessThan(0.62);
  });

  it("each agent's path is a chunk of at most AGENT_CHUNK_M owned by its midpoint", () => {
    const box: Box = { x0: -150, z0: -150, x1: 150, z1: 150 };
    const agents = plan({ area: { box, seed: "t" }, caps: { vehicles: 1e6, people: 1e6 } });
    expect(agents.length).toBeGreaterThan(5);
    const m = AGENT_CHUNK_M / 2 + 3; // half a chunk past the box, plus the lane offset
    for (const a of agents) {
      expect(a.length).toBeLessThanOrEqual(AGENT_CHUNK_M + 1);
      for (let i = 0; i < a.path.length; i += 2) {
        expect(a.path[i]! >= box.x0 - m && a.path[i]! <= box.x1 + m).toBe(true);
        expect(a.path[i + 1]! >= box.z0 - m && a.path[i + 1]! <= box.z1 + m).toBe(true);
      }
    }
  });
});

describe("planAgents per tile box", () => {
  const BIG = { vehicles: 1e6, people: 1e6 };
  const Q: Box[] = [
    { x0: -500, z0: -500, x1: 0, z1: 0 },
    { x0: 0, z0: -500, x1: 500, z1: 0 },
    { x0: -500, z0: 0, x1: 0, z1: 500 },
    { x0: 0, z0: 0, x1: 500, z1: 500 },
  ];
  const U: Box = { x0: -500, z0: -500, x1: 500, z1: 500 };
  const byId = (l: Agent[]) => [...l].sort((a, b) => (a.id < b.id ? -1 : 1));
  // Lines that cross both shared edges (x = 0 and z = 0), plus the parallel set.
  const cross = fc(
    ...Object.entries(LINES).map(([type, pts]) => line(type, pts, type)),
    line(
      "street",
      [
        [-20, -400],
        [10, -5],
        [-10, 400],
      ],
      "x1",
    ),
    line(
      "footway",
      [
        [5, -300],
        [5, 300],
      ],
      "x2",
    ),
  );

  it("four tiles planned separately give exactly the agents of their union", () => {
    const parts = Q.map((box, i) => plan({ walk: cross, caps: BIG, area: { box, seed: `q${i}` } }));
    const union = plan({ walk: cross, caps: BIG, area: { box: U, seed: "u" } });
    expect(union.length).toBeGreaterThan(40);
    const ids = parts.flat().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(byId(parts.flat())).toEqual(byId(union));
  });

  it("is deterministic per tile key, whatever was planned before", () => {
    const tile = tileAt(10, 10);
    const area = { box: tile.box, seed: seedFor(tile.key, "agents") };
    const first = plan({ walk: cross, area, caps: { vehicles: 3, people: 3 } });
    plan({ walk: cross, area: { box: Q[0]!, seed: "x" } });
    expect(plan({ walk: cross, area, caps: { vehicles: 3, people: 3 } })).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("densityFor", () => {
  it("day 1.0, dusk 1.15, night 0.45, blended by weights", () => {
    expect(densityFor({ day: 1, dusk: 0, night: 0 })).toBeCloseTo(1);
    expect(densityFor({ day: 0, dusk: 1, night: 0 })).toBeCloseTo(1.15);
    expect(densityFor({ day: 0, dusk: 0, night: 1 })).toBe(0.45);
    expect(densityFor({ day: 0.5, dusk: 0, night: 0.5 })).toBeCloseTo(0.725);
  });
});

describe("poseAt", () => {
  const a: Agent = {
    id: "a",
    kind: "person",
    variant: "office_man",
    path: new Float32Array([0, 0, 10, 0, 10, -10]),
    length: 20,
    speed: 1.3,
    offset: 3,
  };
  /** The time at which the agent has travelled `d` metres (bisection on the monotone distance). */
  const timeFor = (ag: Agent, d: number) => {
    let lo = 0;
    let hi = (d / ag.speed) * 2 + 1;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (easedDistance(ag, mid) < d) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

  it("walks the path at its (eased) speed, yaw from the tangent (+z forward)", () => {
    const p = poseAt(a, 0);
    expect(p.x).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(0);
    expect(p.yaw).toBeCloseTo(Math.PI / 2); // heading +x
    const q = poseAt(a, timeFor(a, 10));
    expect(q.x).toBeCloseTo(10, 3);
    expect(q.z).toBeCloseTo(-3, 3);
    expect(Math.abs(q.yaw)).toBeCloseTo(Math.PI); // heading -z
  });

  it("speed eases +-15 % on a hashed sine with a 20-40 s period; agents differ", () => {
    expect(EASE_AMP).toBe(0.15);
    expect(EASE_PERIOD_S).toEqual([20, 40]);
    const rates = (ag: Agent) => {
      const out: number[] = [];
      for (let t = 0; t < 80; t += 0.25)
        out.push((easedDistance(ag, t + 0.01) - easedDistance(ag, t)) / 0.01 / ag.speed);
      return out;
    };
    const r = rates(a);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0.85 - 1e-6);
    expect(Math.max(...r)).toBeLessThanOrEqual(1.15 + 1e-6);
    expect(Math.min(...r)).toBeLessThan(0.87);
    expect(Math.max(...r)).toBeGreaterThan(1.13);
    expect(easedDistance(a, 0)).toBe(0);
    // Two agents with the same speed are not in lockstep.
    const b = { ...a, id: "b" };
    expect(rates(b)).not.toEqual(r);
  });

  it("an open path ping-pongs: no jump at the end, turns in place over 1.5 s, walks back", () => {
    expect(TURN_S).toBe(1.5);
    const atEnd = poseAt(a, timeFor(a, 17));
    expect(atEnd.x).toBeCloseTo(10, 3);
    expect(atEnd.z).toBeCloseTo(-10, 3);
    // The turn holds the end point and swings the yaw by pi.
    const mid = poseAt(a, timeFor(a, 17 + (TURN_S * a.speed) / 2));
    expect(mid.x).toBeCloseTo(10, 3);
    expect(mid.z).toBeCloseTo(-10, 3);
    expect(Math.abs(wrap(mid.yaw - atEnd.yaw))).toBeCloseTo(Math.PI / 2, 3);
    const after = poseAt(a, timeFor(a, 17 + TURN_S * a.speed));
    expect(Math.abs(wrap(after.yaw - atEnd.yaw))).toBeCloseTo(Math.PI, 3);
    // Then back along the path: 4 m later it is 4 m from the end, heading +z.
    const back = poseAt(a, timeFor(a, 17 + TURN_S * a.speed + 4));
    expect(back.x).toBeCloseTo(10, 3);
    expect(back.z).toBeCloseTo(-6, 3);
    expect(wrap(back.yaw)).toBeCloseTo(0, 3);
    // Never teleports to the start (the P3 defect): one cycle is 2 L + 2 turns.
    const cycle = 2 * 20 + 2 * TURN_S * a.speed;
    const c = poseAt(a, timeFor(a, cycle));
    expect(c.x).toBeCloseTo(3, 3);
    expect(c.z).toBeCloseTo(0, 3);
    expect(wrap(c.yaw)).toBeCloseTo(Math.PI / 2, 3);
  });

  it("a closed loop (ends within 1 m) keeps looping, across the closing gap without a jump", () => {
    expect(CLOSED_LOOP_M).toBe(1);
    // A 40 m square whose last point stops 0.5 m short of the first.
    const sq: Agent = {
      id: "loop",
      kind: "vehicle",
      variant: "car",
      path: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10, 0, 0.5]),
      length: 39.5,
      speed: 9,
      offset: 0,
    };
    const p = poseAt(sq, timeFor(sq, 39.75));
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.z).toBeCloseTo(0.25, 3);
    const q = poseAt(sq, timeFor(sq, 40 + 5));
    expect(q.x).toBeCloseTo(5, 3);
    expect(q.z).toBeCloseTo(0, 3);
    expect(q.yaw).toBeCloseTo(Math.PI / 2, 3); // still heading +x: looped, not reversed
  });

  it("degenerate paths stay put", () => {
    const one: Agent = { ...a, id: "one", path: new Float32Array([4, 5]), length: 0 };
    expect(poseAt(one, 12)).toEqual({ x: 4, z: 5, yaw: 0 });
    const zero: Agent = { ...a, id: "zero", path: new Float32Array([4, 5, 4, 5]), length: 0 };
    const z = poseAt(zero, 12);
    expect([z.x, z.z]).toEqual([4, 5]);
  });
});

describe("slerpAngle / smoothYaw", () => {
  it("takes the short way round and never overshoots", () => {
    expect(slerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
    // From 170 deg to -170 deg is +20 deg, not -340.
    const mid = slerpAngle((170 * Math.PI) / 180, (-170 * Math.PI) / 180, 0.5);
    expect(Math.abs(Math.atan2(Math.sin(mid), Math.cos(mid)))).toBeCloseTo(Math.PI, 5);
    expect(slerpAngle(1, 2, 0)).toBeCloseTo(1);
    expect(slerpAngle(1, 2, 1)).toBeCloseTo(2);
  });
  it("smoothYaw uses 1 - exp(-dt / 0.25 s)", () => {
    expect(YAW_TAU_S).toBe(0.25);
    expect(smoothYaw(0, 1, 0.25)).toBeCloseTo(1 - Math.exp(-1));
    expect(smoothYaw(0, 1, 0)).toBe(0);
  });
});

// Review Focus 4: no visible jumps. Seeded agents on short open and closed paths (so 33 s covers
// several path ends and turns), stepped at 60 Hz.
describe("Review Focus 4: continuity over 200 seeded agents x 2,000 steps of 16.7 ms", () => {
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = rng(12);
  const agents: Agent[] = Array.from({ length: 200 }, (_, i) => {
    const n = 2 + Math.floor(r() * 6);
    const pts: number[] = [r() * 50, r() * 50];
    for (let k = 1; k < n; k++) {
      // Some repeated vertices (zero-length segments) and sharp corners.
      const rep = r() < 0.1;
      const lx = pts[pts.length - 2] as number;
      const lz = pts[pts.length - 1] as number;
      pts.push(rep ? lx : lx + (r() - 0.5) * 20, rep ? lz : lz + (r() - 0.5) * 20);
    }
    // A third are closed loops whose ends meet within 1 m.
    if (i % 3 === 0 && n >= 3)
      pts.push((pts[0] as number) + r() * 0.6, (pts[1] as number) + r() * 0.6);
    const path = new Float32Array(pts);
    let length = 0;
    for (let k = 0; k + 3 < path.length; k += 2)
      length += Math.hypot(path[k + 2]! - path[k]!, path[k + 3]! - path[k + 1]!);
    const vehicle = r() < 0.5;
    return {
      id: `rf4:${i}`,
      kind: vehicle ? "vehicle" : "person",
      variant: "v",
      path,
      length,
      speed: vehicle ? 8 + r() * 8 : 1.2 + r() * 3.3,
      offset: r() * length,
    };
  });
  const DT = 0.0167;
  const STEPS = 2000;

  it("positions never jump more than speed x 1.2 x dt + 0.01 m; smoothed yaw turns at most 2 pi dt / 0.5 s", () => {
    const yawStep = (2 * Math.PI * DT) / 0.5;
    let worstPos = Number.NEGATIVE_INFINITY;
    let worstYaw = Number.NEGATIVE_INFINITY;
    let ends = 0;
    for (const ag of agents) {
      const t0 = r() * 500;
      const p = poseAt(ag, t0);
      let px = p.x;
      let pz = p.z;
      let yaw = p.yaw;
      let raw = p.yaw;
      for (let s = 1; s <= STEPS; s++) {
        const q = poseAt(ag, t0 + s * DT);
        const d = Math.hypot(q.x - px, q.z - pz);
        worstPos = Math.max(worstPos, d - (ag.speed * 1.2 * DT + 0.01));
        const next = smoothYaw(yaw, q.yaw, DT);
        const dy = Math.abs(Math.atan2(Math.sin(next - yaw), Math.cos(next - yaw)));
        worstYaw = Math.max(worstYaw, dy - yawStep);
        // A step with no movement but a turning tangent: the agent is turning at a path end.
        if (d < 1e-9 && Math.abs(q.yaw - raw) > 1e-6) ends++;
        px = q.x;
        pz = q.z;
        yaw = next;
        raw = q.yaw;
      }
    }
    expect(worstPos).toBeLessThanOrEqual(1e-9);
    expect(worstYaw).toBeLessThanOrEqual(1e-9);
    expect(ends).toBeGreaterThan(1000); // the run really covers path ends
  });
});

describe("displayScale", () => {
  it("1 within 150 m, linear to 3 at 800 m, capped at 3", () => {
    expect(displayScale(0)).toBe(1);
    expect(displayScale(100)).toBe(1);
    expect(displayScale(150)).toBe(1);
    expect(displayScale(475)).toBeCloseTo(2);
    expect(displayScale(800)).toBe(3);
    expect(displayScale(5000)).toBe(3);
  });
  it("a 1.74 m person at 800 m renders 5.22 m tall (display only)", () => {
    expect(1.74 * displayScale(800)).toBeCloseTo(5.22);
  });
});
