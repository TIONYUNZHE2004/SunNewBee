import { ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../shared/roads";
import { hash01 } from "../assets/fit";
import type { LocalFrame } from "../frame";
import { type Boundary, insideBoundary } from "../ground/boundary";
import {
  type BBox,
  bboxOf,
  distSeg,
  inPoly,
  type P,
  type Poly,
  polygonsOf,
} from "../props/polyGeom";

/**
 * Street dressing kit planner (B-T7, spec §4 B2). Pure: the same input always gives the same
 * output, and every candidate is keyed by global ids (source ids, line ids and arc positions,
 * frame-aligned lattice cells), so planning two areas separately gives the same items where they
 * overlap.
 *
 * Two families, never mixed:
 *  - **Fact props** (`planFactProps`): ONE per data feature, each carrying its `sourceId`:
 *    a zebra crossing per walk `crossing` edge whose claim says marked, a traffic signal / bus stop / shelter / bench per
 *    `/layers/street_furniture` point. Nothing else draws these models (AC-B7). A prop whose point
 *    lies on a drawn ribbon is set just past the ribbon's edge (`anchor` keeps the data point).
 *  - **Decorative props** (`planDecorProps`): planters and grass tufts along kerbs, kerb edging,
 *    flowers, grass tufts and lamp posts in parks. Seeded, display only ("Decorative details are
 *    illustrative."), never within `DECOR_KEEPOUT_M` of any walk line (the route runs on the walk
 *    network), and never a fact model: no decorative signal, bus stop, shelter, bench or zebra.
 *
 * The journey modules never import this folder (import-boundary test), so a decorative prop can
 * never reach a `JourneyPlan` or cause an event (AC-B8).
 */

export type FactKind =
  | "crossing"
  | "traffic_signals"
  | "bus_stop"
  | "shelter"
  | "bench"
  | "picnic_table";
export const FACT_MODELS = ["zebra", "signal", "busStop", "shelter", "bench"] as const;
export const DECOR_MODELS = ["planter", "lampPost", "kerb", "flowers", "grassTuft"] as const;
export type FactModel = (typeof FACT_MODELS)[number];
export type DecorModel = (typeof DECOR_MODELS)[number];
export type DressModel = FactModel | DecorModel;

export const MODEL_OF_KIND: Record<FactKind, FactModel> = {
  crossing: "zebra",
  traffic_signals: "signal",
  bus_stop: "busStop",
  shelter: "shelter",
  bench: "bench",
  picnic_table: "bench",
};

/** One drawn instance. Fact instances carry their `sourceId`; decorative ones never do. */
export interface DressItem {
  /** Stable key (global ids): the bubble keeps an instance's fade across re-plans by it. */
  key: string;
  model: DressModel;
  x: number;
  z: number;
  /** Rotation about +y (rad); the model's +z faces the nearest line (props) / runs along it. */
  yaw: number;
  /** Uniform scale. */
  s: number;
  /** Palette index (flowers only). */
  tint?: number;
  sourceId?: string;
}

export interface FactProp {
  sourceId: string;
  kind: FactKind;
  /** The data point (crossings: the edge midpoint), local metres. */
  anchor: P;
  items: DressItem[];
}

export interface FactPlan {
  props: FactProp[];
  /**
   * outside: features outside the boundary; invalid: no source id / kind / geometry; unmarked:
   * crossings inside without a usable marked claim (drawn as the plain crossing ribbon only).
   */
  stats: { outside: number; invalid: number; unmarked: number };
}

/** A decorative prop keeps this far (m, from its footprint edge) from every walk line. */
export const DECOR_KEEPOUT_M = 1;
/** Zebra bar pitch along the crossing (bar + gap) and the bar's depth along it (m). */
export const ZEBRA_PITCH_M = 1;
export const ZEBRA_BAR_M = 0.5;
/** Walk types that are drawn as roads with kerbs. */
const KERB_TYPES = new Set(["street", "residential", "service", "major_road"]);
const FOOT_TYPES = new Set(["footway", "path", "pedestrian", "sidewalk"]);
/** A fact prop standing on a ribbon is set this far past the ribbon edge (m), by model. */
const PAST_EDGE_M: Record<FactModel, number> = {
  zebra: 0,
  signal: 0.5,
  busStop: 0.6,
  shelter: 1.4,
  bench: 0.6,
};
/** Footprint radius per model (m): the keep-out is measured from this edge. */
export const MODEL_RADIUS_M: Record<DressModel, number> = {
  zebra: 1.3,
  signal: 0.2,
  busStop: 0.25,
  shelter: 1.3,
  bench: 0.8,
  planter: 0.5,
  lampPost: 0.2,
  kerb: 0.15,
  flowers: 0.35,
  grassTuft: 0.2,
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): Record<string, unknown>[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features.filter(isRec) : [];
const propsOf = (f: Record<string, unknown>): Record<string, unknown> =>
  isRec(f.properties) ? f.properties : {};
const isPt = (c: unknown): c is [number, number] =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);

export interface WalkLine {
  /** Planning key: the feature id, or `walk#<index>` when it has none (never a source id). */
  id: string;
  /** The feature's own id, or null: only this may become a fact prop's `sourceId`. */
  sourceId: string | null;
  type: string;
  pts: P[];
  half: number;
  /**
   * The crossing marking claim value (`claims.crossing` in walk.geojson, or the access layer's
   * flat `crossing` / `crossing_status`) when its status is reported or verified; else null.
   */
  crossing: string | null;
}

/** Crossing claim values that mean painted zebra stripes. `unmarked`, `no`, `traffic_signals`
 * (signals say nothing about paint) and a missing claim draw no stripes. */
export const ZEBRA_VALUES: ReadonlySet<string> = new Set(["marked", "zebra"]);
const USABLE_STATUS = new Set(["reported", "verified"]);

/** The crossing marking value of a walk feature's properties, if its claim is usable. */
export function crossingMarking(p: Record<string, unknown>): string | null {
  const claims = isRec(p.claims) ? p.claims : null;
  const c = claims && isRec(claims.crossing) ? claims.crossing : null;
  const value = c ? c.value : p.crossing;
  const status = c ? c.status : p.crossing_status;
  return typeof value === "string" && typeof status === "string" && USABLE_STATUS.has(status)
    ? value
    : null;
}

/** Walk LineStrings (the access layer or walk.geojson) in local metres. */
export function walkLines(walk: unknown, frame: LocalFrame): WalkLine[] {
  const out: WalkLine[] = [];
  featuresOf(walk).forEach((f, i) => {
    const g = f.geometry;
    if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) return;
    if (!g.coordinates.every(isPt)) return;
    const pts = (g.coordinates as [number, number][]).map((c) => frame.toLocal(c[0], c[1]));
    if (pts.length < 2) return;
    const p = propsOf(f);
    const type = typeof p.type === "string" ? p.type : "";
    const sourceId = typeof p.id === "string" && p.id.trim() ? p.id.trim() : null;
    out.push({
      id: sourceId ?? `walk#${i}`,
      sourceId,
      type,
      pts,
      half: (WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN) / 2,
      crossing: type === "crossing" ? crossingMarking(p) : null,
    });
  });
  return out;
}

/** Segments of the walk lines, bucketed on a grid, for nearest-line and keep-out queries. */
export class SegIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly segs: { a: P; b: P; line: WalkLine }[] = [];
  constructor(
    lines: readonly WalkLine[],
    private readonly cell = 16,
    box?: BBox,
  ) {
    for (const line of lines)
      for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1]!;
        const b = line.pts[i]!;
        const x0 = Math.min(a[0], b[0]);
        const z0 = Math.min(a[1], b[1]);
        const x1 = Math.max(a[0], b[0]);
        const z1 = Math.max(a[1], b[1]);
        if (box && (x1 < box[0] || x0 > box[2] || z1 < box[1] || z0 > box[3])) continue;
        const k = this.segs.push({ a, b, line }) - 1;
        for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
          for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
            const key = cx * 100003 + cz;
            const list = this.cells.get(key);
            if (list) list.push(k);
            else this.cells.set(key, [k]);
          }
      }
  }
  private near(x: number, z: number, r: number): Set<number> {
    const out = new Set<number>();
    const c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++)
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++)
        for (const k of this.cells.get(cx * 100003 + cz) ?? []) out.add(k);
    return out;
  }
  /** Distance to the nearest walk line within `r` (Infinity when none). */
  dist(x: number, z: number, r: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const k of this.near(x, z, r)) {
      const s = this.segs[k]!;
      best = Math.min(best, distSeg(x, z, s.a, s.b));
    }
    return best;
  }
  /** The nearest segment within `r`: its line, distance and closest point. */
  nearest(x: number, z: number, r: number): { line: WalkLine; d: number; q: P; t: P } | null {
    let best: { line: WalkLine; d: number; q: P; t: P } | null = null;
    for (const k of this.near(x, z, r)) {
      const { a, b, line } = this.segs[k]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const q: P = [a[0] + dx * u, a[1] + dz * u];
      const d = Math.hypot(x - q[0], z - q[1]);
      // Ties go to the wider line (a bus stop on a road's centre line belongs to the road).
      if (
        !best ||
        d < best.d - 1e-9 ||
        (Math.abs(d - best.d) <= 1e-9 && line.half > best.line.half)
      ) {
        const l = Math.sqrt(l2);
        best = { line, d, q, t: [dx / l, dz / l] };
      }
    }
    return best;
  }
}

/** Points every `step` metres of arc along `pts` (from `start`), with the unit tangent. */
export function along(
  pts: readonly P[],
  step: number,
  start = step / 2,
): { s: number; x: number; z: number; tx: number; tz: number }[] {
  const out: { s: number; x: number; z: number; tx: number; tz: number }[] = [];
  let acc = 0;
  let next = start;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const tx = (b[0] - a[0]) / len;
    const tz = (b[1] - a[1]) / len;
    while (next <= acc + len) {
      const u = next - acc;
      out.push({ s: next, x: a[0] + tx * u, z: a[1] + tz * u, tx, tz });
      next += step;
    }
    acc += len;
  }
  return out;
}

const lengthOf = (pts: readonly P[]) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
};

/** Yaw that turns the model's +z toward direction (dx, dz). Three.js: +z rotated by yaw about +y. */
const yawToward = (dx: number, dz: number) => Math.atan2(dx, dz);

/**
 * Fact props from data only, one per feature (AC-B7). `furniture` is the `/layers/street_furniture`
 * FeatureCollection; `walk` the walk LineStrings (crossings come from its `crossing` edges). With a
 * boundary, a feature outside it (crossings: edge midpoint outside) is not drawn.
 */
export function planFactProps(input: {
  furniture: unknown;
  walk: unknown;
  frame: LocalFrame;
  boundary?: Boundary | null;
  lines?: WalkLine[];
}): FactPlan {
  const { frame, boundary } = input;
  const lines = input.lines ?? walkLines(input.walk, frame);
  const index = new SegIndex(lines);
  const props: FactProp[] = [];
  const stats = { outside: 0, invalid: 0, unmarked: 0 };
  const inside = (x: number, z: number) => !boundary || insideBoundary(boundary, x, z);

  // Zebra crossings: one per walk `crossing` edge whose claim says it is marked (fix round 1: the
  // stripes are a fact; an unmarked or unknown crossing keeps the plain ribbon), bars across the
  // walking direction. An edge without its own id is never drawn (no synthetic source ids).
  for (const line of lines) {
    if (line.type !== "crossing") continue;
    if (!line.sourceId) {
      stats.invalid++;
      continue;
    }
    const len = lengthOf(line.pts);
    const mid = along(line.pts, len, len / 2)[0] ?? {
      x: line.pts[0]![0],
      z: line.pts[0]![1],
    };
    if (!inside(mid.x, mid.z)) {
      stats.outside++;
      continue;
    }
    if (!line.crossing || !ZEBRA_VALUES.has(line.crossing)) {
      stats.unmarked++;
      continue;
    }
    const sourceId = line.sourceId;
    const n = Math.max(2, Math.floor(len / ZEBRA_PITCH_M));
    const start = (len - (n - 1) * ZEBRA_PITCH_M) / 2;
    const items = along(line.pts, ZEBRA_PITCH_M, Math.max(0, start))
      .slice(0, n)
      .map((p, k) => ({
        key: `zebra:${sourceId}:${k}`,
        model: "zebra" as const,
        x: p.x,
        z: p.z,
        yaw: yawToward(p.tx, p.tz),
        s: 1,
        sourceId,
      }));
    if (items.length === 0) {
      stats.invalid++;
      continue;
    }
    props.push({ sourceId, kind: "crossing", anchor: [mid.x, mid.z], items });
  }

  // Street furniture points.
  for (const f of featuresOf(input.furniture)) {
    const p = propsOf(f);
    const g = f.geometry;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const kind = p.kind as FactKind;
    if (
      !id ||
      !(kind in MODEL_OF_KIND) ||
      kind === "crossing" ||
      !isRec(g) ||
      g.type !== "Point" ||
      !isPt(g.coordinates)
    ) {
      stats.invalid++;
      continue;
    }
    const [ax, az] = frame.toLocal(g.coordinates[0], g.coordinates[1]);
    if (!inside(ax, az)) {
      stats.outside++;
      continue;
    }
    const model = MODEL_OF_KIND[kind];
    let x = ax;
    let z = az;
    let yaw = hash01(id, "dress:yaw") * Math.PI * 2;
    const near = index.nearest(ax, az, 30);
    if (near) {
      // Normal from the line to the point (a point on the line picks a side by hash).
      let nx = ax - near.q[0];
      let nz = az - near.q[1];
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-6) {
        const side = hash01(id, "dress:side") < 0.5 ? -1 : 1;
        nx = -near.t[1] * side;
        nz = near.t[0] * side;
      } else {
        nx /= nl;
        nz /= nl;
      }
      const clear = near.line.half + PAST_EDGE_M[model];
      if (near.d < clear) {
        x = near.q[0] + nx * clear;
        z = near.q[1] + nz * clear;
      }
      // Face the line: the model's +z points back toward it.
      yaw = yawToward(-nx, -nz);
    }
    props.push({
      sourceId: id,
      kind,
      anchor: [ax, az],
      items: [{ key: `fact:${id}`, model, x, z, yaw, s: 1, sourceId: id }],
    });
  }
  return { props, stats };
}

/**
 * The drawn fact benches (kind `bench`, not picnic tables) as seats for the journey hero: footprint
 * centre, the facing of someone sitting on it (the model's +z, toward the path) and the source id.
 */
export const factBenches = (plan: FactPlan): { id: string; x: number; z: number; yaw: number }[] =>
  plan.props
    .filter((p) => p.kind === "bench")
    .flatMap((p) => p.items.map((it) => ({ id: p.sourceId, x: it.x, z: it.z, yaw: it.yaw })));

/** Every drawn instance of a fact plan (each carries its source id). */
export const factItems = (plan: FactPlan): DressItem[] => plan.props.flatMap((p) => p.items);

/** Spacing and offsets of the decorative dressing (m). */
export const DECOR = {
  kerbPieceM: 3,
  kerbExtraM: 0.12,
  planterSpacingM: 36,
  planterExtraM: 1.6,
  vergeTuftSpacingM: 7,
  vergeTuftOffsetM: 4.2,
  parkLampSpacingM: 24,
  parkLampOffsetM: 1.6,
  parkCellM: 6,
  flowerShare: 0.18,
  tuftShare: 0.32,
} as const;

/**
 * Seeded decorative props inside `box` (local [x0, z0, x1, z1]): kerb edging and planters and
 * verge tufts along roads, lamp posts beside park paths, flowers and tufts in parks. None is
 * within DECOR_KEEPOUT_M of any walk line (measured from its footprint), inside a building
 * footprint, or outside the boundary.
 */
export function planDecorProps(input: {
  walk?: unknown;
  lines?: WalkLine[];
  parks: unknown;
  buildings?: unknown;
  frame: LocalFrame;
  boundary?: Boundary | null;
  box: BBox;
}): DressItem[] {
  const { frame, boundary, box } = input;
  const lines = input.lines ?? walkLines(input.walk, frame);
  const pad = 40;
  const padBox: BBox = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
  const index = new SegIndex(lines, 16, padBox);
  const inBox = (x: number, z: number) => x >= box[0] && x < box[2] && z >= box[1] && z < box[3];
  const touches = (b: BBox) =>
    !(b[2] < padBox[0] || b[0] > padBox[2] || b[3] < padBox[1] || b[1] > padBox[3]);
  const parks: { poly: Poly; bb: BBox }[] = [];
  for (const f of featuresOf(input.parks))
    for (const poly of polygonsOf(f.geometry, frame)) {
      const bb = bboxOf(poly[0]!);
      if (touches(bb)) parks.push({ poly, bb });
    }
  const foot: { poly: Poly; bb: BBox }[] = [];
  for (const f of featuresOf(isRec(input.buildings) ? input.buildings : null))
    for (const poly of polygonsOf(f.geometry, frame)) {
      const bb = bboxOf(poly[0]!);
      if (touches(bb)) foot.push({ poly, bb });
    }
  const inList = (list: { poly: Poly; bb: BBox }[], x: number, z: number, grow = 0) =>
    list.some(
      ({ poly, bb }) =>
        x >= bb[0] - grow &&
        x <= bb[2] + grow &&
        z >= bb[1] - grow &&
        z <= bb[3] + grow &&
        inPoly(x, z, poly),
    );
  const out: DressItem[] = [];
  const ok = (model: DecorModel, x: number, z: number, extra: P[] = []) => {
    if (!inBox(x, z)) return false;
    if (boundary && !insideBoundary(boundary, x, z)) return false;
    const r = MODEL_RADIUS_M[model];
    for (const [px, pz] of [[x, z] as P, ...extra])
      if (index.dist(px, pz, DECOR_KEEPOUT_M + r + 1) < DECOR_KEEPOUT_M + r) return false;
    return !inList(foot, x, z);
  };
  const push = (item: DressItem) => out.push(item);

  for (const line of lines) {
    const bb = bboxOf(line.pts);
    if (!touches(bb)) continue;
    if (KERB_TYPES.has(line.type)) {
      // Kerb edging: short rounded pieces just past the road edge, both sides.
      const off = line.half + DECOR.kerbExtraM;
      for (const p of along(line.pts, DECOR.kerbPieceM)) {
        for (const side of [-1, 1]) {
          const x = p.x + p.tz * off * side;
          const z = p.z - p.tx * off * side;
          const h = DECOR.kerbPieceM / 2;
          const ends: P[] = [
            [x - p.tx * h, z - p.tz * h],
            [x + p.tx * h, z + p.tz * h],
          ];
          if (!ok("kerb", x, z, ends)) continue;
          push({
            key: `kerb:${line.id}:${side}:${p.s.toFixed(1)}`,
            model: "kerb",
            x,
            z,
            yaw: yawToward(p.tx, p.tz),
            s: 1,
          });
        }
      }
      // Planters beyond the kerb, alternating sides by their index along the whole line.
      const poff = line.half + DECOR.planterExtraM;
      for (const p of along(line.pts, DECOR.planterSpacingM)) {
        const i = Math.round((p.s - DECOR.planterSpacingM / 2) / DECOR.planterSpacingM);
        const side = i % 2 === 0 ? 1 : -1;
        const x = p.x + p.tz * poff * side;
        const z = p.z - p.tx * poff * side;
        const key = `planter:${line.id}:${p.s.toFixed(1)}`;
        if (!ok("planter", x, z)) continue;
        push({
          key,
          model: "planter",
          x,
          z,
          yaw: yawToward(p.tx, p.tz),
          s: 0.9 + hash01(key, "s") * 0.2,
        });
      }
      // Grass tufts on the verge's outer half (street types only; major roads have no verge).
      if (line.type !== "major_road")
        for (const p of along(line.pts, DECOR.vergeTuftSpacingM)) {
          for (const side of [-1, 1]) {
            const key = `vtuft:${line.id}:${side}:${p.s.toFixed(1)}`;
            const o = DECOR.vergeTuftOffsetM + (hash01(key, "o") - 0.5) * 0.4;
            const x = p.x + p.tz * o * side;
            const z = p.z - p.tx * o * side;
            if (!ok("grassTuft", x, z)) continue;
            push({
              key,
              model: "grassTuft",
              x,
              z,
              yaw: hash01(key, "y") * Math.PI * 2,
              s: 0.8 + hash01(key, "s") * 0.5,
            });
          }
        }
    } else if (FOOT_TYPES.has(line.type)) {
      // Lamp posts beside park paths (a path whose point lies in a park).
      for (const p of along(line.pts, DECOR.parkLampSpacingM)) {
        if (!inList(parks, p.x, p.z)) continue;
        const key = `plamp:${line.id}:${p.s.toFixed(1)}`;
        const side = hash01(key, "side") < 0.5 ? -1 : 1;
        const o = line.half + DECOR.parkLampOffsetM;
        const x = p.x + p.tz * o * side;
        const z = p.z - p.tx * o * side;
        if (!ok("lampPost", x, z)) continue;
        push({ key, model: "lampPost", x, z, yaw: yawToward(-p.tz * side, p.tx * side), s: 1 });
      }
    }
  }

  // Flowers and tufts in parks, on a frame-aligned lattice.
  const c = DECOR.parkCellM;
  for (const { poly, bb } of parks) {
    const i0 = Math.floor(Math.max(bb[0], box[0]) / c);
    const i1 = Math.floor(Math.min(bb[2], box[2]) / c);
    const j0 = Math.floor(Math.max(bb[1], box[1]) / c);
    const j1 = Math.floor(Math.min(bb[3], box[3]) / c);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const key = `park:${i}:${j}`;
        const u = hash01(key, "kind");
        const model: DecorModel | null =
          u < DECOR.flowerShare
            ? "flowers"
            : u < DECOR.flowerShare + DECOR.tuftShare
              ? "grassTuft"
              : null;
        if (!model) continue;
        const x = (i + 0.5 + (hash01(key, "jx") - 0.5) * 0.7) * c;
        const z = (j + 0.5 + (hash01(key, "jz") - 0.5) * 0.7) * c;
        if (!inPoly(x, z, poly) || !ok(model, x, z)) continue;
        push({
          key,
          model,
          x,
          z,
          yaw: hash01(key, "y") * Math.PI * 2,
          s: 0.8 + hash01(key, "s") * 0.5,
          ...(model === "flowers" ? { tint: Math.floor(hash01(key, "tint") * 5) } : {}),
        });
      }
  }
  // Overlapping parks can put one lattice cell twice: keep the first.
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
}
