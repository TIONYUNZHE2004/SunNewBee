import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { parseManifest } from "../assets/manifest";
import { HERO_CENTRE } from "../bookmarks";
import { createFrame } from "../frame";
import { boundaryOf } from "../ground/boundary";
import { clipLayer, clipWalk } from "../ground/clipLayer";
import { planAgents } from "../motion/agents";
import { seedFor } from "./area";
import { tileCap } from "./caps";
import { planTile, type TileInputs, warmPlanners } from "./tilePlan";
import { tileAt, tileOf } from "./tiles";

/**
 * Worker plan time per tile (demo polish A1: the junction-graph walks must keep a tile within the
 * 8 ms hitch budget of `caps.ts`). Plans the 5 x 5 hero-district tiles at Medium, ring 0 (the
 * densest case), after `warmPlanners`, three times each, and logs the median and p95 of `planTile`
 * and of `planAgents` alone. Wall-clock timing on a shared machine is noisy, so the budget is
 * asserted only with PERF_STRICT=1 (on the reference laptop, nothing else running); by default the
 * test only logs the numbers.
 */
const SEED = (p: string) => new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url);
const HAVE_SEED =
  existsSync(SEED("base/walk.geojson")) && existsSync(SEED("base/boundary.geojson"));
const BUDGET_MS = 8;

const stats = (l: number[]) => {
  const s = [...l].sort((a, b) => a - b);
  return {
    median: s[Math.floor(s.length / 2)] as number,
    p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] as number,
  };
};

describe.skipIf(!HAVE_SEED)("plan time per tile (Elmina seed, Medium, ring 0)", () => {
  it(`median planTile <= ${BUDGET_MS} ms over the hero district`, () => {
    const seed = (p: string) => JSON.parse(readFileSync(SEED(p), "utf8"));
    const site = seed("site.json");
    const frame = createFrame(site.center);
    const b = boundaryOf(seed("base/boundary.geojson").features[0].geometry, frame)!;
    const polygonsOnly = (x: { features: { geometry: { type: string } }[] }) => ({
      type: "FeatureCollection",
      features: x.features.filter((g) => g.geometry.type === "Polygon"),
    });
    const raw = {
      buildings: seed("base/buildings.geojson"),
      trees: seed("base/trees.geojson"),
      water: polygonsOnly(seed("base/hydrology.geojson")),
      parks: polygonsOnly(seed("base/parks.geojson")),
      landcover: seed("base/landcover.geojson"),
      signage: seed("base/signage.geojson"),
      landmarks: seed("base/landmarks.geojson"),
      as_of: null,
      attribution: [],
    } as unknown as BuildingsLayer;
    const layer = clipLayer(raw, b, frame).layer;
    const access = {
      type: "FeatureCollection",
      features: [...seed("base/walk.geojson").features, ...seed("base/places.geojson").features],
    };
    const walk = clipWalk(access, b, frame);
    const manifest = parseManifest(
      JSON.parse(
        readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
      ),
    ).manifest!;
    const inputs: TileInputs = {
      frame,
      walk,
      buildings: layer,
      manifest,
      facades: null,
      boundary: b,
    };
    warmPlanners(inputs);
    const [hx, hz] = frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]);
    const c = tileAt(hx, hz);
    const ci = Math.floor(c.box.x0 / (c.box.x1 - c.box.x0));
    const cj = Math.floor(c.box.z0 / (c.box.z1 - c.box.z0));
    const tiles = [];
    for (let di = -2; di <= 2; di++)
      for (let dj = -2; dj <= 2; dj++) tiles.push(tileOf(ci + di, cj + dj));
    const tileMs: number[] = [];
    const agentMs: number[] = [];
    let agents = 0;
    for (let rep = 0; rep < 3; rep++)
      for (const t of tiles) {
        const t0 = performance.now();
        const content = planTile(inputs, t, 0, "medium");
        tileMs.push(performance.now() - t0);
        if (rep === 0) agents += content.agents.length;
        const t1 = performance.now();
        planAgents({
          walk,
          places: walk,
          frame,
          area: { box: t.box, seed: seedFor(t.key, "motion") },
          tier: "medium",
          caps: {
            vehicles: tileCap("medium", 0, "vehicles", t, frame),
            people: tileCap("medium", 0, "people", t, frame),
          },
          m: manifest,
          boundary: b,
          obstacles: { buildings: layer.buildings, water: layer.water },
          floorPerM: 1 / 40,
        });
        agentMs.push(performance.now() - t1);
      }
    const tile = stats(tileMs);
    const ag = stats(agentMs);
    console.info(
      `[A1 plan time] ${tiles.length} hero tiles x 3, Medium ring 0, ${agents} agents: planTile median ${tile.median.toFixed(2)} ms, p95 ${tile.p95.toFixed(2)} ms; planAgents median ${ag.median.toFixed(2)} ms, p95 ${ag.p95.toFixed(2)} ms`,
    );
    expect(agents).toBeGreaterThan(100);
    // wall-clock time under a shared, loaded machine is noise: the budget is asserted on demand
    if (process.env.PERF_STRICT === "1") expect(tile.median).toBeLessThanOrEqual(BUDGET_MS);
  }, 120_000);
});
