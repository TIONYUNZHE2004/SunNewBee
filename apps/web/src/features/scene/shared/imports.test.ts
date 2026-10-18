import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const threeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "three");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Three.js scene isolation", () => {
  it("no file under scene/three/ imports from cesium/stylised/", () => {
    const files = sourceFiles(threeDir).filter((f) => !/imports\.test\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /cesium\/stylised\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
