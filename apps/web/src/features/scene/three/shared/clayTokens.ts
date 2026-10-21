import * as THREE from "three";
import type { Tier } from "../../shared/quality";
import { readsAsWater } from "../colourHue";

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
 *  - every fixed archetype role colour is >= 0.08 luminance (AC-A9);
 *  - manifest palettes pass through `clayPalette` at load (luminance floor, pastel lightness, water
 *    guard, clay trunk).
 *
 * Extending the table (parallel lanes):
 *  - Colours: add NAMED keys to `CLAY_PALETTE` (a new group object or a new key in an existing
 *    group); never reuse another lane's list by position. Hex literals live only here.
 *  - Roles: add a `ClayRole` member and its `CLAY` entry in the "Lane additions" region at the end
 *    of the `CLAY` table (one block per lane, so merges do not collide). Roughness 0.6-0.8,
 *    sheen > 0, metalness 0 unless `prop: true`. The token tests cover new roles automatically.
 *  - Unlit glow / effect colours go in `EFFECT_COLOURS`. DATA colours (status, flood, route, legend,
 *    journey ribbon) never go here: they live in `features/scene/styles.ts`.
 *  - Build materials with `clayMaterial(role, { tier })`; instance- or vertex-coloured meshes pass
 *    `tinted: true` / `vertexColors: true` so the base colour is white.
 *  - Sheen is per MATERIAL (the role's token); the archetype role shader scales it per role
 *    (`roleMaterial.ts` roleResponseGlsl).
 */

/** The demo hero's baju kurung and tudung (one source for `person` and the lane/fe `hero` block). */
const HERO_CLOTH = "#7c5cbf";
const HERO_HIJAB = "#c9a8e8";

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
  /** Fixed archetype roles (COLOR_0.g roles 3-7). Each >= CLAY_MIN_LUMINANCE (AC-A9, B-T4). */
  fixedRole: {
    glass: "#7f9bb0",
    dark: "#726f80",
    metal: "#d0d2d6",
    foliage: "#72c25b",
    light: "#fff1c9",
  },
  /** The base plane under the city (engine). */
  ground: "#ded3ba",
  /** City-level parks (cityMesh). */
  park: "#9bcf81",
  /** Decorative base water (rivers, ponds, the podium-deck pool). NEVER a flood colour. */
  baseWater: "#7fb6c9",
  /**
   * Decorative land-cover tints (landcover.ts): saturated pastels, HSL lightness 0.6-0.82 and
   * saturation 0.25-0.5 (the reference image, not beige). `water` is the base water.
   */
  landcover: {
    forest: "#86c072",
    grass: "#a7d590",
    scrub: "#adc78a",
    farmland: "#d7d5a2",
    oil_palm: "#98c07c",
    residential: "#e3d3ba",
    commercial: "#d3bfd9",
    industrial: "#d5c6b8",
    parking: "#d1c7b2",
    construction: "#d6bc9a",
    bare: "#ddd0b0",
    water: "#7fb6c9",
  },
  landcoverUnknown: "#dbd1bd",
  /**
   * Land dressing tones (A-T10, groundDetail / groundDecor): the second grass tone, the farmland
   * row stripes and the dirt mound. Decorative; the flower clumps reuse `prop.flowers`.
   */
  dress: { grassAlt: "#b4d68f", farmRow: "#c2bd84", farmRowAlt: "#e3dfb4", mound: "#c4a27c" },
  /** Road ribbons per kind (groundLayer). Illustrative: a road's colour says nothing about access. The
   * prototype road (#717786) a touch darker, so lit asphalt stays under the street check's 0.35 luminance. */
  road: { major: "#686d7a", residential: "#757a88", footway: "#f2dbb2", other: "#8e919b" },
  /** Dashed road marks; parking-stall lines. */
  marking: "#fbfaf5",
  stall: "#f4f2ec",
  /** Diorama slab soil layers, top first (ground/slab.ts; the prototype's slab). */
  slab: ["#ddd6b6", "#a87a4f", "#8b5f3c", "#c69c6d"],
  /** Kanopi podium deck boxes (podiumDeck). The pool is `baseWater`. */
  deck: { coping: "#efe9dc", timber: "#c98b55", planter: "#ddd3c3", green: "#88cf63" },
  /** Construction ground dressing (props/construction). */
  construction: { track: "#b68f68", gravel: "#d1c2a9" },
  /** The `trees` kit palette for verge shrubs (verges.ts): clay lightness, the clay trunk. */
  treesKit: ["#e0d9cc", "#9c6c45", "#a3a7ad"],
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
  /** Street dressing kit (B-T7) extras: signal head and lamps, bus-stop sign, poles, lamp globe, grass. */
  dressing: {
    signalHead: "#56596a",
    signalRed: "#ee6b5e",
    signalAmber: "#f5c04a",
    signalGreen: "#5cc08e",
    busSign: "#4f8fd0",
    pole: "#c9ccd2",
    lampGlobe: "#fff3d0",
    grass: "#7bc561",
    soil: "#9a6f4b",
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
    heroCloth: HERO_CLOTH,
    heroHijab: HERO_HIJAB,
  },
  // ---- Lane additions (one block per lane) ----
  /**
   * lane/fe (D-T6 / C-T4): the journey hero's placeholder chibi (prototype colours: purple baju,
   * lilac tudung, face, shoes, walker) and its rest bench. The rigged GLB hero carries its own
   * vertex colours and draws with the `hero` role.
   */
  hero: {
    cloth: HERO_CLOTH,
    tudung: HERO_HIJAB,
    skin: "#d9a77c",
    eye: "#2b2622",
    blush: "#f29b9b",
    shoe: "#4a3f5c",
    metal: "#cfd6de",
    grip: "#5a6b7d",
    benchWood: "#c98b55",
    // GATE fix (AC-B6 beats 14/16): was #4b5563 (luminance 0.09); its shade-side legs filled ~0.8%
    // of a rest framing with near-black. Clay slate at CLAY_MIN_LUMINANCE or over.
    benchIron: "#6f7a8a",
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
  /** The journey hero's ground highlight (lane/fe): yellow ring and pale disc (unlit markers). */
  heroRing: "#ffd34d",
  heroDisc: "#fff3c2",
} as const;

/** Development Simulation set dressing (hypothetical tower, site kit, cast): display only. */
export const DEVSIM_COLOURS = {
  white: "#ffffff",
  nearBlack: "#1b1b1b",
  castHelmetYellow: "#ffd21f",
  castVestOrange: "#ff7a1a",
  castSkinTan: "#c98a4a",
  kitWall: "#d8d6d0",
  slate: "#62666c",
  grey: "#8a8f96",
  headOff: "#5a5f68",
  headOn: "#fff6d8",
  amber: "#f4b942",
  beaconRed: "#ff3b30",
  headGlow: "#fff2c8",
  craneGrey: "#6b6f78",
  closedStrip: "#d6455d",
  detourStrip: "#2f7fd1",
  blue: "#3f88c5",
  offWhite: "#f4f1ea",
  green: "#57b38a",
  coral: "#e8644f",
  glass: "#9fc6dc",
  slateBlue: "#8f9bb3",
  towerA: "#b9b4ab",
  towerB: "#9d978d",
  towerAccent: "#5fa8a0",
  scaffoldLine: "#e98b2a",
  windowDark: "#2f4a63",
  windowGlow: "#ffcf86",
  hoardingNavy: "#3d4a63",
  hoardingPale: "#efe2c4",
  kerbSand: "#c9b892",
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
  | "sign"
  | "dressing"
  // lane/fe additions
  | "hero";

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
  /**
   * Draw this role with the cheaper standard material on EVERY tier (no sheen). A gate switch:
   * `setClayStandardOnly("ground", true)` if large-area sheen costs too much.
   */
  standardOnly: boolean;
}

const P = CLAY_PALETTE;
const WHITE = "#ffffff";
const SHEEN_WHITE = WHITE;
const t = (
  colours: readonly string[],
  roughness: number,
  sheen: number,
  extra: Partial<
    Pick<ClayToken, "sheenRoughness" | "sheenColor" | "metalness" | "prop" | "standardOnly">
  > = {},
): ClayToken => ({
  colours,
  roughness,
  sheen,
  sheenRoughness: extra.sheenRoughness ?? 0.8,
  sheenColor: extra.sheenColor ?? SHEEN_WHITE,
  metalness: extra.metalness ?? 0,
  prop: extra.prop ?? false,
  standardOnly: extra.standardOnly ?? false,
});

/**
 * Role -> clay response. Metalness is non-zero ONLY on `metal` (archetype role 5: railings, poles,
 * gates, fences, the metal parts of kit props) and `propMetal` (street-dressing poles and frames).
 */
export const CLAY: Readonly<Record<ClayRole, ClayToken>> = {
  // ---- B-T1 core roles ----
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
      ...Object.values(P.dress),
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
  // ---- Lane additions (one block per lane; see "Extending the table") ----
  // journey/be (B-T7 street dressing kit): vertex-coloured props; colours from CLAY_PALETTE.prop,
  // CLAY_PALETTE.dressing and the zebra marking white.
  dressing: t(
    [
      P.marking,
      P.prop.wood,
      P.prop.iron,
      P.prop.shelter,
      P.prop.kerb,
      P.prop.planter,
      ...P.prop.flowers,
      ...Object.values(P.dressing),
    ],
    0.7,
    0.35,
    { prop: true },
  ),
  // lane/fe (D-T6 / C-T4): the journey hero (placeholder chibi, its bench, the rigged GLB body).
  // Standard material on every tier: the rigged hero is double-sided (open tudung back, hem and
  // lap shells), and the sheen program on both faces put her over the H11 1 ms budget.
  hero: t(Object.values(CLAY_PALETTE.hero), 0.7, 0.4, { standardOnly: true }),
};

/** Gate switch: draw `role` with the standard material on every tier (true), or by tier (false). */
export function setClayStandardOnly(role: ClayRole, on: boolean): void {
  (CLAY[role] as ClayToken).standardOnly = on;
}

/**
 * Quality tiering. Sheen needs `MeshPhysicalMaterial` (the physical program: sheen BRDF, IOR and
 * specular terms), costlier per fragment than `MeshStandardMaterial`. High draws clay with sheen;
 * Medium and Low degrade to `MeshStandardMaterial` with the same colour, roughness and metalness.
 * The program COUNT does not change (each material is one program either way); High's programs are
 * the physical variants.
 */
export function claySheenOn(tier: Tier, role?: ClayRole): boolean {
  return tier === "high" && !(role && CLAY[role].standardOnly);
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
export type ClayMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

export function clayMaterial(role: ClayRole, opts: ClayOptions = {}): ClayMaterial {
  const { tier = defaultTier, tinted = false, ...params } = opts;
  const tok = CLAY[role];
  const base: THREE.MeshStandardMaterialParameters = {
    color: params.vertexColors || tinted ? WHITE : tok.colours[0],
    ...params,
    roughness: tok.roughness,
    metalness: tok.metalness,
  };
  const mat = claySheenOn(tier, role)
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
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const role = mat.userData?.clayRole as ClayRole | undefined;
      if (!role || !(mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) continue;
      (mat as THREE.MeshPhysicalMaterial).sheen = claySheenOn(tier, role) ? CLAY[role].sheen : 0;
    }
  });
}

/** Every wall and roof colour the stylised city can draw from the token table (honesty guards). */
export function wallAndRoofColours(): string[] {
  return [...CLAY.wall.colours, ...CLAY.roof.colours, ...CLAY.deck.colours];
}

/** Lightness floor (HSL, sRGB) for loaded palette colours: pastel, never murky. */
export const CLAY_MIN_LIGHTNESS = 0.42;
/**
 * Relative-luminance floor (linear) for loaded palette colours and the fixed `dark` role. B-T4 raised
 * it from 0.1: at 0.1 a roof slope or trim in shade, after baked AO and GTAO, rendered under 0.03
 * (AC-A9 / AC-B6); `LIGHT_LIMITS.darkAlbedo` in lighting.ts is this value and is tested against
 * every mood's shade-side light. Clay pastels, never charcoal.
 */
export const CLAY_MIN_LUMINANCE = 0.15;
/** Saturation range a coloured palette entry is lifted or capped into. */
export const CLAY_SATURATION: readonly [number, number] = [0.2, 0.6];
/** At or below this saturation a palette ROOF is grey and stays grey (roofPlan's large-roof tint). */
const GREY_ROOF_SAT = 0.12;
/** A water-hued result is desaturated to this (under `readsAsWater`'s 0.15). */
const OFF_WATER_SAT = 0.12;

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * One palette colour into the clay range: saturation lifted or capped into CLAY_SATURATION (a grey
 * roof stays grey), lightness raised to CLAY_MIN_LIGHTNESS and luminance to CLAY_MIN_LUMINANCE, and
 * a result that reads as water desaturated. Pure; returns lower-case #rrggbb.
 */
export function clayColour(hex: string, slot: "wall" | "roof" | "accent"): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
  const { h } = hsl;
  let { s, l } = hsl;
  if (!(slot === "roof" && s <= GREY_ROOF_SAT))
    s = Math.min(CLAY_SATURATION[1], Math.max(CLAY_SATURATION[0], s));
  l = Math.max(l, CLAY_MIN_LIGHTNESS);
  const out = new THREE.Color();
  const set = () => out.setHSL(h, s, l, THREE.SRGBColorSpace);
  set();
  while (lum(out) < CLAY_MIN_LUMINANCE && l < 0.95) {
    l += 0.01;
    set();
  }
  if (readsAsWater(`#${out.getHexString()}`, CLAY_PALETTE.baseWater)) {
    s = Math.min(s, OFF_WATER_SAT);
    set();
  }
  return `#${out.getHexString()}`;
}

/**
 * A manifest palette trio [primary wall, secondary roof, accent] into clay; `parseManifest` applies
 * it to every loaded palette. The `trees` kit's secondary slot is the trunk: it snaps to
 * `CLAY_PALETTE.trunk`.
 */
export function clayPalette(
  trio: readonly [string, string, string],
  asset?: string,
): [string, string, string] {
  return [
    clayColour(trio[0], "wall"),
    asset === "trees" ? CLAY_PALETTE.trunk : clayColour(trio[1], "roof"),
    clayColour(trio[2], "accent"),
  ];
}
