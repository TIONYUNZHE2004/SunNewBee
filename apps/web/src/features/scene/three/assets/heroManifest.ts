/**
 * The journey hero's asset manifest (`/city/characters/manifest.json`, written by
 * `assets/blender/pack.py --heroes`). One rigged glb per prop variant, sharing one skeleton and
 * the six clip names. Coordinates are glTF (y up, she faces +z) in true metres: multiply by
 * `displayScale` (R-J3), as the runtime scales the hero object. Decorative display only.
 */

export const HERO_VARIANTS = ["walker", "stroller", "wheelchair", "none"] as const;
export type HeroVariant = (typeof HERO_VARIANTS)[number];
export const HERO_CLIPS = ["walk", "idle", "sit_down", "sit_idle", "stand_up", "look"] as const;
export type HeroClip = (typeof HERO_CLIPS)[number];

export interface HeroVariantSpec {
  file: string;
  bytes: number;
  /** Routing profile that picks this variant. */
  profile: string;
  lods: { node: string; tris: number; maxM: number | null }[];
  clips: Record<HeroClip, { duration: number; loop: boolean }>;
  /** Ground distance per walk cycle (true metres); the walk clip lasts `walkDuration` s. */
  stride: number;
  walkDuration: number;
  /** Hips bone in `sit_idle`, relative to the root (true metres, glTF frame). */
  sitHips: [number, number, number];
  /** Wheelchair: she stays in the chair (the sit clips move her hands to her lap). */
  seated: boolean;
}

export interface HeroManifest {
  version: 1;
  as_of: string;
  displayScale: number;
  clips: HeroClip[];
  bones: {
    palm: [string, string];
    grip: [string, string];
    hand: [string, string];
    foot: [string, string];
    hips: string;
    head: string;
    prop: string;
    wheels: string;
  };
  /** Bench the sit clips are authored for: seat top height and its front edge (behind the root, -z). */
  bench: { seatY: number; frontEdgeZ: number };
  variants: Partial<Record<HeroVariant, HeroVariantSpec>>;
}

export const HERO_MANIFEST_URL = "/city/characters/manifest.json";
export const heroUrl = (m: HeroManifest, v: HeroVariant): string | null => {
  const spec = m.variants[v];
  return spec ? `/city/${spec.file}` : null;
};

/** Which prop variant a routing profile uses (the demo profile is `older_adult_rest` -> walker). */
export function variantForProfile(m: HeroManifest, profile: string): HeroVariant {
  for (const v of HERO_VARIANTS) if (m.variants[v]?.profile === profile) return v;
  return "none";
}

/**
 * Walk playback rate so the feet do not slide: displayed stride per cycle x cycles per second =
 * speed (scene metres per second). `scale` is the display scale the hero is drawn at.
 */
export function walkRate(spec: HeroVariantSpec, speed: number, scale: number): number {
  const cyclesPerSecond = speed / (spec.stride * scale);
  return cyclesPerSecond * spec.walkDuration;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates shape and version; returns null with the problems on a malformed file. */
export function parseHeroManifest(json: unknown): {
  manifest: HeroManifest | null;
  problems: string[];
} {
  const problems: string[] = [];
  if (!isObj(json) || json.version !== 1)
    return { manifest: null, problems: ["not a version 1 hero manifest"] };
  if (!isNum(json.displayScale) || json.displayScale <= 0) problems.push("displayScale");
  if (!isObj(json.bones) || !isObj(json.bench)) problems.push("bones/bench");
  if (!isObj(json.variants)) problems.push("variants");
  else
    for (const [v, spec] of Object.entries(json.variants)) {
      if (!(HERO_VARIANTS as readonly string[]).includes(v)) problems.push(`unknown variant ${v}`);
      if (!isObj(spec) || typeof spec.file !== "string" || !isNum(spec.stride))
        problems.push(`variant ${v}`);
      else if (!isObj(spec.clips) || HERO_CLIPS.some((c) => !isObj((spec.clips as never)[c])))
        problems.push(`variant ${v} clips`);
    }
  return problems.length
    ? { manifest: null, problems }
    : { manifest: json as unknown as HeroManifest, problems };
}
