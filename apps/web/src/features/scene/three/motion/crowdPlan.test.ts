import { describe, expect, it } from "vitest";
import { VFOV_DEG } from "../cameraRig";
import { tileAt } from "../stream/tiles";
import { type Agent, PEOPLE_SCALE_NEAR, peopleScale, poseAt } from "./agents";
import { corridor, HAVE_SEED, routeTiles } from "./crowdCorridor.fixture";
import { LOOK_TWIN_M } from "./crowdRules";

/**
 * C-T8 on the Elmina seed: the crowd planned along the D-T4 demo route (route tiles at ring 0, their
 * neighbours at ring 1, High) with footprints and base water as obstacles.
 * P3 no twins within 10 m, P7 on the footways, and the A-T12 street-bookmark floor.
 */
const DAY = { day: 1, dusk: 0, night: 0 };
/** acceptance/support/bookmarks.ts `street` (Persiaran Tamarind): target, range, pitch, heading. */
const STREET = {
  centre: [101.50877, 3.185719] as [number, number],
  rangeM: 30,
  pitchDeg: -6,
  headingDeg: 144,
};

describe.skipIf(!HAVE_SEED)("crowd on the demo corridor (seed)", () => {
  const c = HAVE_SEED ? corridor() : (null as never);
  const agents = HAVE_SEED ? c.plan(routeTiles(c)) : [];
  const people = HAVE_SEED ? c.dress(agents) : [];
  const near = (a: Agent) => {
    // People whose path comes within 300 m of the route (the follow camera's world).
    for (let i = 0; i < a.path.length; i += 2)
      for (const [x, z] of c.route)
        if (Math.hypot((a.path[i] as number) - x, (a.path[i + 1] as number) - z) < 300) return true;
    return false;
  };
  const local = people.filter((p) => near(p.agent));

  it("plans a crowd there, with no cyclists, on footways and pavements", () => {
    expect(local.length).toBeGreaterThan(100);
    expect(agents.some((a) => a.variant === "cyclist")).toBe(false);
  });

  it("P3: in every frame over 10 min, no two people within 10 m share a look (seeded, deterministic)", () => {
    const again = c.dress(c.plan(routeTiles(c)));
    expect(again.map((p) => [p.agent.id, p.look])).toEqual(people.map((p) => [p.agent.id, p.look]));
    const pose = { x: 0, z: 0, yaw: 0 };
    let pairs = 0;
    for (let t = 0; t <= 600; t += 0.5) {
      const grid = new Map<string, { x: number; z: number; look: number }[]>();
      for (const p of local) {
        poseAt(p.agent, t, pose);
        const k = `${Math.floor(pose.x / LOOK_TWIN_M)},${Math.floor(pose.z / LOOK_TWIN_M)}`;
        const l = grid.get(k) ?? [];
        l.push({ x: pose.x, z: pose.z, look: p.look });
        grid.set(k, l);
      }
      for (const [k, l] of grid) {
        const [i, j] = k.split(",").map(Number) as [number, number];
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++) {
            const o = grid.get(`${i + di},${j + dj}`);
            if (!o) continue;
            for (const a of l)
              for (const b of o) {
                if (a === b || Math.hypot(a.x - b.x, a.z - b.z) >= LOOK_TWIN_M) continue;
                pairs++;
                expect(
                  a.look === b.look,
                  `twins at t=${t} (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`,
                ).toBe(false);
              }
          }
      }
    }
    // The check is not vacuous: many people pass within 10 m of each other.
    expect(pairs).toBeGreaterThan(1000);
  });

  it("P7: >= 95% of sampled positions over 60 s within 1.5 m of a walk edge; none in a footprint or water", () => {
    const pose = { x: 0, z: 0, yaw: 0 };
    let n = 0;
    let onWalk = 0;
    const inside: string[] = [];
    for (const { agent } of local)
      for (let t = 0; t <= 60; t += 1) {
        poseAt(agent, t, pose);
        n++;
        if (c.ribbonGap(pose.x, pose.z) <= 1.5) onWalk++;
        if (c.inObstacle(pose.x, pose.z)) inside.push(`${agent.id}@${t}`);
      }
    expect(n).toBeGreaterThan(5000);
    expect(onWalk / n).toBeGreaterThanOrEqual(0.95);
    expect(inside).toEqual([]);
  });

  it("A-T12: pavements put >= 6 people within 100 m of the street bookmark, and >= 3 tall enough on screen", () => {
    const [tx, tz] = c.frame.toLocal(STREET.centre[0], STREET.centre[1]);
    const h = (STREET.headingDeg * Math.PI) / 180;
    // Heading 0 faces north (-z), 90 east (+x): forward (sin h, -cos h). Camera 30 m behind the target.
    const pitch = (STREET.pitchDeg * Math.PI) / 180;
    const back = STREET.rangeM * Math.cos(pitch);
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const cx = tx - fx * back;
    const cz = tz - fz * back;
    const street = c.dress(c.plan([tileAt(tx, tz)], DAY));
    // The layer thins a peak-density plan by mood; planned with day weights, this is the day crowd.
    const hfov = 2 * Math.atan(Math.tan((VFOV_DEG * Math.PI) / 360) * (1440 / 900));
    const pose = { x: 0, z: 0, yaw: 0 };
    let worstNear = Infinity;
    let worstShown = Infinity;
    for (let t = 0; t <= 120; t += 5) {
      let within = 0;
      let shown = 0;
      for (const { agent, look } of street) {
        poseAt(agent, t, pose);
        if (Math.hypot(pose.x - tx, pose.z - tz) <= 100) within++;
        // Pixel proxy (occlusion is the gate's GPU check): in the view cone, head-to-feet px at 900 px.
        const dx = pose.x - cx;
        const dz = pose.z - cz;
        const along = dx * fx + dz * fz;
        if (along <= 1) continue;
        const across = dx * fz - dz * fx;
        if (Math.abs(Math.atan2(across, along)) > hfov / 2) continue;
        const d = Math.hypot(dx, dz, 3);
        const tall = c.crowd.bodies[c.crowd.looks[look]!.body].height * peopleScale(d);
        const px = (tall * 900) / (2 * d * Math.tan((VFOV_DEG * Math.PI) / 360));
        if (px >= 30) shown++;
      }
      worstNear = Math.min(worstNear, within);
      worstShown = Math.min(worstShown, shown);
    }
    expect(worstNear).toBeGreaterThanOrEqual(6);
    expect(worstShown).toBeGreaterThanOrEqual(3);
    expect(peopleScale(30)).toBe(PEOPLE_SCALE_NEAR);
  });

  it("spawn floor: >= 1 person per 40 m of street in each route tile at day density", () => {
    let checked = 0;
    for (const tile of routeTiles(c)) {
      const day = c.planTile(tile, 0, DAY).filter((a) => a.kind === "person");
      let streetM = 0;
      for (const f of (
        c.walk as {
          features: {
            properties: { type: string };
            geometry: { type: string; coordinates: [number, number][] };
          }[];
        }
      ).features) {
        if (f.properties.type !== "street" && f.properties.type !== "major_road") continue;
        const pts = f.geometry.coordinates.map(([lon, lat]) => c.frame.toLocal(lon, lat));
        for (let i = 0; i < pts.length - 1; i++) {
          const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
          const mz = (pts[i]![1] + pts[i + 1]![1]) / 2;
          if (mx >= tile.box.x0 && mx < tile.box.x1 && mz >= tile.box.z0 && mz < tile.box.z1)
            streetM += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
        }
      }
      // Tiles with only a stub of street (cut by the boundary) are not a street scene.
      if (streetM < 400) continue;
      checked++;
      // 10% slack: street chunks lost to the boundary or to footprints on both sides.
      expect(day.length, tile.key).toBeGreaterThanOrEqual(Math.floor((0.9 * streetM) / 40));
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
