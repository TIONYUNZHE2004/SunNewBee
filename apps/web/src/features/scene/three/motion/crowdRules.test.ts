import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CrowdManifest, parseCrowdManifest } from "../assets/crowdManifest";
import { parseManifest } from "../assets/manifest";
import { HERO_DISPLAY_SCALE } from "../characters/hero";
import { createFrame } from "../frame";
import { boxAround } from "../stream/area";
import {
  type Agent,
  PAVEMENT_FLOOR_M,
  PEOPLE_SCALE_MAX,
  PEOPLE_SCALE_NEAR,
  PEOPLE_VISIBLE_M,
  peopleScale,
  planAgents,
  poseAt,
} from "./agents";
import { advanceGait, type GaitState, gaitCyclesPerSecond } from "./crowdGait";
import { crowdLodBands } from "./crowdRenderer";
import {
  assignLooks,
  CADENCE_MAX_HZ,
  JOGGER_BODIES,
  KEEP_OUT_AHEAD_M,
  KEEP_OUT_M,
  type KeepOutMemory,
  keepOut,
  keepOutDistance,
  LOOK_TWIN_M,
  type LookMemory,
  lookSpeed,
  pathGap,
  polylineDistance,
} from "./crowdRules";

const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const crowd = parseCrowdManifest(
  JSON.parse(readFileSync(pub("/city/characters/crowd.json"), "utf8")),
).manifest as CrowdManifest;
const city = parseManifest(JSON.parse(readFileSync(pub("/city/manifest.json"), "utf8"))).manifest!;

const person = (id: string, pts: number[], over: Partial<Agent> = {}): Agent => {
  let length = 0;
  for (let i = 0; i + 3 < pts.length; i += 2)
    length += Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!);
  return {
    id,
    kind: "person",
    variant: "office_man",
    path: Float32Array.from(pts),
    length,
    speed: 1.35,
    offset: 0,
    ...over,
  };
};

describe("P6: people scale (R-J3, R-J7)", () => {
  it("1.4–1.55x within 300 m (the hero's 1.55x), 2.5x at 800 m and beyond", () => {
    expect(PEOPLE_SCALE_NEAR).toBe(HERO_DISPLAY_SCALE);
    expect(HERO_DISPLAY_SCALE).toBe(1.55);
    expect(peopleScale(0)).toBe(1.55);
    expect(peopleScale(300)).toBe(1.55);
    expect(peopleScale(550)).toBeCloseTo(2.025, 6);
    expect(peopleScale(800)).toBe(2.5);
    expect(peopleScale(1500)).toBe(2.5);
    expect(PEOPLE_SCALE_MAX).toBe(2.5);
    for (let d = 0; d <= 300; d += 5) {
      expect(peopleScale(d)).toBeGreaterThanOrEqual(1.4);
      expect(peopleScale(d)).toBeLessThanOrEqual(1.55);
    }
  });

  it("monotonic and continuous (no step), never above 2.5x", () => {
    let prev = peopleScale(0);
    let maxStep = 0;
    for (let d = 0.01; d <= 2000; d += 0.01) {
      const k = peopleScale(d);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(k).toBeLessThanOrEqual(2.5);
      maxStep = Math.max(maxStep, k - prev);
      prev = k;
    }
    // The steepest slope is 1.5 x 0.95 / 500 m per metre (smoothstep): ~2.9e-5 per 1 cm.
    expect(maxStep).toBeLessThan(5e-5);
    // Smooth at both joins: the slope is ~0 just inside each end.
    expect(peopleScale(301) - peopleScale(300)).toBeLessThan(1e-4);
    expect(peopleScale(800) - peopleScale(799)).toBeLessThan(1e-4);
  });

  it("people render LOD1 out to 800 m (crowd bands), hidden beyond", () => {
    expect(PEOPLE_VISIBLE_M).toBe(800);
    expect(crowdLodBands(crowd.lods)).toEqual([{ maxM: 60 }, { maxM: 800 }]);
  });
});

describe("speed per look", () => {
  const look = (id: string) => crowd.looks.find((l) => l.id === id)!;
  const stride = (id: string) => {
    const l = look(id);
    return crowd.bodies[l.body].clips[l.clips.walk]!.stride;
  };
  const speedOf = (id: string, over: Partial<Agent> = {}) =>
    lookSpeed(person("p", [0, 0, 100, 0], over), look(id), stride(id));

  it("older, walker and wheelchair looks walk slower than an adult", () => {
    const adult = speedOf("man_office_blue");
    for (const id of [
      "oldman_baju_melayu_cream",
      "oldwoman_baju_kurung_blue",
      "oldman_baju_melayu_walker",
      "oldwoman_bun_walker",
      "man_casual_wheelchair",
      "woman_office_wheelchair",
      "oldman_kopiah_wheelchair",
    ])
      expect(speedOf(id), id).toBeLessThan(adult * 0.9);
    expect(speedOf("oldwoman_bun_walker")).toBeLessThan(speedOf("oldwoman_casual_bun"));
  });

  it("cadence stays sane (<= 1.5 cycles/s at 1.55x) for every look, joggers included", () => {
    for (const l of crowd.looks)
      for (const variant of ["office_man", "jogger"]) {
        const v = lookSpeed(
          person("p", [0, 0, 100, 0], { variant, speed: variant === "jogger" ? 2.5 : 1.5 }),
          l,
          stride(l.id),
        );
        expect(v).toBeGreaterThan(0.3);
        expect(gaitCyclesPerSecond(v, stride(l.id), PEOPLE_SCALE_NEAR)).toBeLessThanOrEqual(
          CADENCE_MAX_HZ + 1e-9,
        );
      }
  });

  it("the gait cycle rate matches each look's speed within ±10% (P5 still holds)", () => {
    for (const l of crowd.looks) {
      const s = stride(l.id);
      const clip = { stride: s, duration: crowd.bodies[l.body].clips[l.clips.walk]!.duration };
      const idle = { stride: 0, duration: 3 };
      const a = person(l.id, [0, 0, 500, 0], { speed: lookSpeed(person("p", [0, 0, 1, 0]), l, s) });
      const st: GaitState = { phase: 0, dist: 0, idle: false };
      let cycles = 0;
      let prevPhase = 0;
      const pose = { x: 0, z: 0, yaw: 0 };
      for (let i = 1; i <= 200; i++) {
        poseAt(a, i * 0.05, pose);
        advanceGait(st, pose.x, 0.05, PEOPLE_SCALE_NEAR, clip, idle);
        cycles += (st.phase - prevPhase + 1) % 1;
        prevPhase = st.phase;
      }
      const want = pose.x / 10 / (s * PEOPLE_SCALE_NEAR);
      expect(Math.abs(cycles / 10 - want) / want, l.id).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("P3: look assignment", () => {
  // A dense block: 12 parallel 120 m paths 4 m apart, crossed by 12 more, 3 people on each.
  const block: Agent[] = [];
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 3; j++) {
      block.push(person(`h${i}:${j}`, [0, i * 4, 120, i * 4]));
      block.push(person(`v${i}:${j}`, [i * 10, -5, i * 10, 50]));
    }

  it("is seeded and deterministic, whatever the input order", () => {
    const a = assignLooks(block, crowd.looks);
    const b = assignLooks([...block].reverse(), crowd.looks);
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.size).toBe(block.length);
  });

  it("people whose paths come within 10 m never share a look (when the looks suffice)", () => {
    const sparse = block.filter((a) => a.id.endsWith(":0"));
    const looks = assignLooks(sparse, crowd.looks);
    let pairs = 0;
    for (const a of sparse)
      for (const b of sparse) {
        if (a === b || pathGap(a, b) >= LOOK_TWIN_M) continue;
        pairs++;
        expect(looks.get(a.id), `${a.id} ${b.id}`).not.toBe(looks.get(b.id));
      }
    expect(pairs).toBeGreaterThan(100);
  });

  it("a crowded junction still spreads the looks (the farthest same-look path when all are taken)", () => {
    const looks = assignLooks(block, crowd.looks);
    expect(new Set(looks.values()).size).toBe(crowd.looks.length);
  });

  it("memory keeps survivors' looks when new people arrive; new ones avoid them", () => {
    const mem: LookMemory = new Map();
    const first = block.slice(0, 10);
    const one = assignLooks(first, crowd.looks, mem);
    const two = assignLooks(block.slice(0, 20), crowd.looks, mem);
    for (const a of first) expect(two.get(a.id)).toBe(one.get(a.id));
    expect(mem.size).toBe(20);
    // Pruned to the latest set.
    assignLooks(block.slice(5, 8), crowd.looks, mem);
    expect([...mem.keys()].sort()).toEqual(
      block
        .slice(5, 8)
        .map((a) => a.id)
        .sort(),
    );
  });

  it("joggers only take a young or adult look with no prop", () => {
    const joggers = block.map((a) => ({ ...a, variant: "jogger" }));
    const looks = assignLooks(joggers, crowd.looks);
    for (const l of looks.values()) {
      const spec = crowd.looks[l]!;
      expect(JOGGER_BODIES.has(spec.body)).toBe(true);
      expect(spec.prop).toBeNull();
    }
  });
});

describe("P8: keep-out around the hero", () => {
  const hero = { x: 0, z: 0, yaw: 0 }; // facing +z

  it("outside the zone nothing moves; without a hero nothing moves", () => {
    const mem: KeepOutMemory = {};
    expect(keepOut(5, 3, hero, mem)).toEqual({ x: 5, z: 3, hidden: false });
    expect(keepOut(0.5, 0.5, null, mem)).toEqual({ x: 0.5, z: 0.5, hidden: false });
  });

  it("people inside are pushed out to >= 2 m from her and her next 10 m, on their own side", () => {
    for (const [x, z] of [
      [1, 0],
      [-1, 5],
      [0.3, 9.9],
      [0.5, 11],
      [-0.5, -1],
      [0, 3],
    ] as const) {
      const r = keepOut(x, z, hero, {});
      expect(r.hidden).toBe(false);
      expect(keepOutDistance(r.x, r.z, hero)).toBeGreaterThanOrEqual(KEEP_OUT_M);
      if (x !== 0) expect(Math.sign(r.x)).toBe(Math.sign(x));
    }
    expect(KEEP_OUT_AHEAD_M).toBe(10);
  });

  it("works for any heading", () => {
    for (const yaw of [0.3, 1.7, -2.5, Math.PI]) {
      const h = { x: 10, z: -4, yaw };
      const ahead = { x: h.x + Math.sin(yaw) * 5, z: h.z + Math.cos(yaw) * 5 };
      const r = keepOut(ahead.x + 0.2, ahead.z, h, {});
      expect(keepOutDistance(r.x, r.z, h)).toBeGreaterThanOrEqual(KEEP_OUT_M);
    }
  });

  it("as she walks past a standing person, the person steps aside continuously (no jump)", () => {
    const mem: KeepOutMemory = {};
    let last: { x: number; z: number } | null = null;
    for (let t = 0; t <= 30; t += 0.02) {
      const h = { x: 0, z: -15 + 1.2 * t, yaw: 0 };
      const r = keepOut(0.4, 0, h, mem);
      expect(r.hidden).toBe(false);
      expect(keepOutDistance(r.x, r.z, h)).toBeGreaterThanOrEqual(KEEP_OUT_M);
      if (last) expect(Math.hypot(r.x - last.x, r.z - last.z)).toBeLessThan(0.1);
      last = r;
    }
  });

  it("with her published path ahead (a right-angle bend), people keep >= 2 m from the bend too", () => {
    // She walks +z, the path turns to +x after 4 m.
    const ahead: [number, number][] = [];
    for (let k = 1; k <= 40; k++) {
      const m = k * 0.25;
      ahead.push(m <= 4 ? [0, m] : [m - 4, 4]);
    }
    const h = { x: 0, z: 0, yaw: 0, ahead };
    const spine: [number, number][] = [
      [0, 0],
      [0, 4],
      [6, 4],
    ];
    let checked = 0;
    for (let x = -3; x <= 9; x += 0.37)
      for (let z = -3; z <= 7; z += 0.41) {
        const r = keepOut(x, z, h, {});
        if (r.hidden) continue;
        checked++;
        expect(polylineDistance(r.x, r.z, spine), `${x},${z}`).toBeGreaterThanOrEqual(KEEP_OUT_M);
      }
    expect(checked).toBeGreaterThan(500);
    // Without `ahead` the zone is 10 m along her heading instead.
    expect(keepOutDistance(0, 9, { x: 0, z: 0, yaw: 0 })).toBe(0);
  });

  it("A4w: a person walking past the outside of a bend in her path ahead moves continuously (no snap where the deeper segment changes)", () => {
    // The playback case: she walks -x, her path turns north-west 5 m ahead; a person walks by the
    // outside of the bend. Pushing across whichever segment was deeper snapped her 1.56 m once.
    const ahead: [number, number][] = [];
    for (let k = 1; k <= 40; k++) {
      const m = k * 0.25;
      ahead.push(m <= 5 ? [-m, 0] : [-5 - 0.6 * (m - 5), 0.8 * (m - 5)]);
    }
    const h = { x: 0, z: 0, yaw: -Math.PI / 2, ahead };
    const spine: [number, number][] = [
      [0, 0],
      [-5, 0],
      [-8, 4],
    ];
    for (const off of [-0.3, -0.6, -1, -1.5]) {
      const mem: KeepOutMemory = {};
      let last: { x: number; z: number } | null = null;
      let worst = 0;
      // 1.3 m/s sampled at 30 Hz, along z = off past the bend's outside (south of the joint)
      for (let x = -2; x >= -9; x -= 1.3 / 30) {
        const r = keepOut(x, off, h, mem);
        if (r.hidden) {
          last = null;
          continue;
        }
        expect(polylineDistance(r.x, r.z, spine)).toBeGreaterThanOrEqual(KEEP_OUT_M);
        if (last) worst = Math.max(worst, Math.hypot(r.x - last.x, r.z - last.z));
        last = r;
      }
      // a 4.3 cm step never moves her more than 0.5 m: an arc round the joint (0.31 m at most when
      // she passes 0.3 m from it), not the old switch between the two segments (1.71 m)
      expect(worst, `offset ${off}`).toBeLessThan(0.5);
    }
  });

  it("a person crossing her path inside the zone is hidden, never drawn through her", () => {
    const mem: KeepOutMemory = {};
    const seen: boolean[] = [];
    for (let x = -3; x <= 3; x += 0.1) {
      const r = keepOut(x, 4, hero, mem);
      seen.push(r.hidden);
      if (!r.hidden) expect(keepOutDistance(r.x, r.z, hero)).toBeGreaterThanOrEqual(KEEP_OUT_M);
    }
    expect(seen.some(Boolean)).toBe(true);
  });
});

describe("planAgents pavements, obstacles and the spawn floor (A-T12 hand-off, P7)", () => {
  const frame = createFrame([101.5, 3.18]);
  const ll = (x: number, z: number) => frame.toLonLat(x, z);
  const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
  const line = (type: string, pts: [number, number][], id: string) => ({
    type: "Feature",
    properties: { id, type },
    geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
  });
  const rect = (x0: number, z0: number, x1: number, z1: number) => ({
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[ll(x0, z0), ll(x1, z0), ll(x1, z1), ll(x0, z1), ll(x0, z0)]],
    },
  });
  const base = {
    places: fc(),
    frame,
    area: { box: boxAround(0, 0, 500), seed: "t" },
    tier: "high" as const,
    caps: { vehicles: 0, people: 1000 },
    m: city,
  };
  const people = (over: Partial<Parameters<typeof planAgents>[0]>) =>
    planAgents({ walk: fc(), ...base, ...over }).filter((a) => a.kind === "person");
  const zs = (a: Agent) => {
    const out: number[] = [];
    for (let i = 1; i < a.path.length; i += 2) out.push(a.path[i] as number);
    return out;
  };

  it("sidewalk and crossing lines carry people", () => {
    expect(
      people({
        walk: fc(
          line(
            "sidewalk",
            [
              [-200, 0],
              [200, 0],
            ],
            "s",
          ),
        ),
      }).length,
    ).toBeGreaterThan(0);
    expect(
      people({
        walk: fc(
          line(
            "crossing",
            [
              [-20, 0],
              [20, 0],
            ],
            "c",
          ),
        ),
      }).length,
    ).toBeGreaterThan(0);
  });

  it("a footprint on one side of a street moves its people to the other side; on both, none", () => {
    const walk = fc(
      line(
        "street",
        [
          [-200, 0],
          [200, 0],
        ],
        "s",
      ),
    );
    const free = people({ walk });
    expect(free.some((a) => zs(a)[0]! > 0)).toBe(true);
    expect(free.some((a) => zs(a)[0]! < 0)).toBe(true);
    const north = people({
      walk,
      obstacles: { buildings: fc(rect(-300, -20, 300, -3.2)) },
    });
    expect(north.length).toBe(free.length);
    for (const a of north) for (const z of zs(a)) expect(z).toBeGreaterThan(3.5);
    const both = people({
      walk,
      obstacles: { buildings: fc(rect(-300, -20, 300, -3.2)), water: fc(rect(-300, 3.2, 300, 20)) },
    });
    expect(both).toEqual([]);
  });

  it("the spawn floor raises the people count above the cap: >= 1 per 40 m of street at day", () => {
    const walk = fc(
      ...Array.from({ length: 8 }, (_, i) =>
        line(
          "street",
          [
            [-240, -200 + i * 50],
            [240, -200 + i * 50],
          ],
          `s${i}`,
        ),
      ),
    );
    const day = { day: 1, dusk: 0, night: 0 };
    const capped = people({ walk, caps: { vehicles: 0, people: 10 }, weights: day });
    expect(capped.length).toBe(10);
    const floored = people({
      walk,
      caps: { vehicles: 0, people: 10 },
      weights: day,
      floorPerM: 1 / PAVEMENT_FLOOR_M,
    });
    expect(floored.length).toBeGreaterThanOrEqual(Math.ceil((8 * 480) / 40));
  });
});
