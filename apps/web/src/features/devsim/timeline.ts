/**
 * Development Simulation timeline (spec 2026-10-21 §4.2–§4.4, §5.3, §7; AC-F1, AC-F2, Q4).
 *
 * Pure maths, no Three.js: `stateAt(t, plan)` gives everything one frame needs at screen second t.
 * Ported from the approved prototype (docs/03-product/prototypes/developer-lens/index.html: `ACTS`,
 * `sunAt`, `WORK`, `homesAt`, `BUBBLES`, `ENVELOPE`, `CAM`, the HUD clock in `render`). Facts and
 * copy come from the plan; the clock, month, occupancy and flow are display values of the
 * simulation clock and are never cited as facts (spec §3).
 */
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
/** The envelope flies for this long after bubble 5 ends; the feedback counter steps when it lands. */
export const ENVELOPE_FLIGHT_S = 1.2;
/** The "What residents raised" card shows from here. */
export const END_CARD_AT = 63.3;
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
  | "mall";
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
}

/** The prototype's `CAM` keyframes, subject for subject (§4.4). */
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
  // Gate 2 fix: the tower (left third) and Halim on his detour (right) in one frame, as the
  // prototype frames them: aimed between them and pulled back from the south-south-west
  { t: 17.2, targetAnchor: { lerp: ["site", "halimMid", 0.5] }, h: 12, offset: [-20, -200, 105] },
  { t: 21.6, targetAnchor: { lerp: ["site", "halimMid", 0.55] }, h: 10, offset: [-15, -180, 94] },
  // Gate 2 fix: from the south-west, over the yard, so no street tree stands between the camera
  // and Farid (the prototype's north-west view looks through a canopy on the Elmina plan)
  { t: 22.8, targetAnchor: "farid", h: 4, offset: [-32, -30, 22] },
  { t: 26.4, targetAnchor: "farid", h: 4, offset: [-28, -27, 19] },
  { t: 28, targetAnchor: "site", h: 45, offset: [-150, -240, 130] },
  { t: 32, targetAnchor: "site", h: 46, offset: [-165, -255, 138] },
  { t: 34.6, targetAnchor: { path: 6 }, h: 3, offset: { entrance: [26, 30, 17] } },
  { t: 39.6, targetAnchor: { path: 5 }, h: 3, offset: { entrance: [22, 26, 14] } },
  { t: 44, targetAnchor: { path: 6 }, h: 2.6, offset: { entrance: [22, 24, 13] } },
  {
    t: 47,
    // 3D integration: on the Elmina plan the junction anchor is the entrance node itself, so the
    // prototype's node-to-junction blend gives no lead; aim just past the node and tilted up so
    // Mei Ling sits right of centre at the queue, as the prototype frames her (AC-C1)
    targetAnchor: { lerp: ["node", "door", -0.05] },
    h: -1.5,
    offset: { entrance: [-26, 22, 24] },
  },
  {
    t: 51.6,
    targetAnchor: { lerp: ["node", "door", -0.05] },
    h: -1.5,
    offset: { entrance: [-22, 19, 21] },
  },
  // Gate 2 fix: the prototype's framing a third closer, so Zainab and Arjun read at the app's
  // (smaller than the prototype's) people scale
  { t: 52.8, targetAnchor: "park", h: 1.5, offset: [-30, -33, 21] },
  { t: 57, targetAnchor: "park", h: 1.5, offset: [-26, -29, 18] },
  { t: 58, targetAnchor: "mall", h: 2, offset: [-33, -27, 20] },
  { t: 62.4, targetAnchor: "mall", h: 2, offset: [-29, -23, 17] },
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
export function cameraAt(t: number, plan: DevelopmentPlan): StateAt["camera"] {
  const f = camFrame(plan);
  let i = 0;
  while (i < CAM_KEYS.length - 2 && t > (CAM_KEYS[i + 1] as CamKey).t) i++;
  const a = CAM_KEYS[i] as CamKey;
  const b = CAM_KEYS[i + 1] as CamKey;
  const u = ease(span(t, a.t, b.t));
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

// ---------- the frame ----------
/** Bubble 5 (the school-run complaint): its end launches the envelope. */
export function envelopeWindow(plan: DevelopmentPlan): [number, number] | null {
  const b = plan.bubbles.find((x) => x.n === 5);
  return b ? [b.t1, b.t1 + ENVELOPE_FLIGHT_S] : null;
}

/** Everything one frame needs at screen second t (clamped to [0, total]). Deterministic. */
export function stateAt(tIn: number, plan: DevelopmentPlan): StateAt {
  const t = Math.max(0, Math.min(plan.total_s, Number.isFinite(tIn) ? tIn : 0));
  const sun = sunAt(t);
  const day = dayness(sun.e);
  const isNight = day < 0.5;
  const storeys = plan.site.storeys;
  const cons = t >= CON[0] && t < CON[1] - 0.4;
  const w = cons ? workAt(t) : 0;
  const lit = occupiedShare(t);
  const env = envelopeWindow(plan);
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
    feedbackCount: env && t >= env[1] ? 1 : 0,
    envelope: env && t >= env[0] && t < env[1] ? { progress: ease(span(t, env[0], env[1])) } : null,
    camera: cameraAt(t, plan),
    flow: flowAt(t),
    endCard: t >= END_CARD_AT,
  };
}
