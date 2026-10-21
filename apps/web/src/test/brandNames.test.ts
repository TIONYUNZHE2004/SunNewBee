import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AC-L7, web half (demo polish A4w): no car or motorcycle brand or model name in the city kit
 * manifests (`public/city/**\/manifest.json`, the vehicles variant ids included) or in the web source
 * (`src/**`). The Python half (`assets/blender/tests/test_brand_names.py`) scans the asset scripts,
 * specs and glbs. Docs and the spec are not scanned.
 *
 * Matching rule (identifier-aware, so an unrelated word containing a name is judged sensibly):
 * - text is split into identifier tokens: runs of letters and digits, then camelCase / PascalCase
 *   parts (`MyviHatch` -> myvi, hatch; `EX5` stays ex5; `x50` stays x50). A token that equals a
 *   banned name, or its plural (+ "s"), is a hit. So `personAt` (person, at) is no hit, `vios` is.
 * - the long names that are no English word (myvi, bezza, perodua, toyota, hilux, yamaha) are also
 *   hits as a plain substring anywhere (`toyotavios`).
 * - coordinator ruling R13 for "persona": banned as a vehicle name only. It is scanned in the
 *   manifests, in the motion and ground code (`scene/three/motion/**`, `scene/three/ground/**`,
 *   where the vehicle variants and parked cars live) and on any source line that talks about
 *   vehicles (car, vehicle, moped, bike, lorry, bus, traffic ...: vehicle UI copy and kit ids).
 *   Elsewhere the ordinary English word "persona" (a resident profile) is allowed.
 * This file itself is skipped (it holds the list).
 */
const BANNED = [
  "myvi",
  "axia",
  "bezza",
  "saga",
  "alza",
  "vios",
  "hilux",
  "persona",
  "x50",
  "proton",
  "perodua",
  "toyota",
  "honda",
  "yamaha",
  "ex5",
  "y15",
] as const;
const SUBSTRING = new Set(["myvi", "bezza", "perodua", "toyota", "hilux", "yamaha"]);
/** R13: banned only in a vehicle context. */
const VEHICLE_ONLY = new Set(["persona"]);
const VEHICLE_WORDS =
  /\b(cars?|vehicles?|moped|motorcycles?|motorbikes?|scooters?|kapchai|bikes?|bicycles?|cyclists?|lorr(y|ies)|bus(es)?|trucks?|vans?|traffic|hatch(back)?|sedan|mpv|pickup|delivery_moto|compact_hatch|micro_hatch|small_sedan)\b/i;

const tokensOf = (text: string): string[] => {
  const out: string[] = [];
  for (const run of text.match(/[A-Za-z0-9]+/g) ?? [])
    for (const part of run.match(/[A-Z]+(?![a-z])\d*|[A-Z]?[a-z]+\d*|\d+/g) ?? [])
      out.push(part.toLowerCase());
  return out;
};

/** The banned names in one line of text; `vehicleContext` also bans the R13 names. */
function bannedIn(line: string, vehicleContext: boolean): string[] {
  const ctx = vehicleContext || VEHICLE_WORDS.test(line);
  const hits = new Set<string>();
  const toks = tokensOf(line);
  const lower = line.toLowerCase();
  for (const name of BANNED) {
    if (VEHICLE_ONLY.has(name) && !ctx) continue;
    if (toks.some((t) => t === name || t === `${name}s`)) hits.add(name);
    else if (SUBSTRING.has(name) && lower.includes(name)) hits.add(name);
  }
  return [...hits];
}

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(WEB, "src");
const CITY = join(WEB, "public", "city");
const SELF = fileURLToPath(import.meta.url);
const TEXT = /\.(ts|tsx|js|mjs|json|css|html|md)$/;

function walk(dir: string, keep: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

const strictPath = (p: string) => {
  const r = relative(WEB, p).split(sep).join("/");
  return (
    r.startsWith("public/") ||
    r.startsWith("src/features/scene/three/motion/") ||
    r.startsWith("src/features/scene/three/ground/")
  );
};

function scan(files: string[]): string[] {
  const found: string[] = [];
  for (const f of files) {
    if (f === SELF) continue;
    const strict = strictPath(f);
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const name of bannedIn(line, strict))
          found.push(`${relative(WEB, f)}:${i + 1}: ${name}`);
      });
  }
  return found;
}

describe("AC-L7: no brand or model names (web half)", () => {
  it("the matching rule: tokens, plurals, substrings and ruling R13", () => {
    expect(bannedIn("const v = 'MyviHatch';", false)).toEqual(["myvi"]);
    expect(bannedIn("toyotavios", false)).toEqual(["toyota"]);
    expect(bannedIn("two Vios and an EX5", false).sort()).toEqual(["ex5", "vios"]);
    expect(bannedIn("variant: y15_rider", false)).toEqual(["y15"]);
    expect(bannedIn("SAGA", false)).toEqual(["saga"]);
    // unrelated words that contain a name are no hit
    expect(bannedIn("const personAt = sagacious + protonate + alzado", false)).toEqual([]);
    expect(bannedIn("hondas", false)).toEqual(["honda"]);
    // R13: the English word persona is allowed, except about vehicles or in the strict scope
    expect(bannedIn("/** The persona the trip was planned for */", false)).toEqual([]);
    expect(bannedIn('vehicles: { persona: "x" }', false)).toEqual(["persona"]);
    expect(bannedIn("const persona = 1;", true)).toEqual(["persona"]);
  });

  it("city manifests (and the vehicles variant ids) carry none", () => {
    const manifests = walk(CITY, (p) => p.endsWith("manifest.json"));
    expect(manifests.length).toBeGreaterThanOrEqual(2);
    expect(scan(manifests)).toEqual([]);
    const m = JSON.parse(readFileSync(join(CITY, "manifest.json"), "utf8"));
    const ids = Object.keys(m.assets.vehicles.variants);
    expect(ids).toContain("compact_hatch");
    for (const id of ids) expect(bannedIn(id, true), id).toEqual([]);
  });

  it("the web source carries none", () => {
    const files = walk(SRC, (p) => TEXT.test(p));
    expect(files.length).toBeGreaterThan(300);
    expect(scan(files)).toEqual([]);
  });

  it("would catch a planted name (the scan is not vacuous)", () => {
    expect(bannedIn('export const VARIANTS = ["compact_hatch", "bezza"];', true)).toEqual([
      "bezza",
    ]);
    expect(bannedIn('label: "Kapchai (Honda EX5 style)"', false).sort()).toEqual(["ex5", "honda"]);
  });
});
