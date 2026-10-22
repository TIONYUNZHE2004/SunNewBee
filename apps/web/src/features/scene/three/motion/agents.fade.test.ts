import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame } from "../frame";
import { boxAround } from "../stream/area";
import {
  type Agent,
  EASE_AMP,
  FADE_S,
  fadeAt,
  nominalLength,
  planAgents,
  poseAt,
  WANDER_M,
} from "./agents";
import { avoidRoute } from "./motionLayer";

/**
 * AC-L3 (demo polish A1): at a path end, a tile edge (the walk's WANDER_M square) or an avoid zone,
 * an agent fades to opacity 0 within 1.0 s and respawns elsewhere; it never turns round there.
 */
const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;
const frame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const line = (id: string, type: string, pts: [number, number][]) => ({
  type: "Feature",
  properties: { id, type },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});

/** A straight street 2 km long in 50 m edges: every path ends at the wander square (a tile edge). */
const long = {
  type: "FeatureCollection",
  features: Array.from({ length: 40 }, (_, i) =>
    line(`s${i}`, "street", [
      [-1000 + i * 50, 0],
      [-950 + i * 50, 0],
    ]),
  ),
};
const plan = () =>
  planAgents({
    walk: long,
    places: { type: "FeatureCollection", features: [] },
    frame,
    area: { box: boxAround(0, 0, 200), seed: "fade" },
    tier: "medium",
    caps: { vehicles: 40, people: 40 },
    m: manifest,
  });

const lapTimes = (a: Agent) => {
  // seconds (at the slowest eased speed) for one lap: an upper bound on when the lap ends
  return nominalLength(a) / (a.speed * (1 - EASE_AMP));
};

describe("AC-L3: fade at a path end and respawn elsewhere", () => {
  const agents = plan();

  it("a long street's walks end at the wander square (a tile edge), not at the street's end", () => {
    expect(agents.length).toBeGreaterThan(20);
    for (const a of agents) {
      expect(a.ends).toBe("fade");
      expect(a.deadEnds).toBeUndefined(); // no dead end within reach: no U-turn
      const n = a.path.length;
      const ex = a.path[n - 2] as number;
      expect(Math.abs(ex)).toBeLessThan(1000 - 1); // never reached the street's own end
      // the chunk midpoint is in the box (+-200 m), so the end is within WANDER_M + a chunk of it
      expect(Math.abs(ex)).toBeLessThanOrEqual(200 + WANDER_M + 60);
    }
  });

  it("opacity falls to 0 within 1.0 s at the end, rises from 0 at the start; no turn there", () => {
    const pose = { x: 0, z: 0, yaw: 0 };
    const f = { opacity: 1, lap: 0 };
    const dt = 1 / 120;
    let checked = 0;
    for (const a of agents) {
      const T = 2 * lapTimes(a);
      let fadingSince = Number.NaN;
      let prevO = 1;
      let prevLap = Number.NaN;
      let prevYaw = Number.NaN;
      let prevX = Number.NaN;
      for (let t = 0; t <= T; t += dt) {
        poseAt(a, t, pose);
        fadeAt(a, t, f);
        if (f.lap !== prevLap && !Number.isNaN(prevLap)) {
          // respawn: from near opacity 0, somewhere else (its start), facing its start
          expect(prevO).toBeLessThan(0.05);
          expect(f.opacity).toBeLessThan(0.05);
          expect(Math.abs(pose.x - prevX)).toBeGreaterThan(10);
          checked++;
          fadingSince = Number.NaN;
        } else if (!Number.isNaN(prevLap)) {
          // until it is gone, it keeps its heading (no turn round at the end)
          expect(Math.abs(Math.sin(pose.yaw) - Math.sin(prevYaw))).toBeLessThan(0.05);
          if (f.opacity < prevO && Number.isNaN(fadingSince)) fadingSince = t;
          if (f.opacity > prevO) fadingSince = Number.NaN;
          if (!Number.isNaN(fadingSince) && f.opacity > 0)
            expect(t - fadingSince).toBeLessThanOrEqual(1.0);
        }
        prevO = f.opacity;
        prevLap = f.lap;
        prevYaw = pose.yaw;
        prevX = pose.x;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(FADE_S / (1 - EASE_AMP)).toBeLessThanOrEqual(1.0);
  });

  it("an avoid zone cuts a fading agent's route where it first enters the zone; it fades there", () => {
    const a = agents.find(
      (x) => x.kind === "person" && (x.path[2] as number) > (x.path[0] as number),
    )!;
    expect(a).toBeDefined();
    const x0 = a.path[0] as number;
    // the zone: everything 30 m past the start, eastward
    const zone = (x: number) => x > x0 + 30;
    const r = avoidRoute(a, (x) => zone(x))!;
    expect(r).not.toBeNull();
    expect(r.ends).toBe("fade");
    const n = r.path.length;
    // the route is the stretch up to the zone (not the longest piece; nothing beyond it)
    expect(r.path[n - 2] as number).toBeLessThanOrEqual(x0 + 30);
    expect(r.path[n - 2] as number).toBeGreaterThan(x0 + 25);
    const pose = { x: 0, z: 0, yaw: 0 };
    const f = { opacity: 1, lap: 0 };
    for (let t = 0; t < 120; t += 0.05) {
      poseAt(r, t, pose);
      fadeAt(r, t, f);
      expect(zone(pose.x)).toBe(false);
      // close to the zone it is fading (the last FADE_S x speed metres)
      if (pose.x > x0 + 30 - 0.01) expect(f.opacity).toBeLessThan(0.05);
    }
  });
});
