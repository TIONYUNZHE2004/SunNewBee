import type { Placement } from "../assets/fit";
import { type Boundary, CLIP_TOLERANCE_M, insideBoundary, outsideBy } from "../ground/boundary";
import type { Ribbon } from "../ground/ribbons";
import type { TileContent } from "./streamer";

/**
 * The vertex guard of one planned tile (A-T4, display only). The tile planners already read inputs
 * cut to the Elmina outline (`ground/clipLayer.ts`), so this only catches what a planner adds next
 * to its input: a road ribbon's half width or mitre past a cut line end, a verge strip beside it, a
 * lamp or bench offset from the kerb, a stall or track at a lot edge. Points (kits, signs, shrubs,
 * cars, stalls) must lie inside; a ground triangle (ribbons, verge strips) or track with a vertex
 * more than CLIP_TOLERANCE_M outside is dropped. Lists with nothing dropped keep their identity.
 */

const inside = (b: Boundary, x: number, z: number) => insideBoundary(b, x, z);

function keepPlacements(list: Placement[], b: Boundary): Placement[] {
  const kept = list.filter((p) => inside(b, p.x, p.z));
  return kept.length === list.length ? list : kept;
}

export function guardKits(kits: Map<string, Placement[]>, b: Boundary): Map<string, Placement[]> {
  let changed = false;
  const out = new Map<string, Placement[]>();
  for (const [k, list] of kits) {
    const kept = keepPlacements(list, b);
    if (kept !== list) changed = true;
    if (kept.length > 0) out.set(k, kept);
    else changed = true;
  }
  return changed ? out : kits;
}

/** Indexed triangles (x y z positions) without those having a vertex > tolerance outside. */
export function guardRibbon(r: Ribbon, b: Boundary, tolM = CLIP_TOLERANCE_M): Ribbon | null {
  const p = r.positions;
  const far = new Uint8Array(p.length / 3);
  for (let v = 0; v < far.length; v++)
    far[v] = outsideBy(b, p[v * 3]!, p[v * 3 + 2]!) > tolM ? 1 : 0;
  const idx: number[] = [];
  const ix = r.indices;
  for (let t = 0; t + 2 < ix.length; t += 3) {
    const a = ix[t]!;
    const c = ix[t + 1]!;
    const d = ix[t + 2]!;
    if (far[a] || far[c] || far[d]) continue;
    idx.push(a, c, d);
  }
  if (idx.length === ix.length) return r;
  if (idx.length === 0) return null;
  return { ...r, indices: Uint32Array.from(idx) };
}

/** Non-indexed triangles (9 floats each) without those having a vertex > tolerance outside. */
export function guardTriangles(tris: Float32Array, b: Boundary, tolM = CLIP_TOLERANCE_M) {
  const keep: number[] = [];
  for (let t = 0; t + 8 < tris.length; t += 9) {
    let ok = true;
    for (let v = 0; v < 3 && ok; v++)
      ok = outsideBy(b, tris[t + v * 3]!, tris[t + v * 3 + 2]!) <= tolM;
    if (ok) keep.push(t);
  }
  if (keep.length * 9 === tris.length) return tris;
  const out = new Float32Array(keep.length * 9);
  keep.forEach((t, i) => {
    out.set(tris.subarray(t, t + 9), i * 9);
  });
  return out;
}

/** Records of `stride` floats whose first (x, z) pair passes `ok`. */
function keepRecords(a: Float32Array, stride: number, ok: (o: number) => boolean): Float32Array {
  const keep: number[] = [];
  for (let o = 0; o + stride - 1 < a.length; o += stride) if (ok(o)) keep.push(o);
  if (keep.length * stride === a.length) return a;
  const out = new Float32Array(keep.length * stride);
  keep.forEach((o, i) => {
    out.set(a.subarray(o, o + stride), i * stride);
  });
  return out;
}

/** Earth-track half width (4 m band): an end may lie this much less than the tolerance outside. */
const TRACK_HALF_M = 2;
const STALL_STRIDE = 3;
const TRACK_STRIDE = 4;

/** The tile content with every display vertex inside (points) or within 5 m (ground). Pure. */
export function guardTile(c: TileContent, b: Boundary | null | undefined): TileContent {
  if (!b) return c;
  const kits = guardKits(c.kits, b);
  const out: TileContent = {
    ...c,
    kits,
    lamps: kits === c.kits ? c.lamps : keepPlacements(c.lamps, b),
    signs: c.signs.filter((s) => inside(b, s.x, s.z)),
    ribbons: c.ribbons.map((r) => guardRibbon(r, b)).filter((r): r is Ribbon => r !== null),
  };
  if (out.signs.length === c.signs.length) out.signs = c.signs;
  if (c.verges)
    out.verges = {
      strips: guardTriangles(c.verges.strips, b),
      shrubs: keepPlacements(c.verges.shrubs, b),
    };
  if (c.parking)
    out.parking = {
      stalls: keepRecords(c.parking.stalls, STALL_STRIDE, (o) =>
        inside(b, c.parking!.stalls[o]!, c.parking!.stalls[o + 1]!),
      ),
      cars: keepPlacements(c.parking.cars, b),
    };
  if (c.tracks) {
    const t = c.tracks;
    const tol = CLIP_TOLERANCE_M - TRACK_HALF_M;
    out.tracks = keepRecords(
      t,
      TRACK_STRIDE,
      (o) => outsideBy(b, t[o]!, t[o + 1]!) <= tol && outsideBy(b, t[o + 2]!, t[o + 3]!) <= tol,
    );
  }
  return out;
}
