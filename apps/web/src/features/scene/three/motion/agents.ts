import { WIDTH_BY_TYPE } from "../../cesium/stylised/ground";
import type { Tier } from "../../cesium/stylised/quality";
import { hash01 } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { capFor } from "../props/caps";

/**
 * DECORATIVE traffic and pedestrians for the hero district. Agents loop along walk edges as
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

/** Loops along the path; yaw turns the model's +z (its front) onto the tangent. */
export function poseAt(a: Agent, tSec: number): { x: number; z: number; yaw: number } {
  const p = a.path;
  const n = p.length / 2;
  if (n < 2 || !(a.length > 0)) return { x: p[0] ?? 0, z: p[1] ?? 0, yaw: 0 };
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
      return { x: ax + dx * t, z: az + dz * t, yaw: Math.atan2(dx, dz) };
    }
    s -= l;
  }
  return { x: p[0] as number, z: p[1] as number, yaw: 0 };
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
 * Vehicles on street/major_road edges (speed 8–11 m/s, major 12–16), people on footway/path/pedestrian
 * (1.2–1.5 m/s, jogger 2.5, cyclist 4.5); spawn weight ×3 within 150 m of places of type
 * school|mall|park. Count = cap × densityFor(weights); without weights, the peak (dusk) density,
 * so a layer can thin the plan by mood without replanning.
 */
export function planAgents(input: {
  walk: unknown;
  places: unknown;
  frame: LocalFrame;
  centre: [number, number];
  radiusM: number;
  tier: Tier;
  m: Manifest;
  seed: string;
  weights?: MoodMix;
}): Agent[] {
  const { frame, radiusM, m, seed } = input;
  const density = input.weights ? densityFor(input.weights) : DENSITY_PEAK;
  const [cx, cz] = frame.toLocal(input.centre[0], input.centre[1]);
  const inside = (p: P) => Math.hypot(p[0] - cx, p[1] - cz) <= radiusM;

  const busy: P[] = [];
  for (const f of featuresOf(input.places)) {
    const g = f.geometry;
    if (!isRec(g) || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const [lon, lat] = g.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (BUSY_PLACES.has(String(propsOf(f).type))) busy.push(frame.toLocal(lon!, lat!));
  }
  const nearBusy = (pts: P[]) =>
    pts.some((p) => busy.some((b) => Math.hypot(p[0] - b[0], p[1] - b[1]) <= BUSY_RANGE_M));

  const vehicleEdges: Edge[] = [];
  const peopleEdges: Edge[] = [];
  for (const f of featuresOf(input.walk)) {
    const g = f.geometry;
    if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) continue;
    const type = String(propsOf(f).type ?? "");
    const list = VEHICLE_TYPES.has(type)
      ? vehicleEdges
      : PEOPLE_TYPES.has(type)
        ? peopleEdges
        : null;
    if (!list) continue;
    // Runs of consecutive vertices inside the radius; each run long enough is one edge.
    let run: P[] = [];
    const flush = () => {
      const length = polyLength(run);
      if (run.length >= 2 && length >= MIN_EDGE_M)
        list.push({
          pts: run,
          length,
          type,
          weight: length * (nearBusy(run) ? BUSY_WEIGHT : 1),
        });
      run = [];
    };
    for (const c of g.coordinates) {
      if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
        flush();
        continue;
      }
      const q = frame.toLocal(c[0] as number, c[1] as number);
      if (!inside(q)) {
        flush();
        continue;
      }
      const last = run[run.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) run.push(q);
    }
    flush();
  }

  const out: Agent[] = [];
  const plan = (kind: Agent["kind"], edges: Edge[], cap: number, asset: string) => {
    const variants = Object.keys(m.assets[asset]?.variants ?? {});
    const n = Math.floor(cap * density);
    if (n <= 0 || edges.length === 0 || variants.length === 0) return;
    const cum: number[] = [];
    let total = 0;
    for (const e of edges) {
      total += e.weight;
      cum.push(total);
    }
    const light = variants.filter((v) => !MAJOR_ONLY.has(v));
    for (let i = 0; i < n; i++) {
      const id = `${seed}:${kind}:${i}`;
      const r = hash01(id, "edge") * total;
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((cum[mid] as number) > r) hi = mid;
        else lo = mid + 1;
      }
      const e = edges[lo] as Edge;
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
  plan("vehicle", vehicleEdges, capFor(input.tier, "vehicles"), "vehicles");
  plan("person", peopleEdges, capFor(input.tier, "people"), "people");
  return out;
}
