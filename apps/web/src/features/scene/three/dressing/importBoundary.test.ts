import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AC-B8 import boundary: decorative street dressing never reaches a JourneyPlan or an event. No
 * journey module (`features/journey/**`, `features/scene/three/journey/**`) imports the dressing
 * modules (`features/scene/three/dressing/**`, `scene/useDressing.ts`), directly or through any
 * chain of relative imports. The dressing modules import nothing from the journey directly either.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "..", "..", "..");
const JOURNEY_DIRS = [
  join(src, "features", "journey"),
  join(src, "features", "scene", "three", "journey"),
];
const DRESSING = [
  join(src, "features", "scene", "three", "dressing"),
  join(src, "features", "scene", "three", "scene", "useDressing.ts"),
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
const norm = (p: string) => p.replaceAll("\\", "/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function resolveRel(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Relative imports of a file (comments stripped), resolved to files. */
function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(SPECIFIER)]
    .map((m) => m[1] as string)
    .filter((s) => s.startsWith("."))
    .map((s) => resolveRel(file, s))
    .filter((f): f is string => f !== null);
}

const isDressing = (f: string) =>
  DRESSING.some((d) => norm(f) === norm(d) || norm(f).startsWith(`${norm(d)}/`));
const isJourney = (f: string) => JOURNEY_DIRS.some((d) => norm(f).startsWith(`${norm(d)}/`));

/** Every file reachable from `roots`, with the chain that reached it. */
function reach(roots: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const stack: [string, string[]][] = roots.map((r) => [r, [r]]);
  while (stack.length) {
    const [f, chain] = stack.pop()!;
    if (seen.has(f)) continue;
    seen.set(f, chain);
    for (const g of importsOf(f)) if (!seen.has(g)) stack.push([g, [...chain, g]]);
  }
  return seen;
}

describe("AC-B8: journey modules never import the dressing modules", () => {
  const journey = JOURNEY_DIRS.flatMap(sourceFiles);
  const dressing = DRESSING.flatMap((d) => (statSync(d).isDirectory() ? sourceFiles(d) : [d]));

  it("finds both module sets", () => {
    expect(journey.length).toBeGreaterThan(10);
    expect(dressing.length).toBeGreaterThanOrEqual(4);
  });

  it("no journey module reaches a dressing module through relative imports", () => {
    const offenders = [...reach(journey)]
      .filter(([f]) => isDressing(f))
      .map(([, chain]) => chain.map((c) => norm(c).replace(`${norm(src)}/`, "")).join(" -> "));
    expect(offenders).toEqual([]);
  });

  it("no dressing module imports a journey module directly", () => {
    const offenders = dressing.flatMap((f) =>
      importsOf(f)
        .filter(isJourney)
        .map((g) => `${norm(f)} -> ${norm(g)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the scanner sees a planted import", () => {
    const fake = join(JOURNEY_DIRS[0]!, "x.ts");
    const spec = ["..", "scene", "three", "dressing", "dressingPlan"].join("/");
    expect(resolveRel(fake, spec)).not.toBeNull();
    expect(isDressing(resolveRel(fake, spec)!)).toBe(true);
  });
});
