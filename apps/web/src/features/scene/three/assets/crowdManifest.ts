/**
 * The crowd kit manifest (`/city/characters/crowd.json`, written by
 * `assets/blender/pack.py --crowd`; C-T6). One rigged glb per body (`crowd_<body>.glb`) with
 * the same 19-bone skeleton, a skinned mesh per outfit (`<outfit>__LOD0/1`), prop meshes on the
 * `prop` / `wheels` bones and the clips `walk`, `idle` (+ `walk_<prop>`, `idle_<prop>`).
 *
 * A look is body + outfit (+ prop) + palette. Meshes carry the palette role in TEXCOORD_0.x
 * ((role index + 0.5) / roles.length), so C-T7 can recolour instances from a palette texture
 * (u = role, v = look row in `looks` order). Coordinates are true metres, glTF frame.
 * Decorative only: "Decorative details are illustrative." The crowd never causes journey events.
 *
 * For C-T7 (ruling: bone-matrix animation texture): props are rigid children of the `prop`
 * (and `wheels`) bones, so bake them as one-bone skinned meshes; clip channels are sparsely
 * keyed, so sample them through a mixer.
 *
 * As for the hero: do not call `skeleton.pose()` (meshopt folds a scale into the inverse bind
 * matrices); a fresh load is in the bind pose.
 */

export const CROWD_BODIES = [
  "child",
  "school_age",
  "adult_man",
  "adult_woman",
  "older_man",
  "older_woman",
] as const;
export type CrowdBody = (typeof CROWD_BODIES)[number];
export const CROWD_PROPS = ["walker", "stroller", "wheelchair"] as const;
export type CrowdProp = (typeof CROWD_PROPS)[number];
export const OUTFIT_CATEGORIES = [
  "baju_kurung",
  "baju_melayu",
  "school_shirt",
  "school_pinafore",
  "office",
  "casual",
] as const;
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

export interface CrowdClip {
  duration: number;
  /** Timeline frames at 30 fps (duration x 30 + 1). */
  frames: number;
  /** Keyed frames: walks every frame (keyFps 30), idles every 3rd (keyFps 10, linear between).
   * Channels are sparse (only moving bones; hips also translate): sample through an
   * AnimationMixer at the bake rate, never read raw tracks per frame. */
  keys: number;
  keyFps: number;
  loop: boolean;
  /** Ground travelled per cycle (true metres); 0 for idles. */
  stride: number;
}

export interface CrowdBodySpec {
  file: string;
  bytes: number;
  label: string;
  height: number;
  headRatio: number;
  stoopDeg: number;
  hipY: number;
  outfits: string[];
  props: CrowdProp[];
  clips: Record<string, CrowdClip>;
}

export interface CrowdLook {
  id: string;
  body: CrowdBody;
  outfit: string;
  prop: CrowdProp | null;
  mesh: string;
  propMeshes: string[];
  clips: { walk: string; idle: string };
  /** Triangles per LOD, body plus prop, as shipped. */
  tris: [number, number];
  palette: Record<string, string>;
}

export interface CrowdManifest {
  version: 1;
  decorative: true;
  note: string;
  roles: string[];
  roleUv: string;
  bones: string[];
  lods: { suffix: string; maxTris: number; maxM: number }[];
  outfits: Record<string, { label: string; category: OutfitCategory; headwear: string | null }>;
  bodies: Record<CrowdBody, CrowdBodySpec>;
  looks: CrowdLook[];
}

export const CROWD_MANIFEST_URL = "/city/characters/crowd.json";

/** Light structural checks; `problems` is empty when the manifest is usable. */
export function parseCrowdManifest(raw: unknown): {
  manifest: CrowdManifest | null;
  problems: string[];
} {
  const problems: string[] = [];
  const m = raw as Partial<CrowdManifest> | null;
  if (!m || m.version !== 1) return { manifest: null, problems: ["version is not 1"] };
  if (!Array.isArray(m.roles) || m.roles.length === 0) problems.push("no roles");
  if (!m.bodies) problems.push("no bodies");
  if (!Array.isArray(m.looks)) problems.push("no looks");
  for (const lk of m.looks ?? []) {
    const body = m.bodies?.[lk.body];
    if (!body) problems.push(`${lk.id}: unknown body ${lk.body}`);
    else {
      if (!body.outfits.includes(lk.outfit))
        problems.push(`${lk.id}: ${lk.outfit} not on ${lk.body}`);
      for (const c of [lk.clips.walk, lk.clips.idle])
        if (!body.clips[c]) problems.push(`${lk.id}: no clip ${c}`);
    }
    for (const r of m.roles ?? [])
      if (!/^#[0-9a-f]{6}$/.test(lk.palette?.[r] ?? "")) problems.push(`${lk.id}: palette ${r}`);
  }
  return { manifest: problems.length ? null : (m as CrowdManifest), problems };
}

/** Palette role of a TEXCOORD_0.x value. */
export function roleOfU(m: CrowdManifest, u: number): string {
  const n = m.roles.length;
  return m.roles[Math.min(n - 1, Math.max(0, Math.floor(u * n)))] ?? "unknown";
}

export const crowdUrl = (m: CrowdManifest, body: CrowdBody): string =>
  `/city/${m.bodies[body].file}`;
