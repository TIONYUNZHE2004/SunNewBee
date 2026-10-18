import { WIDTH_BY_TYPE } from "../../cesium/stylised/ground";
import type { Tier } from "../../cesium/stylised/quality";
import { hash01 } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { growBox, inBox, type PlanArea, perLayer, touchesBox } from "../stream/area";

/**
 * DECORATIVE traffic and pedestrians for one planning box. Agents loop along walk edges as
 * polylines from a seeded start offset, with no routing and no collision (ruling: cars may pass
 * through each other at junctions). Nothing here is a fact about the township: no counts, no
 * flows, no speeds are measured. Pure: the same input always gives the same agents.
 */
export interface Agent {
  id: string;
  kind: "vehicle" | "person";
  variant: string;
  /** xz pairs (local metres), already offset into the lane / pavement side. */
  path: Float32Array;
  length: number;
  /** m/s */
  speed: number;
  /** Start distance along the path (m). */
  offset: number;
}

export interface MoodMix {
  day: number;
  dusk: number;
  night: number;
}

const DENSITY = { day: 1, dusk: 1.15, night: 0.45 };
/** The densest mood: a plan without weights holds this many agents and the layer thins it. */
export const DENSITY_PEAK = DENSITY.dusk;

/** Density by mood: day 1.0, dusk 1.15 (commuter rush), night 0.45 ("fewer but clearly present"). Blended by weights. */
export function densityFor(w: MoodMix): number {
  const sum = w.day + w.dusk + w.night;
  if (!(sum > 0)) return DENSITY.day;
  return (w.day * DENSITY.day + w.dusk * DENSITY.dusk + w.night * DENSITY.night) / sum;
}

const SCALE_NEAR_M = 150;
const SCALE_FAR_M = 800;
const SCALE_MAX = 3;
/** Display scale-up for legibility (owner ruling P2): 1 within 150 m of the camera, rising linearly to 3 at 800 m, capped at 3. Decorative only. */
export function displayScale(distanceM: number): number {
  if (distanceM <= SCALE_NEAR_M) return 1;
  if (distanceM >= SCALE_FAR_M) return SCALE_MAX;
  return 1 + ((SCALE_MAX - 1) * (distanceM - SCALE_NEAR_M)) / (SCALE_FAR_M - SCALE_NEAR_M);
}

export interface Pose2 {
  x: number;
  z: number;
  yaw: number;
}
const setPose = (out: Pose2, x: number, z: number, yaw: number) => {
  out.x = x;
  out.z = z;
  out.yaw = yaw;
  return out;
};

/**
 * Loops along the path; yaw turns the model's +z (its front) onto the tangent. Writes into `out`
 * when given (the motion layer reuses one object per tick) and returns it.
 */
export function poseAt(a: Agent, tSec: number, out: Pose2 = { x: 0, z: 0, yaw: 0 }): Pose2 {
  const p = a.path;
  const n = p.length / 2;
  if (n < 2 || !(a.length > 0)) return setPose(out, p[0] ?? 0, p[1] ?? 0, 0);
  let s = (a.offset + a.speed * tSec) % a.length;
  if (s < 0) s += a.length;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[2 * i] as number;
    const az = p[2 * i + 1] as number;
    const dx = (p[2 * i + 2] as number) - ax;
    const dz = (p[2 * i + 3] as number) - az;
    const l = Math.hypot(dx, dz);
    if (l === 0) continue;
    if (s <= l || i === n - 2) {
      const t = Math.min(1, s / l);
      return setPose(out, ax + dx * t, az + dz * t, Math.atan2(dx, dz));
    }
    s -= l;
  }
  return setPose(out, p[0] as number, p[1] as number, 0);
}

const VEHICLE_TYPES = new Set(["street", "major_road"]);
const PEOPLE_TYPES = new Set(["footway", "path", "pedestrian"]);
const BUSY_PLACES = new Set(["school", "mall", "park"]);
const BUSY_RANGE_M = 150;
const BUSY_WEIGHT = 3;
const MIN_EDGE_M = 10;
/** Malaysia drives on the left: a vehicle keeps a quarter of the road width left of its centre line. */
const LANE_SHARE = 0.25;
const PAVEMENT_OFFSET_M: [number, number] = [0.3, 0.8];
/** Heavy vehicles only on major roads. */
const MAJOR_ONLY = new Set(["bus", "lorry"]);
const SPEED = {
  street: [8, 11],
  major: [12, 16],
  walk: [1.2, 1.5],
  jogger: 2.5,
  cyclist: 4.5,
} as const;

type P = [number, number];
interface Edge {
  pts: P[];
  length: number;
  type: string;
  weight: number;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): Record<string, unknown>[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features.filter(isRec) : [];
const propsOf = (f: Record<string, unknown>): Record<string, unknown> =>
  isRec(f.properties) ? f.properties : {};
const lerp = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

const polyLength = (pts: P[]) => {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++)
    l += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
  return l;
};

/** The polyline moved `d` metres to the left of its direction (vertex normals averaged). */
function offsetLeft(pts: P[], d: number): P[] {
  const n = pts.length;
  return pts.map((p, i) => {
    let lx = 0;
    let lz = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ] as const) {
      if (a < 0 || b >= n) continue;
      const dx = pts[b]![0] - pts[a]![0];
      const dz = pts[b]![1] - pts[a]![1];
      const l = Math.hypot(dx, dz) || 1;
      // Left of travel with y up: (dz, -dx).
      lx += dz / l;
      lz += -dx / l;
    }
    const l = Math.hypot(lx, lz) || 1;
    return [p[0] + (lx / l) * d, p[1] + (lz / l) * d];
  });
}

/**
 * Longest agent path (m). A walk line longer than this is cut into equal chunks; each chunk is
 * owned by the box that holds its arc midpoint, so a path reaches at most half a chunk past its
 * box and adjacent boxes never share an agent. (Most Elmina walk edges are shorter: median 47 m.)
 */
export const AGENT_CHUNK_M = 120;
/** One candidate agent per this many metres of spawn weight (chunk length x busy weight). */
const SPAWN_SPACING_M = 25;

export interface AgentsInput {
  walk: unknown;
  places: unknown;
  frame: LocalFrame;
  /** The box to plan (half-open, by chunk midpoint) and its tile seed. */
  area: PlanArea;
  /** Low plans nothing, whatever the caps say. */
  tier: Tier;
  /** Agents for this box at density 1: `tileCap(tier, ring, "vehicles" | "people", tile, frame)`. */
  caps: { vehicles: number; people: number };
  m: Manifest;
  weights?: MoodMix;
}

interface Cand {
  id: string;
  edge: Edge;
  prio: number;
}

/** One run of valid vertices of an eligible walk line, in local metres. */
interface Run {
  fid: string;
  ri: number;
  kind: Agent["kind"];
  type: string;
  pts: P[];
  length: number;
  bb: [number, number, number, number];
}
const runsCache = new WeakMap<object, WeakMap<object, Run[]>>();
const busyCache = new WeakMap<object, WeakMap<object, P[]>>();

/** The vehicle and people lines of the walk layer, built once per layer and frame. */
const runsOf = (walk: unknown, frame: LocalFrame): Run[] =>
  perLayer(runsCache, walk, frame, () => {
    const out: Run[] = [];
    featuresOf(walk).forEach((f, fi) => {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) return;
      const p = propsOf(f);
      const type = String(p.type ?? "");
      const kind: Agent["kind"] | null = VEHICLE_TYPES.has(type)
        ? "vehicle"
        : PEOPLE_TYPES.has(type)
          ? "person"
          : null;
      if (!kind) return;
      const fid = String(p.id ?? `w${fi}`);
      // Runs of consecutive valid vertices (an invalid coordinate breaks the line).
      const runs: P[][] = [[]];
      for (const c of g.coordinates) {
        const run = runs[runs.length - 1]!;
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
          if (run.length > 0) runs.push([]);
          continue;
        }
        const q = frame.toLocal(c[0] as number, c[1] as number);
        const last = run[run.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) run.push(q);
      }
      runs.forEach((pts, ri) => {
        if (pts.length < 2) return;
        let x0 = Number.POSITIVE_INFINITY;
        let z0 = Number.POSITIVE_INFINITY;
        let x1 = Number.NEGATIVE_INFINITY;
        let z1 = Number.NEGATIVE_INFINITY;
        for (const [x, z] of pts) {
          x0 = Math.min(x0, x);
          z0 = Math.min(z0, z);
          x1 = Math.max(x1, x);
          z1 = Math.max(z1, z);
        }
        out.push({ fid, ri, kind, type, pts, length: polyLength(pts), bb: [x0, z0, x1, z1] });
      });
    });
    return out;
  });

/** Points of the places that triple the spawn weight (school, mall, park). */
const busyOf = (places: unknown, frame: LocalFrame): P[] =>
  perLayer(busyCache, places, frame, () => {
    const busy: P[] = [];
    for (const f of featuresOf(places)) {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
      const [lon, lat] = g.coordinates as number[];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (BUSY_PLACES.has(String(propsOf(f).type))) busy.push(frame.toLocal(lon!, lat!));
    }
    return busy;
  });

/** The sub-polyline of `pts` between arc lengths s0 and s1. */
function slice(pts: P[], s0: number, s1: number): P[] {
  const out: P[] = [];
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (s: number): P => {
      const t = l === 0 ? 0 : (s - walked) / l;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    if (out.length === 0 && s0 <= walked + l) out.push(at(Math.max(s0, walked)));
    if (out.length > 0) {
      if (s1 <= walked + l + 1e-9) {
        out.push(at(Math.min(s1, walked + l)));
        return out;
      }
      out.push(b);
    }
    walked += l;
  }
  return out;
}

/** The point at arc length s along `pts`. */
function pointAt(pts: P[], s: number): P {
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= walked + l && l > 0) {
      const t = (s - walked) / l;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += l;
  }
  return pts[pts.length - 1]!;
}

/**
 * Vehicles on street/major_road edges (speed 8–11 m/s, major 12–16), people on footway/path/pedestrian
 * (1.2–1.5 m/s, jogger 2.5, cyclist 4.5); spawn weight ×3 within 150 m of places of type
 * school|mall|park. Every walk line is cut into chunks of at most AGENT_CHUNK_M; a chunk belongs to
 * the box holding its arc midpoint and seeds about one candidate per 25 m of spawn weight, keyed by
 * the chunk (never by the box). Count = cap × densityFor(weights), picked from the candidates in
 * the order of a hash salted with the tile seed; without weights, the peak (dusk) density, so a
 * layer can thin the plan by mood without replanning (the plan is in pick order).
 */
export function planAgents(input: AgentsInput): Agent[] {
  const { frame, m, area } = input;
  if (input.tier === "low") return [];
  const box = area.box;
  const reach = growBox(box, AGENT_CHUNK_M);
  const density = input.weights ? densityFor(input.weights) : DENSITY_PEAK;

  const busy = busyOf(input.places, frame);
  const nearBusy = (pts: P[]) =>
    pts.some((p) => busy.some((b) => Math.hypot(p[0] - b[0], p[1] - b[1]) <= BUSY_RANGE_M));

  const cands: Record<Agent["kind"], Cand[]> = { vehicle: [], person: [] };
  for (const { fid, ri, kind, type, pts: run, length, bb } of runsOf(input.walk, frame)) {
    if (!touchesBox(reach, bb[0], bb[1], bb[2], bb[3])) continue;
    if (length < MIN_EDGE_M) continue;
    const n = Math.ceil(length / AGENT_CHUNK_M);
    const cl = length / n;
    for (let c = 0; c < n; c++) {
      const mid = pointAt(run, (c + 0.5) * cl);
      if (!inBox(box, mid[0], mid[1])) continue;
      const pts = slice(run, c * cl, (c + 1) * cl);
      const chunk = `${fid}:${ri}:${c}`;
      const weight = cl * (nearBusy(pts) ? BUSY_WEIGHT : 1);
      const edge: Edge = { pts, length: cl, type, weight };
      const k = Math.floor(weight / SPAWN_SPACING_M + hash01(chunk, `spawn:${kind}`));
      for (let j = 0; j < k; j++) {
        const id = `${kind}:${chunk}:${j}`;
        cands[kind].push({ id, edge, prio: hash01(id, area.seed) });
      }
    }
  }

  const out: Agent[] = [];
  const plan = (kind: Agent["kind"], list: Cand[], cap: number, asset: string) => {
    const variants = Object.keys(m.assets[asset]?.variants ?? {});
    const n = Math.floor(Math.max(0, cap) * density);
    if (n <= 0 || list.length === 0 || variants.length === 0) return;
    list.sort((a, b) => a.prio - b.prio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const light = variants.filter((v) => !MAJOR_ONLY.has(v));
    for (const { id, edge: e } of list.slice(0, n)) {
      const major = e.type === "major_road";
      const pool = kind === "vehicle" && !major && light.length > 0 ? light : variants;
      const variant = pool[Math.floor(hash01(id, "variant") * pool.length)] as string;
      const reverse = hash01(id, "dir") < 0.5;
      const pts = reverse ? [...e.pts].reverse() : e.pts;
      let lateral: number;
      let speed: number;
      if (kind === "vehicle") {
        lateral = (WIDTH_BY_TYPE[e.type] ?? 6) * LANE_SHARE;
        speed = lerp(major ? SPEED.major : SPEED.street, hash01(id, "speed"));
      } else {
        const side = hash01(id, "side") < 0.5 ? -1 : 1;
        lateral = side * lerp(PAVEMENT_OFFSET_M, hash01(id, "lateral"));
        speed =
          variant === "jogger"
            ? SPEED.jogger
            : variant === "cyclist"
              ? SPEED.cyclist
              : lerp(SPEED.walk, hash01(id, "speed"));
      }
      const lane = offsetLeft(pts, lateral);
      const length = polyLength(lane);
      out.push({
        id,
        kind,
        variant,
        path: Float32Array.from(lane.flat()),
        length,
        speed,
        offset: hash01(id, "offset") * length,
      });
    }
  };
  plan("vehicle", cands.vehicle, input.caps.vehicles, "vehicles");
  plan("person", cands.person, input.caps.people, "people");
  return out;
}
