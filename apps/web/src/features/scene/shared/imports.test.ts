import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Module specifiers of static imports/re-exports (`from "…"`), side-effect imports
// (`import "…"`) and dynamic imports (`import("…")`). Comments are stripped first.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
const RETIRED = /(^|\/)features\/scene\/cesium\/stylised(\/|$)/;

/** Specifiers in `file` that resolve into the retired `features/scene/cesium/stylised` folder. */
function retiredImports(file: string, text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(SPECIFIER)]
    .map((m) => m[1] as string)
    .filter((spec) => {
      const target = spec.startsWith(".") ? resolve(dirname(file), spec) : spec;
      return RETIRED.test(target.replaceAll("\\", "/")) || /cesium\/stylised(\/|$)/.test(spec);
    });
}

describe("Cesium Stylised is retired", () => {
  it("the specifier scan catches relative, index and dynamic imports but not comments", () => {
    const f = join(srcDir, "features", "scene", "cesium", "CesiumScene.tsx");
    const retired = ["cesium", "stylised"].join("/"); // keeps this file out of its own scan
    const text = [
      'import { a } from "./stylised/palette";',
      'export { b } from "./stylised";',
      `const c = lazy(() => import("../scene/${retired}/StylisedPreview"));`,
      '// import { d } from "./stylised/old";',
      '/* import { e } from "./stylised/old"; */',
      'import { homeView } from "./home";',
    ].join("\n");
    expect(retiredImports(f, text)).toEqual([
      "./stylised/palette",
      "./stylised",
      `../scene/${retired}/StylisedPreview`,
    ]);
  });

  it("no file under src/ (features/ and app/) imports from cesium/stylised", () => {
    const files = sourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((f) =>
      retiredImports(f, readFileSync(f, "utf8")).map((s) => `${f}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
