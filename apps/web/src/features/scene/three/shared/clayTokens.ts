import * as THREE from "three";
import type { Tier } from "../../shared/quality";

/**
 * The clay token table (B-T1, AC-B1): the ONE place the stylised (Three.js) city defines surface
 * colours and material response. Layer files import their colours from here; a grep test
 * (`clayTokens.grep.test.ts`) fails on any hex colour literal in a layer file outside this module and
 * its allow-list (data / legend / route colours, lights and sky, which live in their own modules).
 *
 * Look: toy clay diorama (spec §4 B1). Ported from the prototype
 * (docs/03-product/prototypes/resident-journey/index.html: `clay()` = MeshPhysicalMaterial,
 * roughness 0.7, sheen 0.35, sheenRoughness 0.8, white sheen; slab, walls, roofs, roads, kerbs,
 * greens, people and props palettes) and the reference image `reference-target.png`.
 *
 * Every colour here is DISPLAY ONLY ("Decorative details are illustrative."): no colour is a fact
 * about a building, road or place. Honesty guards (tests):
 *  - no wall or roof colour reads as water (`readsAsWater`, A-T9 guard extended to this table);
 *  - base water is the decorative water blue, never the flood scenario blue; flood, status, legend
 *    and route colours are DATA colours and are NOT defined here (overlays/, lib/, routeLine.ts);
 *  - every fixed archetype role colour is >= 0.08 luminance (AC-A9).
 */

/** Pastel clay palette, sRGB hex. Grouped by what draws it. */
export const CLAY_PALETTE = {
  /** No-manifest building walls per OSM kind (cityMesh KIND_COLOUR). */
  kindWall: {
    residential: "#f6e3c8",
    commercial: "#f4f0e8",
    industrial: "#e4e1d8",
    civic: "#f3cfc1",
    other: "#efe6d6",
    building: "#f7efd9",
  },
  /** No-manifest fallback: warm white wall, soft lilac-grey roof (grey, so large roofs take a tint), a darker parapet. */
  neutral: { wall: "#f6efe2", roof: "#a9a6b0", trim: "#e6dccb" },
  /** Extra pale wall tones for flat-roof blocks (fallbackStyle BLOCK_WALLS): cream, blush, sage, butter. */
  blockWalls: ["#f6e3c8", "#f3cfc1", "#dcebd8", "#f7efd9"],
  /** Large-roof tints (roofPlan ROOF_TINTS): coral, apricot, lilac, sage. The prototype's teal and
   * sky-blue roofs are left out on purpose: they read as water (A-T9). */
  roofTints: ["#e57f6c", "#f0b86a", "#c9a4d4", "#a8c98f"],
  /** Rooftop plant units (roofLayer), jittered +-10% per unit. */
  roofUnit: "#c4c1cc",
  /** Archetype palette when a manifest asset has none (assets/fit). [primary, secondary, accent]. */
  archetypeFallback: ["#ece6da", "#a8a196", "#7d7870"],
  /** Single-mesh role material default palette (roleMaterial). [primary, secondary, accent]. */
  roleDefault: ["#ece4d6", "#b5a898", "#d98a74"],
  /** Fixed archetype roles (COLOR_0.g roles 3-7). Each >= 0.08 luminance (AC-A9). */
  fixedRole: {
    glass: "#7f9bb0",
    dark: "#6b6878",
    metal: "#d0d2d6",
    foliage: "#72c25b",
    light: "#fff1c9",
  },
  /** The base plane under the city (engine). */
  ground: "#ebe4d4",
  /** City-level parks (cityMesh). */
  park: "#a3d273",
  /** Decorative base water (rivers, ponds, the podium-deck pool). NEVER a flood colour. */
  baseWater: "#7fb6c9",
  /** Decorative land-cover tints (landcover.ts). `water` is the base water. */
  landcover: {
    forest: "#7fb86a",
    grass: "#a8d47c",
    scrub: "#9cc47a",
    farmland: "#dedb9e",
    oil_palm: "#8fb563",
    residential: "#efe8da",
    commercial: "#ece6ee",
    industrial: "#e5e1d7",
    parking: "#d9d5cc",
    construction: "#e0c9a0",
    bare: "#e8dcc0",
    water: "#7fb6c9",
  },
  landcoverUnknown: "#e6e0d2",
  /** Road ribbons per kind (groundLayer). Illustrative: a road's colour says nothing about access. */
  road: { major: "#717786", residential: "#868b98", footway: "#f2dbb2", other: "#9b9ea8" },
  /** Dashed road marks; parking-stall lines. */
  marking: "#fbfaf5",
  stall: "#f4f2ec",
  /** Diorama slab soil layers, top first (ground/slab.ts; the prototype's slab). */
  slab: ["#ddd6b6", "#a87a4f", "#8b5f3c", "#c69c6d"],
  /** Kanopi podium deck boxes (podiumDeck). The pool is `baseWater`. */
  deck: { coping: "#efe9dc", timber: "#c98b55", planter: "#ddd3c3", green: "#88cf63" },
  /** Construction ground dressing (props/construction). */
  construction: { track: "#b0946a", gravel: "#dccfb4" },
  /** The `trees` kit default palette (mirrors manifest `trees.palettes.default`; verges.ts). */
  treesKit: ["#d8d6d0", "#3d4147", "#8a8f96"],
  /** Tree parts for the street-dressing and tree lanes (prototype greens and trunk). */
  greens: ["#72c25b", "#88cf63", "#5fae5c", "#9bd46d", "#7bbd6c"],
  trunk: "#9c6c45",
  /** Street-dressing props (prototype): bench wood, iron, shelter canopy, awning stripes, kerb. */
  prop: {
    wood: "#c98b55",
    iron: "#5f6878",
    shelter: "#7fb08a",
    awningRed: "#e8644f",
    awningWhite: "#f4f1ea",
    kerb: "#f3ede2",
    planter: "#d9a37a",
    flowers: ["#f2a7c3", "#f4b942", "#e8644f", "#c9a8e8", "#fff3c2"],
  },
  /** Cars (prototype CAR) and car glass. */
  vehicle: ["#e8644f", "#f4f1ea", "#3f88c5", "#f4b942", "#57b38a", "#8f9bb3"],
  vehicleGlass: "#9fc6dc",
  tyre: "#3a3a3c",
  /** People (prototype; Phase C reads these). */
  person: {
    skin: ["#f2c9a0", "#d9a77c", "#b9845c", "#8d5d3c"],
    cloth: ["#e8644f", "#3f88c5", "#f4b942", "#57b38a", "#c66fb0", "#ef8f5a", "#5c6bc0", "#f2a7c3"],
    hijab: ["#f2d0e0", "#bfe0d0", "#f6e2b0", "#c9c2ec", "#ffffff"],
    pants: ["#3d4a63", "#5b4636", "#2e3a4f", "#7a6a58"],
    hair: ["#3b2a20", "#20201f", "#6b4a2f"],
    /** The demo hero: purple baju kurung, lilac tudung. */
    heroCloth: "#7c5cbf",
    heroHijab: "#c9a8e8",
  },
} as const;

/**
 * Unlit effect and glow colours: NOT clay surfaces (no roughness or sheen), kept here so layer files
 * stay free of colour literals. Birds and cloud shadows (ambient), the lamp pool glow (lampPools),
 * sign band and ink (signLayer), vehicle head and tail lights (roleMaterial).
 */
export const EFFECT_COLOURS = {
  bird: "#2b2d31",
  /** Cloud shadows multiply the ground through a blob texture: black at low opacity. */
  cloudShadow: "#000000",
  lampPool: "#ffcf8a",
  signBand: "#1d2230",
  signInk: "#ffffff",
  headlight: "#fff4d6",
  taillight: "#ff3b30",
} as const;

export type ClayRole =
  | "wall"
  | "roof"
  | "glass"
  | "dark"
  | "metal"
  | "foliage"
  | "trunk"
  | "light"
  | "ground"
  | "park"
  | "water"
  | "road"
  | "marking"
  | "slab"
  | "deck"
  | "prop"
  | "propMetal"
  | "person"
  | "vehicle"
  | "sign";

export interface ClayToken {
  /** The role's palette (first entry is the default colour). */
  colours: readonly string[];
  /** 0.6-0.8 for every role (AC-B1). */
  roughness: number;
  /** > 0 for every role (AC-B1). Drawn only on the High tier (see `clayMaterial`). */
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  /** 0 except on `prop` roles (AC-B1: "no metalness except props"). */
  metalness: number;
  /** A street prop or prop part (railings, poles, gates, benches): the only roles allowed metalness. */
  prop: boolean;
}

const P = CLAY_PALETTE;
const WHITE = "#ffffff";
const SHEEN_WHITE = WHITE;
const t = (
  colours: readonly string[],
  roughness: number,
  sheen: number,
  extra: Partial<Pick<ClayToken, "sheenRoughness" | "sheenColor" | "metalness" | "prop">> = {},
): ClayToken => ({
  colours,
  roughness,
  sheen,
  sheenRoughness: extra.sheenRoughness ?? 0.8,
  sheenColor: extra.sheenColor ?? SHEEN_WHITE,
  metalness: extra.metalness ?? 0,
  prop: extra.prop ?? false,
});

/**
 * Role -> clay response. Metalness is non-zero ONLY on `metal` (archetype role 5: railings, poles,
 * gates, fences, the metal parts of kit props) and `propMetal` (street-dressing poles and frames).
 */
export const CLAY: Readonly<Record<ClayRole, ClayToken>> = {
  wall: t(
    [
      ...Object.values(P.kindWall),
      ...P.blockWalls,
      P.neutral.wall,
      P.neutral.trim,
      P.roleDefault[0],
      P.roleDefault[2],
      P.archetypeFallback[0],
      P.archetypeFallback[2],
    ],
    0.7,
    0.35,
  ),
  roof: t(
    [...P.roofTints, P.neutral.roof, P.roofUnit, P.roleDefault[1], P.archetypeFallback[1]],
    0.72,
    0.3,
  ),
  glass: t([P.fixedRole.glass, P.vehicleGlass], 0.6, 0.15),
  dark: t([P.fixedRole.dark, P.tyre], 0.75, 0.25),
  metal: t([P.fixedRole.metal], 0.6, 0.2, { metalness: 0.3, prop: true }),
  foliage: t([P.fixedRole.foliage, ...P.greens, ...P.treesKit], 0.75, 0.5, {
    sheenColor: "#f4ffe0",
  }),
  trunk: t([P.trunk], 0.75, 0.3),
  light: t([P.fixedRole.light], 0.6, 0.2),
  ground: t(
    [
      P.ground,
      ...Object.entries(P.landcover)
        .filter(([k]) => k !== "water")
        .map(([, v]) => v),
      P.landcoverUnknown,
      P.construction.track,
      P.construction.gravel,
    ],
    0.8,
    0.15,
  ),
  park: t([P.park, P.landcover.grass], 0.8, 0.3, { sheenColor: "#f4ffe0" }),
  water: t([P.baseWater], 0.6, 0.2),
  road: t(Object.values(P.road), 0.8, 0.15),
  marking: t([P.marking, P.stall, P.prop.kerb], 0.7, 0.2),
  slab: t(P.slab, 0.78, 0.25),
  deck: t(Object.values(P.deck), 0.72, 0.3),
  prop: t(
    [
      P.prop.wood,
      P.prop.shelter,
      P.prop.awningRed,
      P.prop.awningWhite,
      P.prop.kerb,
      P.prop.planter,
      ...P.prop.flowers,
    ],
    0.7,
    0.35,
    { prop: true },
  ),
  propMetal: t([P.prop.iron], 0.6, 0.2, { metalness: 0.35, prop: true }),
  person: t(
    [
      ...P.person.skin,
      ...P.person.cloth,
      ...P.person.hijab,
      ...P.person.pants,
      ...P.person.hair,
      P.person.heroCloth,
      P.person.heroHijab,
    ],
    0.7,
    0.4,
  ),
  vehicle: t(P.vehicle, 0.6, 0.3),
  sign: t([EFFECT_COLOURS.signBand], 0.7, 0.1),
};

/**
 * Quality tiering. Sheen needs `MeshPhysicalMaterial` (the physical program: sheen BRDF, IOR and
 * specular terms), costlier per fragment than `MeshStandardMaterial`. High draws clay with sheen;
 * Medium and Low degrade to `MeshStandardMaterial` with the same colour, roughness and metalness.
 * The program COUNT does not change (each material is one program either way); High's programs are
 * the physical variants.
 */
export function claySheenOn(tier: Tier): boolean {
  return tier === "high";
}

let defaultTier: Tier = "high";
/** The tier new clay materials use when none is passed. The engine sets it at build and on a tier change. */
export function setClayTier(tier: Tier): void {
  defaultTier = tier;
}
export function clayTier(): Tier {
  return defaultTier;
}

export type ClayOptions = Omit<
  THREE.MeshStandardMaterialParameters,
  "roughness" | "metalness" | "sheen"
> & {
  tier?: Tier;
  /** The colour comes from instance or vertex colours: white base (as with `vertexColors`). */
  tinted?: boolean;
};

/**
 * A material for a clay role: colour (default: the role's first colour, or white with
 * `vertexColors`), roughness and metalness from the token. High: `MeshPhysicalMaterial` with the
 * role's sheen; Medium / Low: `MeshStandardMaterial`. `userData.clayRole` names the role.
 */
export function clayMaterial(role: ClayRole, opts: ClayOptions = {}): THREE.MeshStandardMaterial {
  const { tier = defaultTier, tinted = false, ...params } = opts;
  const tok = CLAY[role];
  const base: THREE.MeshStandardMaterialParameters = {
    color: params.vertexColors || tinted ? WHITE : tok.colours[0],
    ...params,
    roughness: tok.roughness,
    metalness: tok.metalness,
  };
  const mat = claySheenOn(tier)
    ? new THREE.MeshPhysicalMaterial({
        ...base,
        sheen: tok.sheen,
        sheenRoughness: tok.sheenRoughness,
        sheenColor: tok.sheenColor,
      })
    : new THREE.MeshStandardMaterial(base);
  mat.userData.clayRole = role;
  return mat;
}

/**
 * Applies a runtime tier change to clay materials already in `root`: physical clay keeps its sheen
 * on High and drops it to 0 below (three recompiles without the sheen term). A Standard clay
 * material made on Medium / Low stays Standard (new layers follow `setClayTier`).
 */
export function applyClayTier(root: THREE.Object3D, tier: Tier): void {
  const on = claySheenOn(tier);
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const role = mat.userData?.clayRole as ClayRole | undefined;
      if (!role || !(mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) continue;
      (mat as THREE.MeshPhysicalMaterial).sheen = on ? CLAY[role].sheen : 0;
    }
  });
}

/** Every wall and roof colour the stylised city can draw from the token table (honesty guards). */
export function wallAndRoofColours(): string[] {
  return [...CLAY.wall.colours, ...CLAY.roof.colours, ...CLAY.deck.colours];
}
