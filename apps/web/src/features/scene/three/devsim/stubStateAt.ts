/**
 * TEMPORARY (3D lane, deleted at M2): a local stand-in for FE's `features/devsim/timeline.ts`
 * `stateAt(t, plan)`, ported from the prototype (`docs/03-product/prototypes/developer-lens/
 * index.html`: ACTS, sunAt, WORK, builtAt, homesAt, CAM, the render loop). Nothing here is a fact:
 * every value is a display value of the simulation clock. Import it only through `./state.ts`, so
 * the M2 swap to FE's timeline is a one-line change there.
 */
import type { Act, DevelopmentPlan, StateAt } from "../../../devsim/types";

const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
export const ease = (u: number) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

const CON_P = 2.8;
const PHASE0 = 0.15;
const DAY_E: [number, number][] = [
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

function actSpan(plan: DevelopmentPlan, name: string, fb: [number, number]): [number, number] {
  const a = plan.acts.find((x: Act) => x.name === name);
  return a ? [a.t0, a.t1] : fb;
}

interface Times {
  con: [number, number];
  hand: [number, number];
  day: [number, number];
  handP: number;
  work: number[];
  workTop: number;
  workStart: number;
}
const timesCache = new WeakMap<DevelopmentPlan, Times>();

/** Sun height e (> 0 day, < 0 night, prototype units) and the cycle phase (0..1, 0.25 = noon). */
function sunRaw(t: number, tm: Pick<Times, "con" | "hand" | "day" | "handP">) {
  const cyc = (t0: number, p: number) => {
    const ph = (t - t0) / p + PHASE0;
    return { e: Math.min(1.1, Math.sin(2 * Math.PI * ph) + 0.25), ph: ((ph % 1) + 1) % 1 };
  };
  if (t >= tm.con[0] && t < tm.con[1]) return cyc(tm.con[0], CON_P);
  if (t >= tm.hand[0] && t < tm.hand[1]) return cyc(tm.hand[0], tm.handP);
  if (t >= tm.day[0]) {
    let i = 0;
    while (i < DAY_E.length - 2 && t > (DAY_E[i + 1] as [number, number])[0]) i++;
    const [ta, ea] = DAY_E[i] as [number, number];
    const [tb, eb] = DAY_E[i + 1] as [number, number];
    // the clock minutes give the phase in Daily Life (07:00 -> ~19:40)
    return { e: ea + (eb - ea) * ease(span(t, ta, tb)), ph: dayMinutes(t) / 1440 - 0.25 };
  }
  return { e: 1.0, ph: 0.3 };
}

export const dayness = (e: number) => ease(span(e, -0.08, 0.22));

function timesOf(plan: DevelopmentPlan): Times {
  const hit = timesCache.get(plan);
  if (hit) return hit;
  const con = actSpan(plan, "Construction", [4, 32]);
  const hand = actSpan(plan, "Handover", [32, 44]);
  const day = actSpan(plan, "Daily Life", [44, 63]);
  const handP = (hand[1] - hand[0]) / 1.85;
  const work: number[] = [];
  for (let t = con[0], w = 0; t <= con[1] + 0.02; t += 0.02) {
    work.push(w);
    w += (dayness(sunRaw(t, { con, hand, day, handP }).e) > 0.5 ? 1 : 0) * 0.02;
  }
  const at = (t: number) =>
    work[Math.max(0, Math.min(work.length - 1, Math.round((t - con[0]) / 0.02)))] as number;
  const tm = {
    con,
    hand,
    day,
    handP,
    work,
    workTop: at(con[1] - 1.4),
    workStart: at(con[0] + 1.2),
  };
  timesCache.set(plan, tm);
  return tm;
}

function workAt(tm: Times, t: number): number {
  const i = Math.round((t - tm.con[0]) / 0.02);
  return tm.work[Math.max(0, Math.min(tm.work.length - 1, i))] as number;
}

function dayMinutes(t: number): number {
  return t < 51
    ? 420 + 50 * span(t, 44, 51)
    : t < 57.5
      ? 630 + 120 * span(t, 51, 57.5)
      : 1080 + 100 * span(t, 57.5, 63);
}
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor((m % 60) / 5) * 5).padStart(2, "0")}`;

// ---- planar helpers (lon/lat <-> metres around a reference point) ----
type V = [number, number];
interface Planar {
  m(ll: number[]): V;
  ll(p: V): V;
}
function planarAt(ref: number[]): Planar {
  const lat0 = ref[1] as number;
  const lon0 = ref[0] as number;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return {
    m: (ll) => [((ll[0] as number) - lon0) * kx, ((ll[1] as number) - lat0) * ky],
    ll: ([x, y]) => [lon0 + x / kx, lat0 + y / ky],
  };
}
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k];
const lerp = (a: V, b: V, u: number): V => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

/** Camera keyframe: [t, target (east, north metres from the tower centre, h), offset (e, n, u)]. */
type Key = [number, [number, number, number], [number, number, number]];
const camCache = new WeakMap<DevelopmentPlan, { keys: Key[]; P: Planar }>();

function camKeys(plan: DevelopmentPlan) {
  const hit = camCache.get(plan);
  if (hit) return hit;
  const fp = plan.site.footprint;
  const c = fp.reduce<V>(
    (a, p) => [a[0] + (p[0] as number) / fp.length, a[1] + (p[1] as number) / fp.length],
    [0, 0],
  );
  const P = planarAt(c);
  const TC: V = [0, 0];
  const b = (plan.site.entrance.facing_deg * Math.PI) / 180;
  const EN: V = [Math.sin(b), Math.cos(b)];
  const TN: V = [-EN[1], EN[0]];
  const DOOR = P.m(plan.site.entrance.door);
  const path = plan.site.entrance.path;
  const NODE = P.m(path[path.length - 1] ?? plan.site.entrance.door);
  const onPath = (d: number, lat = 0) => add(add(DOOR, EN, d), TN, lat);
  const YARD = add(TC, EN, -30);
  const YDIR: V = [-EN[0], -EN[1]];
  const hp = plan.anchors.halim_path;
  const WMID = P.m(hp[Math.floor(hp.length * 0.5)] ?? c);
  const FARID = P.m(plan.anchors.farid);
  const QV = P.m(plan.anchors.junction);
  const PARK = P.m(plan.anchors.park);
  const MALL = P.m(plan.anchors.mall);
  const at = (v: V, h: number): [number, number, number] => [v[0], v[1], h];
  const ENTV = (d: number, s: number, h: number): [number, number, number] => {
    const p = add(add([0, 0], EN, d), TN, s);
    return [p[0], p[1], h];
  };
  const keys: Key[] = [
    [0, at(TC, 0), [-200, -520, 520]],
    [3.6, at(lerp(YARD, TC, 0.3), 4), [YDIR[0] * 60 - 20, YDIR[1] * 60 - 30, 34]],
    [8.6, at(lerp(YARD, TC, 0.5), 10), [YDIR[0] * 75 - 25, YDIR[1] * 75 - 40, 46]],
    [10.4, at(TC, 26), [-130, -180, 95]],
    [15.4, at(TC, 34), [-145, -200, 105]],
    [17.2, at(lerp(TC, WMID, 0.55), 12), [-10, -175, 95]],
    [21.6, at(lerp(TC, WMID, 0.6), 10), [0, -150, 82]],
    [22.8, at(FARID, 6), [-18, 48, 20]],
    [26.4, at(FARID, 7), [-14, 42, 18]],
    [28, at(TC, 45), [-150, -240, 130]],
    [32, at(TC, 46), [-165, -255, 138]],
    [34.6, at(onPath(6, 0), 3), ENTV(26, 30, 17)],
    [39.6, at(onPath(5, 0), 3), ENTV(22, 26, 14)],
    [44, at(onPath(6, 0), 2.6), ENTV(22, 24, 13)],
    [47, at(lerp(NODE, QV, 0.45), 2), ENTV(-26, 22, 24)],
    [51.6, at(lerp(NODE, QV, 0.45), 2), ENTV(-22, 19, 21)],
    [52.8, at(PARK, 2), [-44, -48, 30]],
    [57, at(PARK, 2), [-38, -42, 26]],
    [58, at(MALL, 3), [-50, -40, 30]],
    [62.4, at(MALL, 3), [-44, -34, 26]],
    [63.6, at(lerp(TC, MALL, 0.9), 20), [-120, -470, 300]],
    [66, at(lerp(TC, MALL, 0.9), 20), [-130, -490, 310]],
  ];
  const out = { keys, P };
  camCache.set(plan, out);
  return out;
}

function camAt(plan: DevelopmentPlan, t: number): StateAt["camera"] {
  const { keys, P } = camKeys(plan);
  let i = 0;
  while (i < keys.length - 2 && t > (keys[i + 1] as Key)[0]) i++;
  const a = keys[i] as Key;
  const b = keys[i + 1] as Key;
  const u = ease(span(t, a[0], b[0]));
  const mix = (x: number[], y: number[]) => x.map((v, k) => v + ((y[k] as number) - v) * u);
  const tg = mix(a[1], b[1]);
  const off = mix(a[2], b[2]);
  const ll = P.ll([tg[0] as number, tg[1] as number]);
  return {
    target: [ll[0], ll[1], tg[2] as number],
    offset: [off[0] as number, off[1] as number, off[2] as number],
  };
}

/** The prototype's frame state at t (screen seconds). Pure: the same (t, plan) gives the same state. */
export function stubStateAt(t: number, plan: DevelopmentPlan): StateAt {
  const tm = timesOf(plan);
  const [c0, c1] = tm.con;
  const [h0, h1] = tm.hand;
  const [d0, d1] = tm.day;
  const act =
    plan.acts.find((a) => t >= a.t0 && t < a.t1)?.name ?? plan.acts.at(-1)?.name ?? "Summary";
  const sn = sunRaw(t, tm);
  const night = 1 - dayness(sn.e);
  // phase01: share of the solar day, 0.5 = noon (the cycle phase is 0.25 at noon)
  const phase01 = (((sn.ph + 0.25) % 1) + 1) % 1;
  const NFL = plan.site.storeys;
  const built =
    t < c0
      ? 0
      : t >= c1
        ? NFL
        : NFL * clamp01((workAt(tm, t) - tm.workStart) / (tm.workTop - tm.workStart));
  const cons = t >= c0 && t < c1 - 0.4;
  const w = cons ? workAt(tm, t) : 0;
  const homes = plan.households;
  const occupancy = Math.round(
    t < d0 ? homes * 0.92 * ease(span(t, 34, 43)) : homes * (0.92 + 0.056 * span(t, d0, d1)),
  );
  const lit = t < h0 + 2 ? 0 : t < d0 ? 0.75 * span(t, 34, 43) : 0.75 + 0.2 * span(t, d0, d1);
  const month = 1 + Math.floor(23 * span(t, c0, c1 - 0.1));
  const week = 1 + Math.floor(2 * span(t, h0, h1 - 0.1));
  const dm = dayMinutes(t);
  const simClock: StateAt["simClock"] =
    t < c0
      ? { label: "—" }
      : t < c1
        ? { label: `Month ${month} of 24`, month }
        : t < h1
          ? { label: `Handover · week ${week} of 2`, week }
          : t < d1
            ? { label: `Day 30 · ${hhmm(dm)}`, day: 30, hhmm: hhmm(dm) }
            : { label: "First month" };
  const ff = (t >= c0 && t < c1) || (t >= h0 && t < h1);
  const dn = dayness(sn.e);
  // morning rush in Daily Life (07:00-08:30)
  const rush = t >= d0 && t < d1 && dm < 510 ? 0.3 : 0;
  const flowDensity = Math.min(1.3, 0.35 + 0.65 * dn + rush);
  const env = t >= 50.4 && t < 51.6 ? { progress: ease(span(t, 50.4, 51.6)) } : null;
  return {
    act,
    simClock,
    sun: { phase01, elevation: sn.e, isNight: night >= 0.5 },
    occupancy,
    floorsBuilt: built,
    workersActive: cons && night < 0.5,
    windowsLitFraction: lit,
    hoarding: t >= c0 && t < h0 + 1.6,
    crane: {
      slewRad: Math.sin(w * 0.9) * 1.3 + 0.6,
      beaconOn: cons && night > 0.3 && Math.floor(t * 3) % 2 === 0,
    },
    lorries: t >= h0 + 1 && t < d0,
    movers: { queueProgress: span(t, 33.6, 44) },
    bubbles: plan.bubbles
      .filter((b) => t >= b.t0 && t < b.t1)
      .map((b) => ({ n: b.n, who: b.who, text: b.text, tag: b.tag ?? null })),
    feedbackCount: t >= 51.6 ? 1 : 0,
    envelope: env,
    camera: camAt(plan, t),
    flow: { timeScale: ff ? 8 : 1, peopleDensity: flowDensity, vehicleDensity: flowDensity },
    endCard: t >= 63.3,
  };
}
