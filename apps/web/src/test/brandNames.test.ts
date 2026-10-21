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
 * Matching rule (identifier-aware, so an unrelated word containing a name is judged sensibly),
 * case-insensitive, three kinds of name:
 * - brand names that are no English word (myvi, bezza, perodua, toyota, hilux, yamaha, honda,
 *   proton) are hits as a plain substring anywhere: `toyotavios`, `honda2`, `protonx50`,
 *   `hondaex5`, `"variant_proton": 1`. (So `protonate` is a hit too: no such word is used here.)
 * - model codes (x50, ex5, y15) are hits as a substring not touching another digit: `protonx50`,
 *   `EX5`, `y15_rider` hit; `x500`, `0x50` (hex), `1y15` do not.
 * - names that are also parts of ordinary words (saga, axia, alza, vios, persona) are matched by
 *   identifier token: text is split into runs of letters and digits, then camelCase / PascalCase
 *   parts (`MyviHatch` -> myvi, hatch; `SAGA2` stays saga2); a token whose trailing digits are
 *   stripped equals the name or its plural (+ "s"). So `vios2`, `SAGA2`, `axia1`, `AlzaMpv` and
 *   `"vios": 1` hit, while `sagacious`, `axial`, `obvious`, `alzado` and `personAt` do not. Limit:
 *   such a name glued in lower case to another word (`viosmini`) is not seen; substring matching
 *   would flag ordinary English instead.
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
const SUBSTRING = new Set([
  "myvi",
  "bezza",
  "perodua",
  "toyota",
  "hilux",
  "yamaha",
  "honda",
  "proton",
]);
/** Model codes: a substring not touching another digit. */
const CODES = new Set(["x50", "ex5", "y15"]);
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
  const bare = toks.map((t) => t.replace(/\d+$/, ""));
  for (const name of BANNED) {
    if (VEHICLE_ONLY.has(name) && !ctx) continue;
    if (SUBSTRING.has(name)) {
      if (lower.includes(name)) hits.add(name);
    } else if (CODES.has(name)) {
      if (new RegExp(`(?<![0-9])${name}(?![0-9])`).test(lower)) hits.add(name);
    } else if (bare.some((t) => t === name || t === `${name}s`)) hits.add(name);
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
    // unrelated words that contain a word-like name are no hit
    expect(bannedIn("const personAt = sagacious + axial + obvious + alzado", false)).toEqual([]);
    expect(bannedIn("hondas", false)).toEqual(["honda"]);
    // review fix round 1: digit suffixes and lower-case concatenations
    for (const [text, want] of [
      ["vios2", ["vios"]],
      ["honda2", ["honda"]],
      ["SAGA2", ["saga"]],
      ["axia1", ["axia"]],
      ["proton2", ["proton"]],
      ["protonx50", ["proton", "x50"]],
      ["hondaex5", ["honda", "ex5"]],
      ["AlzaMpv", ["alza"]],
      ["y15_rider", ["y15"]],
    ] as const)
      expect(bannedIn(text, false).sort(), text).toEqual([...want].sort());
    // model codes never inside a longer number (hex, sizes)
    expect(bannedIn("const c = 0x50; const w = x500; id1y15", false)).toEqual([]);
    // JSON keys and values
    expect(bannedIn('{ "vios": 1, "colour": "white" }', false)).toEqual(["vios"]);
    expect(bannedIn('  "variant_proton_saga": { "size": [1.7, 1.5, 4.3] },', false).sort()).toEqual(
      ["proton", "saga"],
    );
    expect(bannedIn('"kits": { "kapchai_ex5": {} }', false)).toEqual(["ex5"]);
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
