import { WIDTH_BY_TYPE } from "../../shared/roads";
import type { LocalFrame } from "../frame";
import { perLayer } from "../stream/area";
import { pointAlong, polyLength } from "./walkPath";

export { pointAlong };

/**
 * DECORATIVE junction graph for the city's moving agents (demo polish A1): walk-layer LineStrings of
 * the given types become edges, their endpoints snapped together within SNAP_M become nodes. An
 * agent that reaches a node picks a connected edge (`next`), never the one it came on unless the
 * node is a dead end (degree 1). Display only: nothing here is routing, and no fact is read from it.
 */
export type P = [number, number];

const GRID_OFF = 1048576;

/** Line endpoints this close are one node (m). */
export const SNAP_M = 1.0;

export interface GraphEdge {
  id: number;
  /** `${feature id}:${run index}`: the same key `agents.ts` gives a run of valid vertices. */
  key: string;
  fid: string;
  type: string;
  /** Drawn road width (m), `WIDTH_BY_TYPE`. */
  width: number;
  /** Polyline in local metres, from node `a` to node `b`. */
  pts: P[];
  length: number;
  a: number;
  b: number;
}

/** One end of an edge at a node: leave the node along `edge` starting from its `end` (0: a, 1: b). */
export interface Step {
  edge: number;
  end: 0 | 1;
}

export interface RoadGraph {
  nodes: P[];
  edges: GraphEdge[];
  /** Edge ends at each node (a loop edge appears twice). */
  inc: Step[][];
  byKey: Map<string, GraphEdge>;
  degree(node: number): number;
  /**
   * The step out of `atNode` after arriving on `edgeId`: a seeded pick (`rnd` in [0, 1)) among the
   * node's other edge ends that pass `accept`. Never the incoming edge end, unless the node has
   * degree 1 (a real dead end: the U-turn). Null when no other end is acceptable.
   * `arrived` names the end the agent arrived at (needed only for a loop edge, whose both ends touch
   * the node); by default the end of `edgeId` at `atNode`.
   */
  next(
    edgeId: number,
    atNode: number,
    rnd: number,
    opts?: { arrived?: 0 | 1; accept?: (s: Step) => boolean },
  ): Step | null;
  /** The node at the far end of a step. */
  far(s: Step): number;
  /** The step's polyline in travel order (shared array: do not mutate). */
  ptsOf(s: Step): P[];
  /** Unit direction leaving the node along a step (a chord over its first DIR_CHORD_M). */
  leaveDir(s: Step): P;
}

/** Leave and arrive directions are chords over this much of the edge (m), steady on kinked lines. */
export const DIR_CHORD_M = 6;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** One run of valid consecutive vertices of a walk LineString, in local metres. */
export interface WalkRun {
  fid: string;
  /** Run index within the feature; `${fid}:${ri}` is the edge key everywhere. */
  ri: number;
  type: string;
  pts: P[];
  length: number;
}

/**
 * The walk layer's LineStrings whose `type` passes `keep`, split into runs of valid consecutive
 * vertices (an invalid coordinate breaks a line; repeated vertices are dropped; runs of fewer than
 * two points are left out). The one parser behind `buildRoadGraph` and `agents.ts` `runsOf`, so
 * their `${fid}:${ri}` keys always agree. Pure, in feature order.
 */
export function walkRuns(
  walk: unknown,
  frame: LocalFrame,
  keep: (type: string) => boolean,
): WalkRun[] {
  const out: WalkRun[] = [];
  const features = isRec(walk) && Array.isArray(walk.features) ? walk.features.filter(isRec) : [];
  features.forEach((f, fi) => {
    const g = f.geometry;
    if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) return;
    const props = isRec(f.properties) ? f.properties : {};
    const type = String(props.type ?? "");
    if (!keep(type)) return;
    const fid = String(props.id ?? `w${fi}`);
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
      out.push({ fid, ri, type, pts, length: polyLength(pts) });
    });
  });
  return out;
}

/** Unit chord direction from the start of `pts` over its first `m` metres. */
export function chordDir(pts: P[], m = DIR_CHORD_M): P {
  const a = pts[0]!;
  const b = pointAlong(pts, m);
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  return l > 1e-9 ? [dx / l, dz / l] : [0, 1];
}

/**
 * Builds the graph of the walk layer's LineStrings whose `type` is in `kinds`. Each run of valid
 * consecutive vertices (an invalid coordinate breaks a line; repeated vertices are dropped) of at
 * least two points is an edge; edge endpoints within SNAP_M of an existing node join it (the
 * nearest), else start a new node. Pure and deterministic (feature order).
 */
export function buildRoadGraph(
  walk: unknown,
  frame: LocalFrame,
  kinds: ReadonlySet<string>,
): RoadGraph {
  const nodes: P[] = [];
  const grid = new Map<number, number[]>();
  const cell = (v: number) => Math.floor(v / SNAP_M);
  // grid key: cells offset by 2^20, so keys stay exact integers for any township extent
  const gk = (i: number, j: number) => (i + GRID_OFF) * (2 * GRID_OFF) + (j + GRID_OFF);
  const nodeAt = (q: P): number => {
    const ci = cell(q[0]);
    const cj = cell(q[1]);
    let best = -1;
    let bd = SNAP_M;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const n of grid.get(gk(ci + di, cj + dj)) ?? []) {
          const p = nodes[n]!;
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d <= bd) {
            bd = d;
            best = n;
          }
        }
    if (best >= 0) return best;
    const id = nodes.length;
    nodes.push([q[0], q[1]]);
    const k = gk(ci, cj);
    const l = grid.get(k);
    if (l) l.push(id);
    else grid.set(k, [id]);
    return id;
  };

  const edges: GraphEdge[] = [];
  for (const { fid, ri, type, pts, length } of walkRuns(walk, frame, (t) => kinds.has(t))) {
    if (!(length > 0)) continue;
    const a = nodeAt(pts[0]!);
    const b = nodeAt(pts[pts.length - 1]!);
    edges.push({
      id: edges.length,
      key: `${fid}:${ri}`,
      fid,
      type,
      width: WIDTH_BY_TYPE[type] ?? 6,
      pts,
      length,
      a,
      b,
    });
  }

  const inc: Step[][] = nodes.map(() => []);
  for (const e of edges) {
    inc[e.a]!.push({ edge: e.id, end: 0 });
    inc[e.b]!.push({ edge: e.id, end: 1 });
  }
  const byKey = new Map(edges.map((e) => [e.key, e]));
  const reversed = new Map<number, P[]>();
  const ptsOf = (s: Step): P[] => {
    const e = edges[s.edge]!;
    if (s.end === 0) return e.pts;
    let r = reversed.get(e.id);
    if (!r) {
      r = [...e.pts].reverse();
      reversed.set(e.id, r);
    }
    return r;
  };
  const dirs = new Map<number, P>();
  return {
    nodes,
    edges,
    inc,
    byKey,
    degree: (n) => inc[n]?.length ?? 0,
    far: (s) => {
      const e = edges[s.edge]!;
      return s.end === 0 ? e.b : e.a;
    },
    ptsOf,
    leaveDir(s) {
      const k = s.edge * 2 + s.end;
      let d = dirs.get(k);
      if (!d) {
        d = chordDir(ptsOf(s));
        dirs.set(k, d);
      }
      return d;
    },
    next(edgeId, atNode, rnd, opts = {}) {
      const at = inc[atNode];
      const e = edges[edgeId];
      if (!at || !e) return null;
      const arrived: 0 | 1 = opts.arrived ?? (e.b === atNode ? 1 : 0);
      if (at.length === 1) {
        const only = at[0]!;
        return only.edge === edgeId && only.end === arrived ? only : null;
      }
      const options = at.filter(
        (s) => !(s.edge === edgeId && s.end === arrived) && (!opts.accept || opts.accept(s)),
      );
      if (options.length === 0) return null;
      const r = Math.min(0.999999, Math.max(0, rnd));
      return options[Math.floor(r * options.length)]!;
    },
  };
}

const graphCache = new WeakMap<object, WeakMap<object, Map<string, RoadGraph>>>();

/** `buildRoadGraph`, built once per walk layer, frame and type set (like `runsOf`). */
export function roadGraphOf(
  walk: unknown,
  frame: LocalFrame,
  kinds: ReadonlySet<string>,
): RoadGraph {
  const byKinds = perLayer(graphCache, walk, frame, () => new Map<string, RoadGraph>());
  const key = [...kinds].sort().join("|");
  let g = byKinds.get(key);
  if (!g) {
    g = buildRoadGraph(walk, frame, kinds);
    byKinds.set(key, g);
  }
  return g;
}
