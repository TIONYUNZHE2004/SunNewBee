/**
 * DECORATIVE path geometry for agents that drive or walk through junctions (demo polish A1): legs
 * (edge centre lines in travel order) are offset into their lane or pavement side and joined with a
 * rounded corner (a quadratic fillet at the offset lines' intersection), or with a half circle round
 * the node at a real dead end (the U-turn). Corners and U-turns can carry a slow zone, turned into a
 * distance warp so `poseAt` stays a pure function of time. Display only.
 */
export type P = [number, number];

export interface Leg {
  /** Centre line in travel order (local metres). */
  pts: P[];
  /** Signed lateral offset (m): positive to the left of travel. */
  off: number;
  /** This leg turns back at a dead end: joined to the previous leg by a U-turn round `node`. */
  uturn?: boolean;
  /** The centre-line node where this leg meets the previous one (unused for the first leg). */
  node?: P;
}

export interface BuiltPath {
  pts: P[];
  /** Per point: 1 on a dead-end U-turn half circle (its ends included), else 0. */
  uturn: number[];
  length: number;
  /** The nodes of the U-turns taken (real dead ends). */
  deadEnds: P[];
}

/** Turns gentler than this are joined straight (no fillet). */
const STRAIGHT_RAD = (8 * Math.PI) / 180;
/** An offset-line intersection farther than this from either leg end is not a corner (m). */
const FAR_CORNER_M = 40;
/** Points per fillet and per U-turn half circle. */
const FILLET_STEPS = 6;
const UTURN_STEPS = 10;

const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
const dist = (a: P, b: P) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return Math.sqrt(dx * dx + dz * dz);
};

/**
 * An interior vertex's offset is stretched (a mitre) so the offset line keeps `d` from both of its
 * segments, up to this factor (a turn of up to 120 deg); sharper turns are clipped there (A4w: a plain
 * normal average pulled a lane to d x cos(turn / 2) of the centre line at every bend).
 */
const MITRE_MAX = 2;

/**
 * The polyline moved `d` metres to the left of its direction: vertex normals averaged and mitred
 * (MITRE_MAX), so every segment keeps `d` from the centre line through a bend.
 */
export function offsetLeft(pts: P[], d: number): P[] {
  const n = pts.length;
  return pts.map((p, i) => {
    let lx = 0;
    let lz = 0;
    let real = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ] as const) {
      if (a < 0 || b >= n) continue;
      const dx = pts[b]![0] - pts[a]![0];
      const dz = pts[b]![1] - pts[a]![1];
      const sl = Math.hypot(dx, dz);
      if (sl > 0) real++;
      const l = sl || 1;
      // Left of travel with y up: (dz, -dx).
      lx += dz / l;
      lz += -dx / l;
    }
    const l = Math.hypot(lx, lz) || 1;
    // two unit normals summed: |sum| = 2 cos(turn / 2), so the mitre is 2 / |sum| (1 at the ends)
    const k = real === 2 ? Math.min(MITRE_MAX, 2 / l) : 1;
    return [p[0] + (lx / l) * d * k, p[1] + (lz / l) * d * k];
  });
}

const unit = (a: P, b: P): P => {
  const l = dist(a, b);
  return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [0, 1];
};

/** Direction of the last non-degenerate segment. */
function endDir(pts: P[]): P {
  for (let i = pts.length - 1; i > 0; i--)
    if (dist(pts[i - 1]!, pts[i]!) > 1e-6) return unit(pts[i - 1]!, pts[i]!);
  return [0, 1];
}
/** Direction of the first non-degenerate segment. */
function startDir(pts: P[]): P {
  for (let i = 0; i < pts.length - 1; i++)
    if (dist(pts[i]!, pts[i + 1]!) > 1e-6) return unit(pts[i]!, pts[i + 1]!);
  return [0, 1];
}

/** Arc length of a polyline (m). The one copy for the motion modules. */
export function polyLength(pts: readonly P[]): number {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += dist(pts[i]!, pts[i + 1]!);
  return l;
}
const lengthOf = polyLength;

/** The point `m` metres along `pts` (clamped to its ends). */
export function pointAlong(pts: readonly P[], m: number): P {
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = dist(a, b);
    if (l > 0 && walked + l >= m) {
      const t = Math.max(0, (m - walked) / l);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += l;
  }
  return pts[pts.length - 1]!;
}

/** `pts` without its first `m` metres (at least two points stay). */
function trimStart(pts: P[], m: number): P[] {
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = dist(a, b);
    if (walked + l > m) {
      const t = l > 0 ? (m - walked) / l : 0;
      return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...pts.slice(i + 1)];
    }
    walked += l;
  }
  return pts.slice(-2);
}

/** Signed turn to the left (rad) from direction `u` to `v`. */
export function leftTurn(u: P, v: P): number {
  // x east, z south: the left of (1, 0) is (0, -1), where cross(u, v) is negative.
  return -Math.atan2(cross(u, v), u[0] * v[0] + u[1] * v[1]);
}

export const REJECTED = 0;
export const ADDED = 1;
export const ENDED = 2;
export type AddResult = typeof REJECTED | typeof ADDED | typeof ENDED;
/** A cut-short leg keeps at least this much (m), else it is rejected. */
const MIN_KEEP_M = 2;
/** A mitre corner (legs too short for a fillet) keeps at least this much of either leg (m). */
const MITRE_KEEP_M = 0.5;
/** A first leg's blocked start is skipped in steps of this (m). */
const START_STEP_M = 2;

export interface PathBuilder {
  /**
   * Appends a leg (offset, joined to the path so far). `check` sees the new points (from the start
   * of the join) and returns how many metres of them are clear (Infinity: all). Returns ADDED; or
   * ENDED when only a clear start of it was kept (the path ends there: the agent fades, never turns);
   * or REJECTED, changing nothing, when the join itself is not clear or the leg is degenerate. A
   * first leg whose start is not clear starts at its first clear point instead.
   */
  add(leg: Leg): AddResult;
  /** Path length so far (m). */
  length(): number;
  result(): BuiltPath;
}

export function createPathBuilder(o: {
  /** Fillet radius (m) at an ordinary junction, clamped to the legs' lengths. */
  fillet: number;
  check?: (pts: P[], leg: Leg) => number;
}): PathBuilder {
  const out: P[] = [];
  const cum: number[] = [];
  const fl: number[] = [];
  const deadEnds: P[] = [];
  let lastStart = 0;
  const push = (p: P, flag = 0) => {
    const prev = out[out.length - 1];
    if (prev && dist(prev, p) < 1e-6) {
      if (flag) fl[fl.length - 1] = flag;
      return;
    }
    cum.push(prev ? (cum[cum.length - 1] as number) + dist(prev, p) : 0);
    out.push(p);
    fl.push(flag);
  };
  const truncate = (n: number) => {
    out.length = n;
    cum.length = n;
    fl.length = n;
  };
  /** Cuts the path's tail back by `m` metres (never before the last leg's first point). */
  const trimTail = (m: number) => {
    const end = cum[cum.length - 1] as number;
    const target = Math.max(cum[lastStart] as number, end - m);
    let i = out.length - 1;
    while (i > lastStart + 1 && (cum[i - 1] as number) >= target) i--;
    // segment i-1 -> i holds the target
    const a = out[i - 1]!;
    const b = out[i]!;
    const l = (cum[i] as number) - (cum[i - 1] as number);
    const t = l > 0 ? (target - (cum[i - 1] as number)) / l : 0;
    const q: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    truncate(i);
    push(q);
  };
  /** Cuts the path at arc length `s` (the points after it dropped). */
  const cutAt = (s: number) => {
    let i = out.length - 1;
    while (i > 1 && (cum[i - 1] as number) >= s) i--;
    const a = out[i - 1]!;
    const b = out[i]!;
    const l = (cum[i] as number) - (cum[i - 1] as number);
    const t = l > 0 ? Math.max(0, Math.min(1, (s - (cum[i - 1] as number)) / l)) : 0;
    const q: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    truncate(i);
    push(q);
  };

  return {
    length: () => (cum.length ? (cum[cum.length - 1] as number) : 0),
    add(leg) {
      if (leg.pts.length < 2 || !(lengthOf(leg.pts) > 0)) return REJECTED;
      const raw = offsetLeft(leg.pts, leg.off);
      const B = removeCusps(
        raw,
        raw.map(() => 0),
      ).pts;
      if (B.length < 2) return REJECTED;
      if (out.length === 0) {
        let first = B;
        let clear = o.check ? o.check(first, leg) : Number.POSITIVE_INFINITY;
        const total = lengthOf(B);
        for (
          let m = START_STEP_M;
          clear < MIN_KEEP_M && m < total - MIN_KEEP_M;
          m += START_STEP_M
        ) {
          first = trimStart(B, m);
          clear = o.check ? o.check(first, leg) : Number.POSITIVE_INFINITY;
        }
        if (clear < MIN_KEEP_M) return REJECTED;
        for (const p of first) push(p);
        lastStart = 0;
        if (clear < lengthOf(first)) {
          cutAt(clear);
          return ENDED;
        }
        return ADDED;
      }
      // snapshot for a failed check (only the last leg's points can change)
      const snapLast = lastStart;
      const snapOut = out.slice(lastStart);
      const snapCum = cum.slice(lastStart);
      const snapFl = fl.slice(lastStart);
      const snapDead = deadEnds.length;
      const restore = (): AddResult => {
        truncate(snapLast);
        out.push(...snapOut);
        cum.push(...snapCum);
        fl.push(...snapFl);
        lastStart = snapLast;
        deadEnds.length = snapDead;
        return REJECTED;
      };

      const aEnd = out[out.length - 1]!;
      const uA = endDir(out.slice(lastStart));
      const uB = startDir(B);
      let joinFrom = out.length - 1;
      let head: P[] = B;
      // index of the leg's own first point (a later join may trim this leg back to it, never past)
      let legStart = -1;
      if (leg.uturn && leg.node) {
        const N = leg.node;
        const bStart = B[0]!;
        const r = (dist(aEnd, N) + dist(bStart, N)) / 2;
        if (r > 0.05) {
          const a0 = Math.atan2(aEnd[1] - N[1], aEnd[0] - N[0]);
          // rotate toward the travel direction (the half circle passes ahead of the node)
          const sgn = cross([aEnd[0] - N[0], aEnd[1] - N[1]], uA) >= 0 ? 1 : -1;
          fl[fl.length - 1] = 1;
          for (let k = 1; k < UTURN_STEPS; k++) {
            const ang = a0 + (sgn * Math.PI * k) / UTURN_STEPS;
            push([N[0] + r * Math.cos(ang), N[1] + r * Math.sin(ang)], 1);
          }
          push(bStart, 1);
          legStart = out.length - 1;
          head = B.slice(1);
        }
        deadEnds.push([N[0], N[1]]);
      } else {
        const turn = leftTurn(uA, uB);
        const bStart = B[0]!;
        const den = cross(uA, uB);
        let joined = false;
        if (Math.abs(turn) >= STRAIGHT_RAD && Math.abs(den) > 1e-6) {
          const d: P = [bStart[0] - aEnd[0], bStart[1] - aEnd[1]];
          const t1 = cross(d, uB) / den;
          const t2 = cross(d, uA) / den;
          const lenA = (cum[cum.length - 1] as number) - (cum[lastStart] as number);
          const lenB = lengthOf(B);
          if (Math.abs(t1) <= FAR_CORNER_M && Math.abs(t2) <= FAR_CORNER_M) {
            // the outside of a corner (the offset lines cross beyond both leg ends): a fillet wider
            // than the corner's own arc (radius |off| round the node, tangent t1 / -t2 from the
            // crossing) would cut in toward the centre line (A4w review fix round 1)
            const outer = t1 > 0 && t2 < 0 ? Math.min(t1, -t2) : Number.POSITIVE_INFINITY;
            const r = Math.min(o.fillet, 0.45 * lenA + t1, 0.45 * lenB - t2, outer);
            if (r >= 0.3) {
              const P1: P = [aEnd[0] + uA[0] * t1, aEnd[1] + uA[1] * t1];
              const cutA = r - t1;
              if (cutA > 0) trimTail(cutA);
              else push([aEnd[0] + uA[0] * (t1 - r), aEnd[1] + uA[1] * (t1 - r)]);
              joinFrom = out.length - 1;
              const P0 = out[out.length - 1]!;
              const cutB = r + t2;
              const Bt = cutB > 0 ? trimStart(B, cutB) : B;
              const P2: P =
                cutB > 0 ? Bt[0]! : [bStart[0] + uB[0] * (t2 + r), bStart[1] + uB[1] * (t2 + r)];
              for (let k = 1; k < FILLET_STEPS; k++) {
                const t = k / FILLET_STEPS;
                const w0 = (1 - t) * (1 - t);
                const w1 = 2 * t * (1 - t);
                const w2 = t * t;
                push([w0 * P0[0] + w1 * P1[0] + w2 * P2[0], w0 * P0[1] + w1 * P1[1] + w2 * P2[1]]);
              }
              push(P2);
              legStart = out.length - 1;
              head = cutB > 0 ? Bt.slice(1) : B;
              joined = true;
            } else if (lenA > -t1 + MITRE_KEEP_M && lenB > t2 + MITRE_KEEP_M) {
              // A4w: legs too short for a fillet meet at a mitre corner (the offset lines' crossing
              // P1) instead of a chord that a cusp drop would pull across the lane
              const P1: P = [aEnd[0] + uA[0] * t1, aEnd[1] + uA[1] * t1];
              if (t1 < 0) trimTail(-t1);
              else push(P1);
              joinFrom = out.length - 1;
              const Bt = t2 > 0 ? trimStart(B, t2) : B;
              if (t2 > 0) {
                legStart = out.length - 1;
                head = Bt.slice(1);
              } else {
                push(P1);
                head = B;
              }
              joined = true;
            }
          }
        }
        if (!joined) head = dist(aEnd, bStart) < 1e-3 ? B.slice(1) : B;
      }
      if (legStart < 0) legStart = head === B ? out.length : out.length - 1;
      for (const p of head) push(p);
      // drop cusps of the join and the new leg now, so the check sees the final geometry
      const from = Math.max(0, joinFrom - 1);
      const kept = out.length - legStart;
      const clean = removeCusps(out.slice(from), fl.slice(from));
      truncate(from);
      clean.pts.forEach((p, i) => {
        push(p, clean.uturn[i]);
      });
      lastStart = Math.max(from, Math.min(out.length - kept, out.length - 1));
      joinFrom = Math.min(joinFrom, out.length - 1);
      if (o.check) {
        const clear = o.check(out.slice(joinFrom), leg);
        const s0 = cum[joinFrom] as number;
        const added = (cum[cum.length - 1] as number) - s0;
        if (clear < added) {
          // the join itself (to the leg's own first point) must be clear
          if (clear < (cum[lastStart] as number) - s0 + MIN_KEEP_M) return restore();
          cutAt(s0 + clear);
          return ENDED;
        }
      }
      return ADDED;
    },
    result: () => {
      const pts = out.map((p) => [p[0], p[1]] as P);
      return {
        pts,
        uturn: fl.slice(),
        length: lengthOf(pts),
        deadEnds: deadEnds.map((p) => [p[0], p[1]] as P),
      };
    },
  };
}

/** Segments facing more than this far apart (145 deg, under the 150 deg of AC-L1) ... */
const REVERSE_RAD = (145 * Math.PI) / 180;
/** ... are at least this many seconds apart at the nominal speed (2 s x 1.15 easing, plus margin). */
const REVERSE_NOMINAL_S = 2.5;
/**
 * No stretch of a path is walked slower than this share of the agent's speed (review fix 1): a
 * reversal that would need a crawl ends the path before it instead (`reversalCut`, a fade).
 */
export const MIN_SHARE = 0.3;
/** A vertex turning by more than this (not on a U-turn) is a cusp of the offset or trim: dropped. */
const CUSP_RAD = (100 * Math.PI) / 180;

const segYaw = (a: P, b: P) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const wrapPi = (v: number) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));

/**
 * The path without cusps: offsetting a tight curve or trimming a short leg can leave a vertex where
 * the path folds back on itself (a heading flip over centimetres); such vertices are dropped, except
 * on a dead-end U-turn. Repeated until none is left.
 */
export function removeCusps(pts: P[], flags: number[]): { pts: P[]; uturn: number[] } {
  let p = pts.slice();
  let f = flags.slice();
  for (let pass = 0; pass < 8 && p.length > 2; pass++) {
    const keepP: P[] = [p[0]!];
    const keepF: number[] = [f[0]!];
    let dropped = false;
    for (let i = 1; i < p.length - 1; i++) {
      const prev = keepP[keepP.length - 1]!;
      const cur = p[i]!;
      const nxt = p[i + 1]!;
      if (dist(prev, cur) < 1e-3) {
        dropped = true;
        continue;
      }
      if (!f[i] && Math.abs(wrapPi(segYaw(cur, nxt) - segYaw(prev, cur))) > CUSP_RAD) {
        dropped = true;
        continue;
      }
      keepP.push(cur);
      keepF.push(f[i]!);
    }
    keepP.push(p[p.length - 1]!);
    keepF.push(f[f.length - 1]!);
    p = keepP;
    f = keepF;
    if (!dropped) break;
  }
  return { pts: p, uturn: f };
}

/**
 * How many points of `pts` to keep so no reversal is left that only a crawl could slow to over
 * 2 s (review fix 1): wherever two segments face more than REVERSE_RAD apart with less than
 * `max(MIN_SHARE x REVERSE_NOMINAL_S x speed, minArc)` metres of path between them, and no dead-end
 * U-turn among them, the path ends at the first of the two (the agent fades there). `pts.length`
 * when nothing needs cutting; at least 2.
 */
export function reversalCut(pts: P[], uturn: number[], speed: number, minArc: number): number {
  const n = pts.length;
  if (n < 3) return n;
  const len: number[] = [];
  const yaw: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    len.push(dist(pts[i]!, pts[i + 1]!));
    yaw.push(segYaw(pts[i]!, pts[i + 1]!));
  }
  const m = n - 1;
  const onU = (i: number) => !!(uturn[i] && uturn[i + 1]);
  const need = Math.max(MIN_SHARE * REVERSE_NOMINAL_S * speed, minArc);
  for (let a = 0; a < m; a++) {
    if (onU(a)) continue;
    let d = 0;
    for (let b = a + 1; b < m; b++) {
      if (onU(b) || onU(b - 1)) break;
      if (b > a + 1) d += len[b - 1] as number;
      if (d >= need) break;
      if (Math.abs(wrapPi((yaw[b] as number) - (yaw[a] as number))) > REVERSE_RAD)
        return Math.max(2, a + 2); // keep segment a, end at its far point
    }
  }
  return n;
}

/**
 * Distance warp for a path: each segment is walked at share f of the agent's speed so its heading
 * turns at most `omega` rad/s (the turns at its two ends, half each, spread over its length), and at
 * most `uturnOmega` on a dead-end U-turn. Knot pairs (nominal metres, path metres) from (0, 0) at
 * every change of share; null when nothing slows down. `poseAt` maps nominal to path metres.
 */
export function pathWarp(
  pts: P[],
  uturn: number[],
  speed: number,
  omega: number,
  uturnOmega: number,
): Float32Array | null {
  const n = pts.length;
  if (n < 2 || !(speed > 0)) return null;
  const len: number[] = [];
  const yaw: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    len.push(dist(pts[i]!, pts[i + 1]!));
    yaw.push(segYaw(pts[i]!, pts[i + 1]!));
  }
  const turnAt = (v: number) =>
    v <= 0 || v >= n - 1 ? 0 : Math.abs(wrapPi((yaw[v] as number) - (yaw[v - 1] as number)));
  const m = n - 1;
  const onU = (i: number) => !!(uturn[i] && uturn[i + 1]);
  const f: number[] = [];
  for (let i = 0; i < m; i++) {
    const l = len[i] as number;
    const load = (turnAt(i) + turnAt(i + 1)) / 2;
    const w = onU(i) ? uturnOmega : omega;
    // time on the segment at share f: l / (speed f) >= load / w
    const floor = onU(i) ? 0.02 : MIN_SHARE;
    f.push(load > 0 && l > 0 ? Math.max(floor, Math.min(1, (w * l) / (speed * load))) : 1);
  }
  // Polyline corners turn in one step: wherever two segments face more than REVERSE_RAD apart,
  // the stretch between them takes at least REVERSE_NOMINAL_S at the nominal speed (over 2 s even
  // at +15 %), unless a dead-end U-turn lies between (a real reversal).
  const need = REVERSE_NOMINAL_S * speed;
  for (let a = 0; a < m; a++) {
    let d = 0;
    for (let b = a + 1; b < m; b++) {
      if (onU(b) || onU(b - 1)) break;
      if (b > a + 1) d += (len[b - 1] as number) / (f[b - 1] as number);
      if (d >= need) break;
      if (b > a + 1 && Math.abs(wrapPi((yaw[b] as number) - (yaw[a] as number))) > REVERSE_RAD) {
        // one even share over the stretch makes it exactly `need` nominal metres; `reversalCut`
        // has already ended the path before any reversal that would need less than MIN_SHARE
        let arcAB = 0;
        for (let i = a + 1; i < b; i++) arcAB += len[i] as number;
        const share = Math.max(MIN_SHARE, Math.min(1, arcAB / need));
        for (let i = a + 1; i < b; i++) f[i] = Math.min(f[i] as number, share);
        break;
      }
    }
  }
  const k: number[] = [0, 0];
  let nom = 0;
  let arc = 0;
  let slowed = false;
  let lastF = 1;
  for (let i = 0; i < m; i++) {
    const l = len[i] as number;
    const fi = f[i] as number;
    if (fi < 1) slowed = true;
    if (fi !== lastF && i > 0) k.push(nom, arc);
    nom += l / fi;
    arc += l;
    lastF = fi;
  }
  if (!slowed) return null;
  k.push(nom, arc);
  return Float32Array.from(k);
}
