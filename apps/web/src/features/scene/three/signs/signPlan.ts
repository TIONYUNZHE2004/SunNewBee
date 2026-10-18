import { toBuildings } from "../../cesium/stylised/model";
import { displayHeight, localRing } from "../cityMesh";
import type { LocalFrame } from "../frame";
import { boxCentre, inBox, type PlanArea, perLayer } from "../stream/area";

/** One text-only shop sign on a building facade. Its source is carried along; no sign is made without one. */
export interface SignPlacement {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  /** Rotation about +y; the sign's face normal is (sin yaw, 0, cos yaw). */
  yaw: number;
  widthM: number;
  source: { url: string; label: string; asOf: string };
}

export const SIGN_OFFSET_M = 0.15;
export const SIGN_MAX_Y_M = 4.2;
const SIGN_Y_FRACTION = 0.45;
const SIGN_CHAR_M = 0.45;
const SIGN_MIN_WIDTH_M = 2;
const SIGN_FACADE_SHARE = 0.8;
/** Edges shorter than this are corners, not facades. */
const MIN_FACADE_M = 1.5;
/** Only streets this close to the footprint are considered. */
const STREET_RANGE_M = 120;

type P = [number, number];
const capOf = (cap: number | undefined) =>
  cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(cap));
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const features = (fc: unknown): unknown[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The link's host, when the feature names no source label (never a guessed publisher). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The URL itself when it is http(s); null for anything else (javascript:, data:, unparsable). */
export function httpUrl(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

function inside(p: P, ring: P[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

interface Street {
  pts: P[];
  /** Bounds: x0, z0, x1, z1. */
  bb: [number, number, number, number];
}
const streetsCache = new WeakMap<object, WeakMap<object, Street[]>>();
const buildingsCache = new WeakMap<
  object,
  WeakMap<object, Map<string, ReturnType<typeof toBuildings>["buildings"][number]>>
>();

/** Street polylines (walk LineStrings) in local metres, built once per walk layer and frame. */
const streets = (walk: unknown, frame: LocalFrame): Street[] =>
  perLayer(streetsCache, walk, frame, () =>
    streetLines(walk, frame).map((pts) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const [x, z] of pts) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      return { pts, bb: [x0, z0, x1, z1] as [number, number, number, number] };
    }),
  );

function streetLines(walk: unknown, frame: LocalFrame): P[][] {
  const out: P[][] = [];
  for (const f of features(walk)) {
    const g = isRec(f) ? f.geometry : null;
    if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) continue;
    const pts: P[] = [];
    for (const c of g.coordinates) {
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        pts.push(frame.toLocal(c[0] as number, c[1] as number));
    }
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}

/**
 * One sign per feature that has text and a full source (`source_url`, `as_of`) and sits on a known
 * building: on the facade facing the nearest walk street (the longest facade with no street near),
 * 0.15 m outside the wall, at y = min(4.2, 0.45 h), width = clamp(0.45 per character, 2 m, 80% of the
 * facade). A sign with no source, or whose building is unknown, is dropped and counted: never drawn.
 * With an area, a sign belongs to the box holding its point (half-open), so adjacent tiles never
 * plan the same sign.
 */
export function planSigns(
  signs: unknown,
  buildings: unknown,
  walk: unknown,
  frame: LocalFrame,
  opts: {
    /**
     * Only signs whose point lies in the box (half-open) are planned; the rest are counted in
     * `outside`. A sign without a usable point is judged by its placed position.
     */
    area?: PlanArea;
    /** At most this many signs, nearest to the box centre first: `tileCap(…, "signs", …)`. */
    cap?: number;
  } = {},
): {
  signs: SignPlacement[];
  dropped: Record<"no_source" | "no_building", number>;
  outside: number;
} {
  const dropped = { no_source: 0, no_building: 0 };
  let outside = 0;
  const box = opts.area?.box ?? null;
  // Built once per layer and frame, and only when a sign gets this far (a tile without signs pays
  // nothing).
  const byIdOf = () =>
    perLayer(
      buildingsCache,
      buildings,
      frame,
      () => new Map(toBuildings(buildings, displayHeight).buildings.map((b) => [b.id, b])),
    );
  const out: SignPlacement[] = [];
  /** Each planned sign's membership point (its feature point, else its placed position). */
  const anchors: P[] = [];

  for (const f of features(signs)) {
    const p = isRec(f) && isRec(f.properties) ? f.properties : {};
    const text = str(p.text);
    const rawUrl = str(p.source_url);
    const url = rawUrl ? httpUrl(rawUrl) : null;
    const asOf = str(p.as_of);
    if (!text || !url || !asOf) {
      dropped.no_source++;
      continue;
    }
    let at: P | null = null;
    if (box) {
      const c = isRec(f) && isRec(f.geometry) ? f.geometry.coordinates : null;
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        at = frame.toLocal(c[0] as number, c[1] as number);
        if (!inBox(box, at[0], at[1])) {
          outside++;
          continue;
        }
      }
    }
    const id = str(p.id);
    const b = str(p.building_id) ? byIdOf().get(str(p.building_id)!) : undefined;
    const ring = b ? localRing(b.ring, frame) : null;
    if (!id || !b || !ring || ring.length < 3) {
      dropped.no_building++;
      continue;
    }

    // Streets near this footprint only (the walk layer is large).
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const near = streets(walk, frame)
      .filter(
        ({ bb }) =>
          bb[2] > x0 - STREET_RANGE_M &&
          bb[0] < x1 + STREET_RANGE_M &&
          bb[3] > z0 - STREET_RANGE_M &&
          bb[1] < z1 + STREET_RANGE_M,
      )
      .map((l) => l.pts)
      .filter((l) =>
        l.some(
          ([x, z]) =>
            x > x0 - STREET_RANGE_M &&
            x < x1 + STREET_RANGE_M &&
            z > z0 - STREET_RANGE_M &&
            z < z1 + STREET_RANGE_M,
        ),
      );
    const streetDist = (q: P) => {
      let d = Infinity;
      for (const l of near)
        for (let i = 0; i < l.length - 1; i++) d = Math.min(d, distToSegment(q, l[i]!, l[i + 1]!));
      return d;
    };

    let best: { len: number; mid: P; n: P; score: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const c = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < MIN_FACADE_M) continue;
      const mid: P = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      let n: P = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len];
      // Outward: the probe point just beyond the wall must be outside the footprint.
      if (inside([mid[0] + n[0] * 0.3, mid[1] + n[1] * 0.3], ring)) n = [-n[0], -n[1]];
      // Nearest street (probe from just outside the wall); no street near: the longest facade.
      const score = near.length > 0 ? streetDist([mid[0] + n[0], mid[1] + n[1]]) : -len;
      if (!best || score < best.score) best = { len, mid, n, score };
    }
    if (!best) {
      dropped.no_building++;
      continue;
    }

    const width = Math.min(
      best.len * SIGN_FACADE_SHARE,
      Math.max(SIGN_MIN_WIDTH_M, text.length * SIGN_CHAR_M),
    );
    const x = best.mid[0] + best.n[0] * SIGN_OFFSET_M;
    const z = best.mid[1] + best.n[1] * SIGN_OFFSET_M;
    if (box && !at) {
      if (!inBox(box, x, z)) {
        outside++;
        continue;
      }
      at = [x, z];
    }
    out.push({
      id,
      text,
      x,
      y: Math.min(SIGN_MAX_Y_M, SIGN_Y_FRACTION * b.height),
      z,
      yaw: Math.atan2(best.n[0], best.n[1]),
      widthM: width,
      source: { url, label: str(p.source_label) ?? hostOf(url), asOf },
    });
    anchors.push(at ?? [x, z]);
  }
  if (!box) return { signs: out.slice(0, capOf(opts.cap)), dropped, outside };
  // Nearest to the box centre first (then id), so a cap keeps the same signs whatever the order of
  // the features.
  const [cx, cz] = boxCentre(box);
  const order = out.map((s, i) => ({ s, d: Math.hypot(anchors[i]![0] - cx, anchors[i]![1] - cz) }));
  order.sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  return { signs: order.slice(0, capOf(opts.cap)).map((o) => o.s), dropped, outside };
}
