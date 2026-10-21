/**
 * Development Simulation timeline (spec 2026-10-21 §4.2–§4.4, §5.3, §7; AC-F1, AC-F2, Q4).
 *
 * Pure maths, no Three.js: `stateAt(t, plan)` gives everything one frame needs at screen second t.
 * Two timelines: the 45 s building plan (C7: it carries `schedule` and `month_keys`; demo polish
 * §6.3, see "the 45 s building timeline" below) and the legacy 66 s plan (no schedule), kept for the
 * legacy test fixture the 3D lane's tests still read until they move to the 45 s plan.
 * Ported from the approved prototype (docs/03-product/prototypes/developer-lens/index.html: `ACTS`,
 * `sunAt`, `WORK`, `homesAt`, `BUBBLES`, `ENVELOPE`, `CAM`, the HUD clock in `render`). Facts and
 * copy come from the plan; the clock, month, occupancy and flow are display values of the
 * simulation clock and are never cited as facts (spec §3).
 */
import { BUILD_BEATS, monthAt, planPlayback } from "./schedulePlayback";
import type { Act, DevelopmentPlan, StateAt } from "./types";

// ---------- prototype constants ----------
/** Construction, Handover and Daily Life spans (screen s); the plan's acts must agree (AC-F1). */
export const CON: readonly [number, number] = [4, 32];
export const HAND: readonly [number, number] = [32, 44];
export const DAY: readonly [number, number] = [44, 63];
/** One day/night cycle in Construction (screen s): 28 s / 2.8 s = 10 cycles. */
export const CON_P = 2.8;
/** Handover runs ~1.85 slower cycles, so it ends at sim dawn. */
export const HAND_CYCLES = 1.85;
export const HAND_P = (HAND[1] - HAND[0]) / HAND_CYCLES;
const PHASE0 = 0.15;
/** Sun height keyframes for the one Daily Life day ([t, e]). */
const DAY_E: readonly [number, number][] = [
  [44, 0.25],
  [46, 0.35],
  [50.5, 0.45],
  [52, 0.95],
  [56.5, 0.95],
  [58, 0.3],
  [61, 0.06],
  [62.8, -0.12],
  [66, -0.3],
];
/** Movers: the first walks in at MOVE_IN, then one every MOVE_GAP s (8 movers). */
const MOVE_IN = 36.4;
const MOVE_GAP = 0.8;
const MOVERS = 8;
/** Lorries arrive at the entrance path at this time and leave when Daily Life starts. */
const LORRIES_AT = 33;
/** Hoarding comes down over 1.6 s after Handover starts. */
const HOARDING_OFF = HAND[0] + 1.6;
/** Fast-forward speed of the decorative flow in Construction and Handover (spec §7). */
export const FAST_FORWARD = 8;
/** Share of households in by the end of Handover, and the extra share in by the end of Daily Life
 * (prototype display values 460 and 488 of 500). */
const OCC_HANDOVER = 0.92;
const OCC_DAILY = 0.056;

// ---------- helpers ----------
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
/** Smoothstep, as the prototype's `ease`. */
export const ease = (u: number) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const frac = (x: number) => x - Math.floor(x);

/** Sun height e (>0 day, <0 night) and the time of day (0 = midnight, 0.5 = noon) at screen t. */
export function sunAt(t: number): { e: number; tod: number } {
  const cyc = (t0: number, p: number) => {
    const ph = (t - t0) / p + PHASE0;
    // sin peaks at ph = 0.25 (noon): time of day = ph + 0.25
    return { e: Math.min(1.1, Math.sin(2 * Math.PI * ph) + 0.25), tod: frac(ph + 0.25) };
  };
  if (t >= CON[0] && t < CON[1]) return cyc(CON[0], CON_P);
  if (t >= HAND[0] && t < HAND[1]) return cyc(HAND[0], HAND_P);
  if (t >= DAY[0]) {
    let i = 0;
    while (i < DAY_E.length - 2 && t > (DAY_E[i + 1] as [number, number])[0]) i++;
    const [ta, ea] = DAY_E[i] as [number, number];
    const [tb, eb] = DAY_E[i + 1] as [number, number];
    return { e: ea + (eb - ea) * ease(span(t, ta, tb)), tod: dayMinutes(t) / 1440 };
  }
  // Brief: a late-morning overview
  return { e: 1.0, tod: 0.45 };
}

/** 0 by night .. 1 by day, from the sun height (prototype `dayness`). */
export const dayness = (e: number) => ease(span(e, -0.08, 0.22));

/** Daily Life clock in minutes after midnight: 07:00 -> 08:00 -> 10:30 -> 12:30 -> 18:00 -> ~19:40. */
export function dayMinutes(t: number): number {
  if (t < 51) return 420 + 50 * span(t, DAY[0], 51);
  if (t < 57.5) return 630 + 120 * span(t, 51, 57.5);
  if (t < DAY[1]) return 1080 + 100 * span(t, 57.5, DAY[1]);
  // Summary: the evening carries on a little
  return 1180 + 20 * span(t, DAY[1], 66) * 3;
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor((m % 60) / 5) * 5).padStart(2, "0")}`;

/** Work done (daylight seconds) since Construction began, integrated once at 0.02 s steps, so
 * floors, crane and workers pause at night (prototype `WORK`). */
const STEP = 0.02;
const WORK: number[] = (() => {
  const out: number[] = [];
  let w = 0;
  for (let i = 0; CON[0] + i * STEP <= CON[1] + STEP; i++) {
    out.push(w);
    w += (dayness(sunAt(CON[0] + i * STEP).e) > 0.5 ? 1 : 0) * STEP;
  }
  return out;
})();
export const workAt = (t: number) =>
  WORK[Math.max(0, Math.min(WORK.length - 1, Math.round((t - CON[0]) / STEP)))] as number;
const WORK_TOP = workAt(30.6);
const WORK_START = workAt(5.2);

/** Floors built (fractional, 0..storeys): rise only by sim day, topped out before Handover. */
export function floorsAt(t: number, storeys: number): number {
  if (t < CON[0]) return 0;
  if (t >= CON[1]) return storeys;
  return storeys * clamp01((workAt(t) - WORK_START) / (WORK_TOP - WORK_START));
}

/** Share of the tower's homes occupied (display value; prototype `occupied` for windows). */
function occupiedShare(t: number): number {
  if (t < 34) return 0;
  if (t < DAY[0]) return 0.75 * span(t, 34, 43);
  return 0.75 + 0.2 * span(t, DAY[0], DAY[1]);
}

/** Homes occupied counter (display value): 0 -> 92% over Handover, +5.6% over Daily Life. */
export function occupancyAt(t: number, households: number): number {
  const share =
    t < DAY[0] ? OCC_HANDOVER * ease(span(t, 34, 43)) : OCC_HANDOVER + OCC_DAILY * span(t, ...DAY);
  return Math.round(households * share);
}

/** The act at t: [t0, t1); the last act holds at and after the end. */
export function actAt(t: number, acts: readonly Act[]): Act {
  return (
    acts.find((a) => t >= a.t0 && t < a.t1) ??
    (acts[acts.length - 1] as Act) ?? { name: "", t0: 0, t1: 0 }
  );
}

function simClockAt(t: number): StateAt["simClock"] {
  if (t < CON[0]) return { label: "—" };
  if (t < CON[1]) {
    const month = 1 + Math.floor(23 * span(t, CON[0], CON[1] - 0.1));
    return { label: `Month ${month} of 24`, month };
  }
  if (t < HAND[1]) {
    const week = 1 + Math.floor(2 * span(t, HAND[0], HAND[1] - 0.1));
    return { label: `Handover · week ${week} of 2`, week };
  }
  if (t < DAY[1]) {
    const m = hhmm(dayMinutes(t));
    return { label: `Day 30 · ${m}`, day: 30, hhmm: m };
  }
  return { label: "First month" };
}

// ---------- flow (spec §7) ----------
/** Decorative crowd and traffic: speed multiplier and densities (1 = a normal daytime street). */
export function flowAt(t: number): StateAt["flow"] {
  const fast = t >= CON[0] && t < HAND[1];
  const day = dayness(sunAt(t).e);
  // Daily Life morning rush (07:00-09:00), the school run
  const rush = t >= DAY[0] && t < DAY[1] ? 1 - span(dayMinutes(t), 450, 540) : 0;
  return {
    timeScale: fast ? FAST_FORWARD : 1,
    peopleDensity: 0.25 + 0.75 * day + 0.25 * rush,
    vehicleDensity: 0.2 + 0.8 * day + 0.5 * rush,
  };
}

// ---------- camera (spec §4.4, prototype `CAM`) ----------
/** Named points of the plan the camera frames. */
export type AnchorName =
  | "site"
  | "yard"
  | "halimMid"
  | "farid"
  | "door"
  | "node"
  | "junction"
  | "park"
  | "mall"
  | "worker";
/** A camera target: a named anchor, a blend of two, or a point `path` metres out from the door. */
export type TargetAnchor =
  | AnchorName
  | { lerp: [AnchorName, AnchorName, number] }
  | { path: number };
/** Camera offset from the target: world [east, north, up] metres, or relative to the entrance
 * (`entrance`: [out from the door, along its face, up]) or the yard (`yard`: [away from the tower,
 * extra east, extra north, up]). */
export type CamOffset =
  | [number, number, number]
  | { entrance: [number, number, number] }
  | { yard: [number, number, number, number] };

export interface CamKey {
  t: number;
  targetAnchor: TargetAnchor;
  /** Target height above ground, metres. */
  h: number;
  offset: CamOffset;
  /** A cut, not a fly: the previous key's pose holds until this key's t, then jumps here (F3, Q6:
   * flights between street-level shots crossed the tower or the mall roof and filled the frame
   * with roof for a few tenths of a second). */
  cut?: boolean;
}

/** The prototype's `CAM` keyframes, subject for subject (§4.4), plus F3's waypoint and three cuts. */
export const CAM_KEYS: readonly CamKey[] = [
  { t: 0, targetAnchor: "site", h: 0, offset: [-200, -520, 520] },
  {
    t: 3.6,
    targetAnchor: { lerp: ["yard", "site", 0.3] },
    h: 4,
    offset: { yard: [60, -20, -30, 34] },
  },
  {
    t: 8.6,
    targetAnchor: { lerp: ["yard", "site", 0.5] },
    h: 10,
    offset: { yard: [75, -25, -40, 46] },
  },
  { t: 10.4, targetAnchor: "site", h: 26, offset: [-130, -180, 95] },
  { t: 15.4, targetAnchor: "site", h: 34, offset: [-145, -200, 105] },
  // Gate 2 fix: the tower (left) and Halim on his detour (right) in one frame, as the prototype
  // frames them: aimed between them from the south-south-west, as close as keeps the tower in
  // (loop 2: closer, so Halim reads against the street, Q3)
  { t: 17.2, targetAnchor: { lerp: ["site", "halimMid", 0.58] }, h: 10, offset: [-16, -165, 86] },
  { t: 21.6, targetAnchor: { lerp: ["site", "halimMid", 0.62] }, h: 8, offset: [-12, -148, 77] },
  // Gate 2 fix: from the south-west, over the yard, so no street tree stands between the camera
  // and Farid (the prototype's north-west view looks through a canopy on the Elmina plan)
  // F3 (Q6): the Farid shot's camera stands beside the tower's east face, so a straight fly in
  // from, or out to, the wide shots crossed the footprint and the Q2 clamp popped the camera onto
  // the roof for ~0.2 s. In: a waypoint drops the camera beside the tower (outside its footprint).
  // Out: a cut to the wide shot at 27 s (a fly up and over still filled the frame with roof).
  { t: 22.3, targetAnchor: "farid", h: 4, offset: [-20, -30, 100] },
  { t: 22.8, targetAnchor: "farid", h: 4, offset: [-32, -30, 22] },
  { t: 26.4, targetAnchor: "farid", h: 4, offset: [-28, -27, 19] },
  { t: 27, targetAnchor: "site", h: 45, offset: [-150, -240, 130], cut: true },
  { t: 28, targetAnchor: "site", h: 45, offset: [-150, -240, 130] },
  { t: 32, targetAnchor: "site", h: 46, offset: [-165, -255, 138] },
  { t: 34.6, targetAnchor: { path: 6 }, h: 3, offset: { entrance: [26, 30, 17] } },
  { t: 39.6, targetAnchor: { path: 5 }, h: 3, offset: { entrance: [22, 26, 14] } },
  { t: 44, targetAnchor: { path: 6 }, h: 2.6, offset: { entrance: [22, 24, 13] } },
  // F3 (AC-C1, 48 s): the school-run queue waits up the frontage street (the door's facing, `en`),
  // so the camera looks back down that street from beside it: the line of cars runs from the
  // lower left to Mei Ling at the junction on the right, as the prototype frames it. The target
  // sits ~15 m up the street from the junction (path 54 m from the door; the path is ~37 m).
  { t: 47, targetAnchor: { path: 54 }, h: 5, offset: { entrance: [34, 40, 37] } },
  { t: 51.6, targetAnchor: { path: 54 }, h: 5, offset: { entrance: [30, 35, 33] } },
  // F3 (AC-C1, 54 s): Zainab from the west-south-west and low, so the park's lawn and trees fill
  // the frame behind her with the pond on the right and the mall wall on the left, as the
  // prototype frames her (from the south-west the shot was a sand forecourt beside a wall).
  // F3 (Q6): the 250 m fly from the junction grazed the mall roof; a cut at 52.2 s instead.
  { t: 52.2, targetAnchor: "park", h: 1.5, offset: [-38, -18, 13], cut: true },
  { t: 52.8, targetAnchor: "park", h: 1.5, offset: [-38, -18, 13] },
  { t: 57, targetAnchor: "park", h: 1.5, offset: [-33, -16, 11] },
  // Gate 2 loop 2: Arjun from the south-east, so he stands against the plaza, not the lit window
  // F3 (Q6): the fly from the park skimmed the mall roof; a cut at 57.4 s instead.
  { t: 57.4, targetAnchor: "mall", h: 1, offset: [32, -24, 28], cut: true },
  { t: 58, targetAnchor: "mall", h: 1, offset: [32, -24, 28] },
  { t: 62.4, targetAnchor: "mall", h: 1, offset: [28, -21, 25] },
  // 3D integration: 0.72 (prototype 0.9) keeps the tower where the prototype frames it (left third)
  { t: 63.6, targetAnchor: { lerp: ["site", "mall", 0.72] }, h: 20, offset: [-120, -470, 300] },
  { t: 66, targetAnchor: { lerp: ["site", "mall", 0.72] }, h: 20, offset: [-130, -490, 310] },
];

const KY = 110574;
const kx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
type LL = [number, number];
const ll = (p: readonly number[] | undefined): LL => [p?.[0] ?? 0, p?.[1] ?? 0];
/** [lon, lat] moved by east/north metres. */
const offsetLL = ([lon, lat]: LL, e: number, n: number): LL => [lon + e / kx(lat), lat + n / KY];
const lerpLL = (a: LL, b: LL, k: number): LL => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
];

/** Plan geometry the camera needs, in [lon, lat] and unit east/north vectors. */
export interface CamFrame {
  anchors: Record<AnchorName, LL>;
  /** Unit vector the door faces (east, north), and along its face. */
  en: [number, number];
  tn: [number, number];
  /** Unit vector from the tower to the yard. */
  ydir: [number, number];
}

/** The nearest point of the footprint ring to p (the plan's door can sit a few metres off it). */
function onFootprint(p: LL, fp: readonly (readonly number[])[]): LL {
  if (fp.length < 2) return p;
  const k = kx(p[1]);
  const m = (q: readonly number[]): [number, number] => [
    ((q[0] ?? 0) - p[0]) * k,
    ((q[1] ?? 0) - p[1]) * KY,
  ];
  let best: [number, number] = [0, 0];
  let bd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < fp.length; i++) {
    const a = m(fp[i] as number[]);
    const b = m(fp[(i + 1) % fp.length] as number[]);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const u = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dz) / (dx * dx + dz * dz || 1)));
    const q: [number, number] = [a[0] + dx * u, a[1] + dz * u];
    const d = Math.hypot(q[0], q[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return [p[0] + best[0] / k, p[1] + best[1] / KY];
}

/** Resolves the plan's named camera anchors (memoised per plan). */
const frames = new WeakMap<DevelopmentPlan, CamFrame>();
export function camFrame(plan: DevelopmentPlan): CamFrame {
  const hit = frames.get(plan);
  if (hit) return hit;
  const fp = plan.site.footprint;
  const site: LL = fp.length
    ? [
        fp.reduce((s, p) => s + (p[0] ?? 0), 0) / fp.length,
        fp.reduce((s, p) => s + (p[1] ?? 0), 0) / fp.length,
      ]
    : ll(plan.site.entrance.door);
  const th = (plan.site.entrance.facing_deg * Math.PI) / 180;
  const en: [number, number] = [Math.sin(th), Math.cos(th)];
  const tn: [number, number] = [-en[1], en[0]];
  // The yard (crane, stacks) sits behind the tower, away from the entrance.
  const ydir: [number, number] = [-en[0], -en[1]];
  const path = plan.site.entrance.path;
  const hp = plan.anchors.halim_path;
  const f: CamFrame = {
    en,
    tn,
    ydir,
    anchors: {
      site,
      yard: offsetLL(site, ydir[0] * 30, ydir[1] * 30),
      halimMid: ll(hp[Math.floor(hp.length * 0.5)] ?? site),
      farid: ll(plan.anchors.farid),
      // the door as the 3D scene draws it: on the facade (nearest footprint point)
      door: onFootprint(ll(plan.site.entrance.door), fp),
      node: ll(path[path.length - 1] ?? plan.site.entrance.door),
      junction: ll(plan.anchors.junction),
      park: ll(plan.anchors.park),
      mall: ll(plan.anchors.mall),
      worker: plan.anchors.worker ? ll(plan.anchors.worker) : site,
    },
  };
  frames.set(plan, f);
  return f;
}

function resolveTarget(k: CamKey, f: CamFrame): LL {
  const a = k.targetAnchor;
  if (typeof a === "string") return f.anchors[a];
  if ("lerp" in a) return lerpLL(f.anchors[a.lerp[0]], f.anchors[a.lerp[1]], a.lerp[2]);
  return offsetLL(f.anchors.door, f.en[0] * a.path, f.en[1] * a.path);
}

function resolveOffset(k: CamKey, f: CamFrame): [number, number, number] {
  const o = k.offset;
  if (Array.isArray(o)) return [o[0], o[1], o[2]];
  if ("entrance" in o) {
    const [d, s, u] = o.entrance;
    return [f.en[0] * d + f.tn[0] * s, f.en[1] * d + f.tn[1] * s, u];
  }
  const [d, e, n, u] = o.yard;
  return [f.ydir[0] * d + e, f.ydir[1] * d + n, u];
}

/** The camera at t: target [lon, lat, h] and offset [east, north, up], eased between keyframes. */
export function cameraAt(
  t: number,
  plan: DevelopmentPlan,
  keys: readonly CamKey[] = isBuildPlan(plan) ? BUILD_CAM_KEYS : CAM_KEYS,
): StateAt["camera"] {
  const f = camFrame(plan);
  let i = 0;
  while (i < keys.length - 2 && t > (keys[i + 1] as CamKey).t) i++;
  const a = keys[i] as CamKey;
  const b = keys[i + 1] as CamKey;
  const u = b.cut ? (t >= b.t ? 1 : 0) : ease(span(t, a.t, b.t));
  const ta = resolveTarget(a, f);
  const tb = resolveTarget(b, f);
  const oa = resolveOffset(a, f);
  const ob = resolveOffset(b, f);
  const tg = lerpLL(ta, tb, u);
  const mix = (x: number, y: number) => x + (y - x) * u;
  return {
    target: [tg[0], tg[1], mix(a.h, b.h)],
    offset: [mix(oa[0], ob[0]), mix(oa[1], ob[1]), mix(oa[2], ob[2])],
  };
}

// ---------- the 45 s building timeline (demo polish §6.3) ----------

/** True for the 45 s building plan (C7): it carries the schedule and its month keys. */
export function isBuildPlan(plan: DevelopmentPlan): boolean {
  const p = plan as Partial<DevelopmentPlan>;
  return !!p.schedule && Array.isArray(p.schedule.floors_by_month);
}

/** Spec §6.3 screen times (s) of the 45 s building timeline beyond the month mapping. */
export const BUILD_T = {
  /** Brief overview 0–3 s, Construction 3–27 s, Handover 27–33 s, Daily Life 33–45 s. */
  construction: [BUILD_BEATS.monthsFrom, BUILD_BEATS.handover] as const,
  handover: [BUILD_BEATS.handover, 33] as const,
  daily: [33, BUILD_BEATS.end] as const,
  /** Hoarding up (and the detour drawn) at 3.5 s; down 1 s into Handover (27–30.5 s banner). */
  hoarding: [3.5, 28] as const,
  /** Moving lorries at the entrance (C10 lorries park by 29.5 s and leave at 33.5 s). */
  lorries: [27, 33.5] as const,
  /** Movers walk in from 29 s (12 movers, one every 0.25 s, 1.3 s each: in by ~33 s). */
  movers: [29, 33.05] as const,
  /** Windows light floor by floor over 28–33 s to `litTarget` (C10 `SET_PIECE_S.moveIn.lit`). */
  lit: [28, 33] as const,
  litTarget: 0.9,
  /** …and on to `litDaily` by the end of Daily Life. */
  litDaily: 0.95,
  /** The Impact Brief slides in (and the residents button appears). */
  brief: 33,
  /** The camera's view shifts left of the brief over this long. */
  briefShiftS: 1.5,
} as const;

/**
 * Camera keyframes for the 45 s plan (the 66 s cut's subjects, retimed to §6.3): the Brief
 * overview, the hoarding and Halim's detour, the lorry route and the Raya hold from the south-west,
 * Farid beside the tower (waypoint in, cut out, F3), the monsoon stretch, the topped-out tower, the
 * move-in at the door, and the Daily Life wide shot the Impact Brief sits beside (the engine's view
 * offset moves the tower left of the panel from `BUILD_T.brief`).
 */
export const BUILD_CAM_KEYS: readonly CamKey[] = [
  { t: 0, targetAnchor: "site", h: 0, offset: [-200, -520, 520] },
  { t: 3.4, targetAnchor: { lerp: ["site", "halimMid", 0.55] }, h: 10, offset: [-24, -190, 104] },
  { t: 8.6, targetAnchor: { lerp: ["site", "halimMid", 0.58] }, h: 10, offset: [-16, -168, 88] },
  { t: 10.4, targetAnchor: "site", h: 26, offset: [-130, -180, 95] },
  { t: 13.0, targetAnchor: "site", h: 30, offset: [-140, -192, 100] },
  { t: 13.6, targetAnchor: "farid", h: 4, offset: [-20, -30, 100] },
  { t: 14.0, targetAnchor: "farid", h: 4, offset: [-32, -30, 22] },
  { t: 16.7, targetAnchor: "farid", h: 4, offset: [-28, -27, 19] },
  { t: 17.0, targetAnchor: "site", h: 30, offset: [-125, -175, 92], cut: true },
  { t: 18.4, targetAnchor: "site", h: 30, offset: [-120, -170, 88] },
  { t: 23.0, targetAnchor: "site", h: 36, offset: [-138, -200, 104] },
  { t: 26.6, targetAnchor: "site", h: 45, offset: [-150, -240, 130] },
  { t: 28.2, targetAnchor: { path: 8 }, h: 3, offset: { entrance: [42, 40, 26] } },
  { t: 32.6, targetAnchor: { path: 8 }, h: 3, offset: { entrance: [38, 36, 23] } },
  {
    t: 33.0,
    targetAnchor: { lerp: ["site", "mall", 0.6] },
    h: 20,
    offset: [-120, -460, 300],
    cut: true,
  },
  { t: 45, targetAnchor: { lerp: ["site", "mall", 0.6] }, h: 20, offset: [-135, -490, 315] },
];

/**
 * Floors topped out at fractional month m: the schedule's end-of-month counts, rising linearly
 * through each month (so the tower grows smoothly while the HUD shows the month's own row).
 */
export function buildFloorsAt(plan: DevelopmentPlan, m: number): number {
  const f = plan.schedule.floors_by_month;
  if (f.length === 0) return 0;
  const i = Math.max(0, Math.min(f.length - 1, Math.floor(m)));
  const prev = i > 0 ? (f[i - 1] as number) : 0;
  const cur = f[i] as number;
  return Math.min(plan.site.storeys, prev + (cur - prev) * clamp01(m - i));
}

/**
 * Lit-window share in whole floors: 0 before 28 s, rising monotonically to 0.9 by 33 s, then to
 * 0.95 by 45 s. The same curve as the 3D move-in (`setPieces.ts` `litShareAt`), so its counter and
 * this one agree.
 */
export function buildLitAt(t: number, storeys: number): number {
  const n = Math.max(1, storeys);
  const whole = (k: number) => Math.floor(k * n + 1e-9) / n;
  if (t < BUILD_T.lit[1]) return whole(BUILD_T.litTarget * ease(span(t, ...BUILD_T.lit)));
  return whole(
    BUILD_T.litTarget + (BUILD_T.litDaily - BUILD_T.litTarget) * span(t, ...BUILD_T.daily),
  );
}

/** Homes occupied (display value): lit share × homes, rounded (the 3D `moveInCounter`). */
export const buildOccupancyAt = (t: number, plan: DevelopmentPlan) =>
  Math.round(buildLitAt(t, plan.site.storeys) * plan.site.homes);

/** Seconds of site work by t (Construction minus the Hari Raya hold), for the crane's slew. */
function buildWorkAt(t: number, raya: readonly [number, number] | null): number {
  const [a, b] = BUILD_T.construction;
  const u = Math.max(a, Math.min(b, t));
  const hold = raya ? Math.max(0, Math.min(u, raya[1]) - raya[0]) : 0;
  return u - a - hold;
}

/**
 * The sun (display only): a late-morning day through the build and handover (the 45 s timeline
 * shows months, not days, so no day/night strobe), easing to late afternoon over Daily Life.
 */
function buildSunAt(t: number): StateAt["sun"] {
  if (t < BUILD_T.daily[0]) return { phase01: 0.45, elevation: 1, isNight: false };
  const u = ease(span(t, ...BUILD_T.daily));
  return { phase01: 0.45 + 0.27 * u, elevation: 1 - 0.6 * u, isNight: false };
}

function buildClockAt(t: number, plan: DevelopmentPlan, m: number): StateAt["simClock"] {
  const sch = plan.schedule;
  const i = Math.max(0, Math.min(sch.months_total - 1, Math.floor(m)));
  if (t < BUILD_T.construction[0]) return { label: "—" };
  if (t < BUILD_T.handover[0])
    return { label: `Month ${i + 1} of ${sch.months_total}`, month: i + 1 };
  if (t < BUILD_T.daily[0]) return { label: "Handover", month: sch.months_total };
  return { label: "After handover" };
}

function buildStateAt(t: number, plan: DevelopmentPlan): StateAt {
  const pb = planPlayback(plan);
  const m = monthAt(t, pb.keys);
  const storeys = plan.site.storeys;
  const [c0, c1] = BUILD_T.construction;
  const inRaya = !!pb.raya && t >= pb.raya[0] && t < pb.raya[1];
  const cons = t >= c0 && t < c1;
  const w = buildWorkAt(t, pb.raya);
  const fast = t >= c0 && t < BUILD_T.handover[1];
  return {
    act: actAt(t, plan.acts).name,
    simClock: buildClockAt(t, plan, m),
    sun: buildSunAt(t),
    occupancy: buildOccupancyAt(t, plan),
    floorsBuilt: t < c0 ? 0 : t >= c1 ? storeys : buildFloorsAt(plan, m),
    workersActive: cons && !inRaya,
    windowsLitFraction: buildLitAt(t, storeys),
    hoarding: t >= BUILD_T.hoarding[0] && t < BUILD_T.hoarding[1],
    crane: { slewRad: Math.sin(w * 0.9) * 1.3 + 0.6, beaconOn: false },
    lorries: t >= BUILD_T.lorries[0] && t < BUILD_T.lorries[1],
    movers: { queueProgress: span(t, ...BUILD_T.movers) },
    bubbles: plan.bubbles
      .filter((b) => t >= b.t0 && t < b.t1)
      .map((b) => ({ n: b.n, who: b.who, text: b.text, tag: b.tag ?? null })),
    camera: cameraAt(t, plan, BUILD_CAM_KEYS),
    flow: {
      timeScale: fast ? FAST_FORWARD : 1,
      peopleDensity: inRaya ? 0.6 : 1,
      vehicleDensity: inRaya ? 0.5 : 1,
    },
    brief: t >= BUILD_T.brief,
  };
}

// ---------- the legacy 66 s frame ----------

/** The legacy 66 s plan's frame (no schedule): the prototype-derived developer-lens timeline. */
function legacyStateAt(t: number, plan: DevelopmentPlan): StateAt {
  const sun = sunAt(t);
  const day = dayness(sun.e);
  const isNight = day < 0.5;
  const storeys = plan.site.storeys;
  const cons = t >= CON[0] && t < CON[1] - 0.4;
  const w = cons ? workAt(t) : 0;
  const lit = occupiedShare(t);
  return {
    act: actAt(t, plan.acts).name,
    simClock: simClockAt(t),
    sun: { phase01: sun.tod, elevation: sun.e, isNight },
    occupancy: occupancyAt(t, plan.households),
    floorsBuilt: floorsAt(t, storeys),
    workersActive: cons && !isNight,
    // floor by floor: whole floors light, never part of one
    windowsLitFraction: t < HAND[0] ? 0 : Math.floor(lit * storeys) / storeys,
    hoarding: t >= CON[0] && t < HOARDING_OFF,
    crane: {
      slewRad: Math.sin(w * 0.9) * 1.3 + 0.6,
      beaconOn: cons && 1 - day > 0.3 && Math.floor(t * 3) % 2 === 0,
    },
    lorries: t >= LORRIES_AT && t < DAY[0],
    movers: {
      queueProgress: t < HAND[0] ? 0 : clamp01((t - MOVE_IN) / (MOVE_GAP * MOVERS)),
    },
    bubbles: plan.bubbles
      .filter((b) => t >= b.t0 && t < b.t1)
      .map((b) => ({ n: b.n, who: b.who, text: b.text, tag: b.tag ?? null })),
    camera: cameraAt(t, plan, CAM_KEYS),
    flow: flowAt(t),
    brief: false,
  };
}

/** Everything one frame needs at screen second t (clamped to [0, total]). Deterministic. */
export function stateAt(tIn: number, plan: DevelopmentPlan): StateAt {
  const t = Math.max(0, Math.min(plan.total_s, Number.isFinite(tIn) ? tIn : 0));
  return isBuildPlan(plan) ? buildStateAt(t, plan) : legacyStateAt(t, plan);
}
