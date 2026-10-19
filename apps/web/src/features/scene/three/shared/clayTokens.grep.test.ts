import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AC-B1 grep test: layer code takes its colours from the clay token table (`shared/clayTokens.ts`).
 * No hex colour literal ("#rgb", "#rrggbb", "#rrggbbaa" in a string, or a 0xrrggbb number) may
 * appear in a stylised-city source file outside the token table, comments excluded.
 */

const here = dirname(fileURLToPath(import.meta.url));
const threeDir = join(here, "..");
const journeyThreeDir = join(here, "..", "..", "..", "journey", "three");

/**
 * Files allowed to hold colour literals, and why. None of them is a clay surface:
 *  - lighting.ts: sun, hemisphere, sky and fog colours per mood (lights, not materials);
 *  - overlays/markers.ts: place / waste marker colours, DATA legend colours (honesty module);
 *  - overlays/residents.ts: the resident overlay's outline and ring (overlay, not the city);
 *  - journey/three/journeyLayer.ts: journey route casing and event marker colours (route / DATA).
 * Flood, status and route colours live in `features/scene/styles.ts` (outside this scan).
 */
const COLOUR_LITERAL_ALLOW = [
  "lighting.ts",
  "overlays/markers.ts",
  "overlays/residents.ts",
  "journey/three/journeyLayer.ts",
] as const;

/**
 * Decorative randomisers that pick from token palettes (allow-listed readers): they import a
 * CLAY_PALETTE list and choose by hash, never a literal. The test checks they read the table.
 */
const TOKEN_RANDOMISERS = [
  "fallbackStyle.ts", // BLOCK_WALLS by hash01(id, "wall:variant")
  "facade/roofPlan.ts", // ROOF_TINTS by hash01(id, "roof:tint")
  "facade/roofLayer.ts", // roof-unit grey jitter
  "assets/fit.ts", // archetype palette fallback
] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

const LITERAL =
  /["'`]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})["'`]|\b0x[0-9a-fA-F]{6}\b/g;

function colourLiterals(text: string): string[] {
  return [...stripComments(text).matchAll(LITERAL)].map((m) => m[0]);
}

const rel = (p: string) => {
  const r = relative(threeDir, p).replaceAll("\\", "/");
  return r.startsWith("..") ? relative(join(threeDir, "..", ".."), p).replaceAll("\\", "/") : r;
};

describe("AC-B1: no ad-hoc colours in layer code", () => {
  it("the scanner finds string and 0x literals and ignores comments", () => {
    expect(colourLiterals("const a = \"#abc\"; const b = '#a1b2c3'; const c = 0xff00aa;")).toEqual([
      '"#abc"',
      "'#a1b2c3'",
      "0xff00aa",
    ]);
    expect(colourLiterals('/* "#ffffff" */\n// "#000000"\nconst x = 1; // "#123456"')).toEqual([]);
    expect(colourLiterals("const hash = 0x9e3779b9; const m = 0xff;")).toEqual([]);
  });

  it("every layer file outside the token table and the allow-list is free of colour literals", () => {
    const files = [...sourceFiles(threeDir), ...sourceFiles(journeyThreeDir)];
    expect(files.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (r === "shared/clayTokens.ts") continue;
      if ((COLOUR_LITERAL_ALLOW as readonly string[]).includes(r)) continue;
      for (const lit of colourLiterals(readFileSync(f, "utf8"))) bad.push(`${r}: ${lit}`);
    }
    expect(bad).toEqual([]);
  });

  it("the allow-list stays honest: every entry exists and still needs its exemption", () => {
    for (const r of COLOUR_LITERAL_ALLOW) {
      const path = r.startsWith("journey/")
        ? join(threeDir, "..", "..", r)
        : join(threeDir, ...r.split("/"));
      expect(colourLiterals(readFileSync(path, "utf8")).length, r).toBeGreaterThan(0);
    }
  });

  it("the decorative randomisers read the token table", () => {
    for (const r of TOKEN_RANDOMISERS) {
      const text = readFileSync(join(threeDir, ...r.split("/")), "utf8");
      expect(text, r).toMatch(/from "\.\.?\/(\.\.\/)?shared\/clayTokens"/);
      expect(colourLiterals(text), r).toEqual([]);
    }
  });

  it("surface layers build their materials through the clay factory", () => {
    for (const r of [
      "assets/roleMaterial.ts",
      "ground/bands.ts",
      "ground/slab.ts",
      "facade/roofLayer.ts",
      "signs/signLayer.ts",
      "engine.ts",
    ]) {
      const code = stripComments(readFileSync(join(threeDir, ...r.split("/")), "utf8"));
      expect(code, r).toContain("clayMaterial(");
      expect(code, r).not.toMatch(/new THREE\.Mesh(Standard|Physical|Lambert|Phong)Material\(/);
    }
  });
});
