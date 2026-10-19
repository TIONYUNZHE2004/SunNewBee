import { clayPalette } from "../shared/clayTokens";

export const ROLES = [
  "primary",
  "secondary",
  "accent",
  "glass",
  "dark",
  "metal",
  "foliage",
  "light",
] as const;

export interface LodSpec {
  node: string;
  tris: number;
  maxM: number | null;
}
export interface VariantSpec {
  size: [number, number, number];
  lods: LodSpec[];
}
export interface AssetSpec {
  group: "archetype" | "landmark" | "kit";
  file: string;
  bytes: number;
  repeat: "none" | "frontage";
  frontage: "short" | "long";
  fit: { xz: [number, number]; y: [number, number] };
  decorative: boolean;
  placement: "anchor" | "obb" | "deferred" | null;
  jitter: { scale?: number; hue?: number };
  variantByGroup: Record<string, string>;
  palettes: Record<string, [string, string, string][]>;
  variants: Record<string, VariantSpec>;
  /** Landmarks drawn at a design height (not an OSM one): storeys in the developer's design. */
  designStoreys?: number;
  /** Where a landmark's height comes from, e.g. "design height (36 storeys, Sime Darby Property), under construction; ...". */
  heightBasis?: string;
}
export interface Manifest {
  version: 1;
  as_of: string;
  precinctGroups: [string, string][];
  assets: Record<string, AssetSpec>;
  landmarks: Record<string, { anchor: [number, number] }>;
}

export const MANIFEST_URL = "/city/manifest.json";

const HEX = /^#[0-9a-fA-F]{6}$/;

class Bad extends Error {}
function need(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Bad(what);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNumTuple = (v: unknown, n: number): boolean =>
  Array.isArray(v) && v.length === n && v.every(isNum);
const oneOf = (v: unknown, opts: readonly string[]): boolean => isStr(v) && opts.includes(v);

function parseAsset(a: unknown, id = ""): AssetSpec {
  need(isObj(a), "not an object");
  need(oneOf(a.group, ["archetype", "landmark", "kit"]), "group");
  need(isStr(a.file) && a.file.length > 0, "file");
  need(isNum(a.bytes), "bytes");
  need(oneOf(a.repeat, ["none", "frontage"]), "repeat");
  need(oneOf(a.frontage, ["short", "long"]), "frontage");
  need(isObj(a.fit) && isNumTuple(a.fit.xz, 2) && isNumTuple(a.fit.y, 2), "fit");
  need(typeof a.decorative === "boolean", "decorative");
  need(a.placement === null || oneOf(a.placement, ["anchor", "obb", "deferred"]), "placement");
  need(isObj(a.jitter), "jitter");
  need(isObj(a.variantByGroup) && Object.values(a.variantByGroup).every(isStr), "variantByGroup");
  need(isObj(a.palettes), "palettes");
  for (const [g, list] of Object.entries(a.palettes)) {
    need(Array.isArray(list), `palette ${g}`);
    for (const t of list)
      need(
        Array.isArray(t) && t.length === 3 && t.every((c) => isStr(c) && HEX.test(c)),
        `palette ${g} colour`,
      );
  }
  need(isObj(a.variants), "variants");
  const entries = Object.entries(a.variants);
  need(entries.length > 0, "no variants");
  for (const [v, spec] of entries) {
    need(isObj(spec) && isNumTuple(spec.size, 3), `variant ${v} size`);
    need(Array.isArray(spec.lods) && spec.lods.length > 0, `variant ${v} lods`);
    for (const l of spec.lods as unknown[])
      need(
        isObj(l) && isStr(l.node) && isNum(l.tris) && (l.maxM === null || isNum(l.maxM)),
        `variant ${v} lod`,
      );
  }
  need(
    a.designStoreys === undefined ||
      (isNum(a.designStoreys) && a.designStoreys > 0 && Number.isInteger(a.designStoreys)),
    "designStoreys",
  );
  need(
    a.heightBasis === undefined || (isStr(a.heightBasis) && a.heightBasis.trim() !== ""),
    "heightBasis",
  );
  // B-T1: every loaded palette goes through the clay token table (luminance floor, pastel
  // lightness, water guard, clay trunk); the raw manifest stays the source file.
  const palettes: Record<string, [string, string, string][]> = {};
  for (const [g, list] of Object.entries(a.palettes as Record<string, [string, string, string][]>))
    palettes[g] = list.map((t) => clayPalette(t, id));
  return { ...a, palettes } as unknown as AssetSpec;
}

/** Validates shape and version; drops (and reports) malformed assets instead of throwing on one bad entry. */
export function parseManifest(json: unknown): { manifest: Manifest | null; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(json)) return { manifest: null, problems: ["manifest is not an object"] };
  if (json.version !== 1)
    return { manifest: null, problems: [`unsupported version ${String(json.version)}`] };
  // COLOR_0.g encodes the role index, so a different role order would recolour every asset.
  if (
    "roles" in json &&
    !(
      Array.isArray(json.roles) &&
      json.roles.length === ROLES.length &&
      json.roles.every((r, i) => r === ROLES[i])
    )
  )
    return {
      manifest: null,
      problems: [`roles ${JSON.stringify(json.roles)} differ from ${ROLES.join(",")}`],
    };
  if (!isObj(json.assets)) return { manifest: null, problems: ["assets missing"] };

  const assets: Record<string, AssetSpec> = {};
  for (const [id, raw] of Object.entries(json.assets)) {
    try {
      assets[id] = parseAsset(raw, id);
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`asset ${id}: ${e.message}`);
    }
  }

  const groups: [string, string][] = [];
  if (Array.isArray(json.precinctGroups))
    for (const g of json.precinctGroups)
      if (Array.isArray(g) && isStr(g[0]) && isStr(g[1])) groups.push([g[0], g[1]]);
      else problems.push("precinctGroups: bad entry");

  const landmarks: Manifest["landmarks"] = {};
  if (isObj(json.landmarks))
    for (const [id, l] of Object.entries(json.landmarks))
      if (isObj(l) && isNumTuple(l.anchor, 2))
        landmarks[id] = { anchor: l.anchor as [number, number] };
      else problems.push(`landmark ${id}: bad anchor`);

  return {
    manifest: {
      version: 1,
      as_of: isStr(json.as_of) ? json.as_of : "",
      precinctGroups: groups,
      assets,
      landmarks,
    },
    problems,
  };
}
