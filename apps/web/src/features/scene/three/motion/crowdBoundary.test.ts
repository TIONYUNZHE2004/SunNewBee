import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P9 (C-T8): the crowd is decorative only. Crowd modules never import journey code (events, plan,
 * timeline, cards), not even transitively; the journey plan schema never references crowd agents;
 * the hero side never reads the crowd (so the crowd can never stop her, P8); crowd figures sit under
 * the "Decorative details are illustrative." note.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = normalize(join(HERE, "../../../.."));
const rel = (f: string) => relative(SRC, f).replaceAll("\\", "/");

const IMPORT_RE =
  /(import|export)\s+(type\s)?[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // packages (three, zustand, @tl/api-client) are leaves
  const base = normalize(join(dirname(from), spec));
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ])
    if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  return null; // json and assets
}

/**
 * Every source file reachable from `entries` through relative imports. `runtime`: only imports that
 * survive compilation (`import type` / `export type` are erased and not followed).
 */
function closure(entries: string[], runtime = false): Set<string> {
  const seen = new Set<string>();
  const todo = [...entries];
  while (todo.length) {
    const f = todo.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      if (runtime && m[2]) continue;
      const r = resolve(f, (m[3] ?? m[4]) as string);
      if (r && !seen.has(r)) todo.push(r);
    }
  }
  return seen;
}

const CROWD = [
  "agents.ts",
  "crowdBake.ts",
  "crowdGait.ts",
  "crowdKit.ts",
  "crowdRenderer.ts",
  "crowdRules.ts",
  "motionLayer.ts",
  "motionClock.ts",
].map((f) => join(HERE, f));

const isJourney = (f: string) => {
  const r = rel(f);
  return r.startsWith("features/journey/") || r.startsWith("features/scene/three/journey/");
};

describe("P9: the crowd is decorative only", () => {
  it("crowd modules never import journey code: not directly (types included), not at runtime transitively", () => {
    // Direct imports of every kind, types included.
    for (const f of CROWD) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(IMPORT_RE)) {
        const r = resolve(f, (m[3] ?? m[4]) as string);
        if (r) expect(isJourney(r), `${rel(f)} imports ${rel(r)}`).toBe(false);
        expect(m[3] ?? m[4], rel(f)).not.toMatch(/journey|timeline|cardContent/);
      }
    }
    // Everything the crowd loads at runtime.
    const reach = [...closure(CROWD, true)].map(rel);
    expect(reach.length).toBeGreaterThan(CROWD.length);
    expect(reach.filter((f) => isJourney(join(SRC, f)))).toEqual([]);
    for (const f of reach) expect(f).not.toMatch(/timeline|cardContent|journeyStore|heroDriver/);
  });

  it("crowd sources never name JourneyPlan, journey events or the journey store", () => {
    for (const f of CROWD) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/\bJourneyPlan\b|\bJourneyEvent\b|useJourney|journeyHero/);
    }
  });

  it("JourneyPlan and JourneyEvent (API schema) never reference crowd agents", () => {
    const api = JSON.parse(
      readFileSync(join(SRC, "../../../packages/api-client/openapi.json"), "utf8"),
    ) as { components: { schemas: Record<string, unknown> } };
    for (const name of ["JourneyPlan", "JourneyEvent"]) {
      const schema = api.components.schemas[name];
      expect(schema, name).toBeTruthy();
      expect(JSON.stringify(schema)).not.toMatch(/crowd|agent|pedestrian|look_id|decorative/i);
    }
    const timeline = readFileSync(join(SRC, "features/journey/timeline.ts"), "utf8");
    const cards = readFileSync(join(SRC, "features/journey/cardContent.ts"), "utf8");
    for (const src of [timeline, cards]) expect(src).not.toMatch(/crowd|motion\//i);
  });

  it("the hero side never reads the crowd, so the crowd cannot stop her (P8)", () => {
    const hero = [
      "features/journey/timeline.ts",
      "features/journey/journeyStore.ts",
      "features/journey/useJourneyDriver.ts",
      "features/journey/JourneyMount.tsx",
      "features/journey/three/heroLayer.ts",
      "features/scene/three/journey/heroDriver.ts",
    ].map((f) => join(SRC, f));
    // What the hero code loads at runtime (type-only imports, e.g. the Engine type, are erased).
    const reach = [...closure(hero, true)].map(rel);
    // Shared maths (smoothYaw) and the lift constant are fine; the crowd's state never is.
    for (const f of reach)
      expect(f).not.toMatch(
        /motion\/(crowdRules|crowdRenderer|crowdKit|crowdBake|crowdGait)\b|useMotion/,
      );
    for (const f of reach.filter((r) => isJourney(join(SRC, r)))) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src, f).not.toMatch(/createMotionLayer|planAgents|keepOut|assignLooks/);
    }
  });

  it("crowd figures sit under the decorative note", () => {
    const crowd = JSON.parse(
      readFileSync(join(SRC, "../public/city/characters/crowd.json"), "utf8"),
    ) as { decorative: boolean; note: string };
    expect(crowd.decorative).toBe(true);
    expect(crowd.note).toBe("Decorative details are illustrative.");
    // The chip shows whenever agents (people included) are planned.
    const scene = readFileSync(join(SRC, "features/scene/three/ThreeScene.tsx"), "utf8");
    expect(scene).toContain('DECORATIVE_NOTE = "Decorative details are illustrative."');
    expect(scene).toMatch(/agents\.length > 0 \|\|/);
    // The crowd's meshes are tagged decorative (crowdRenderer) and the layer group too.
    const renderer = readFileSync(join(HERE, "crowdRenderer.ts"), "utf8");
    expect(renderer).toContain("group.userData.decorative = true");
    expect(renderer).toContain("bm.userData.decorative = true");
  });
});
