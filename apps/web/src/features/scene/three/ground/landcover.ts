import * as THREE from "three";
import { localRing, triangulate } from "../cityMesh";
import type { LocalFrame } from "../frame";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { LANDCOVER_MAX_Y } from "./bands";

/**
 * Decorative land-cover tints (ESA WorldCover / OSM). Fill only: no outline, no hatch, no meaning.
 * Water is the BASE water blue, never the flood scenario blue. Colours: the clay token table.
 */
export const LANDCOVER_COLOURS: Record<string, string> = { ...CLAY_PALETTE.landcover };
export const UNKNOWN_LANDCOVER_COLOUR: string = CLAY_PALETTE.landcoverUnknown;
const UNKNOWN_COLOUR = UNKNOWN_LANDCOVER_COLOUR;

/** Draw order, lowest first. */
export const LANDCOVER_ORDER = [
  "farmland",
  "oil_palm",
  "forest",
  "grass",
  "scrub",
  "residential",
  "commercial",
  "industrial",
  "parking",
  "bare",
  "construction",
  "water",
] as const;

/** The grass tones (A-T10): the base class tint and the second, lighter tone the detail mixes in. */
export const GRASS_TONES: readonly [string, string] = [
  CLAY_PALETTE.landcover.grass,
  CLAY_PALETTE.dress.grassAlt,
];

/** What dresses a land-cover class (all of it decorative: "Decorative details are illustrative."). */
export interface LandcoverDressing {
  /** The ground tint tones (clay tokens); more than one means the detail mixes them. */
  tones: readonly string[];
  /** Massed canopy trees from the B-T3 clay tree kit (props planner; keep-out from walk lines). */
  trees?: "forest" | "scrub" | "oil_palm";
  /** Small flower clumps on the ground (groundDecor). */
  flowers?: boolean;
  /** Crop-row stripes on the ground (groundDecor). */
  rows?: boolean;
  /** Fences, cones and dirt mounds, never buildings (groundDecor, with the construction kit props). */
  constructionKit?: boolean;
  /** Parked cars and stall lines (the parking planner). */
  parkedCars?: boolean;
  /** Why the class has no props: its buildings come from the OSM footprints, never from here. */
  plain?: string;
}

const T = CLAY_PALETTE.landcover;
/**
 * The dressing rule of EVERY class in `base/landcover.geojson` (AC-A12). The table is complete:
 * `dressingFor` has no grey fallback for a seeded class (a class missing here fails the table test).
 */
export const LANDCOVER_DRESSING: Record<string, LandcoverDressing> = {
  forest: { tones: [T.forest], trees: "forest" },
  grass: { tones: GRASS_TONES, flowers: true },
  residential: { tones: [T.residential], plain: "buildings are the OSM footprints" },
  construction: { tones: [T.construction], constructionKit: true },
  water: { tones: [T.water], plain: "base water, never a flood scenario" },
  commercial: { tones: [T.commercial], plain: "buildings are the OSM footprints" },
  bare: { tones: [T.bare], plain: "bare earth" },
  parking: { tones: [T.parking], parkedCars: true },
  industrial: { tones: [T.industrial], plain: "buildings are the OSM footprints" },
  scrub: { tones: [T.scrub], trees: "scrub" },
  farmland: { tones: [T.farmland, CLAY_PALETTE.dress.farmRow], rows: true },
  oil_palm: { tones: [T.oil_palm], trees: "oil_palm" },
};

/** The dressing of a class; an unlisted class gets the unknown tint and no props (never a guess). */
export function dressingFor(cls: string): LandcoverDressing {
  return LANDCOVER_DRESSING[cls] ?? { tones: [UNKNOWN_COLOUR], plain: "unknown class" };
}

/** Lifts span 0.00 to 0.04 m: parks (0.05) and base water (0.06) sit above, roads at 0.08 m. */
const MAX_LIFT_M = LANDCOVER_MAX_Y;
/** Paint rank: an unknown class (-1) first, then LANDCOVER_ORDER. */
const rank = (cls: string) => (LANDCOVER_ORDER as readonly string[]).indexOf(cls);
const lift = (cls: string) => {
  const i = rank(cls);
  return i < 0 ? 0 : (MAX_LIFT_M * i) / (LANDCOVER_ORDER.length - 1);
};

function polygonsOf(g: GeoJSON.Geometry | null | undefined): unknown[][] {
  if (g?.type === "Polygon") return [g.coordinates];
  if (g?.type === "MultiPolygon") return g.coordinates;
  return [];
}

/**
 * One non-indexed, vertex-coloured, upward-facing triangle mesh of every land-cover polygon, each
 * flat at its class lift. Triangles are emitted grouped by class in LANDCOVER_ORDER: the mesh is
 * drawn without depth writes (see groundLayer), so this order is the paint order and overlapping
 * classes never z-fight across their millimetre lifts (township-range stripes). A polygon that
 * cannot be triangulated faithfully is skipped. Display only: nothing here is read by routing,
 * flood or answers.
 */
export function landcoverMesh(
  fc: GeoJSON.FeatureCollection,
  frame: LocalFrame,
): THREE.BufferGeometry {
  const buckets = new Map<number, { pos: number[]; col: number[] }>();
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const colours = new Map<string, number[]>();
  const rgb = (cls: string) => {
    let c = colours.get(cls);
    if (!c) {
      c = new THREE.Color(LANDCOVER_COLOURS[cls] ?? UNKNOWN_COLOUR).toArray();
      colours.set(cls, c);
    }
    return c;
  };
  for (const f of features) {
    const raw = f?.properties?.class;
    const cls = typeof raw === "string" ? raw : "";
    const y = lift(cls);
    const c = rgb(cls);
    const r = rank(cls);
    let b = buckets.get(r);
    if (!b) {
      b = { pos: [], col: [] };
      buckets.set(r, b);
    }
    const { pos, col } = b;
    for (const rings of polygonsOf(f?.geometry)) {
      const local = (rings as unknown[]).map((r) =>
        Array.isArray(r) ? localRing(r as [number, number][], frame) : null,
      );
      if (local.length === 0 || local.some((r) => r === null)) continue;
      const [contour, ...holes] = local as [number, number][][];
      const tris = triangulate(contour!, holes);
      if (!tris) continue;
      const all = [contour!, ...holes].flat();
      for (const t of tris)
        for (const i of t) {
          pos.push(all[i]![0], y, all[i]![1]);
          col.push(c[0]!, c[1]!, c[2]!);
        }
    }
  }
  const pos: number[] = [];
  const col: number[] = [];
  for (const r of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(r)!;
    for (const v of b.pos) pos.push(v);
    for (const v of b.col) col.push(v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      pos.map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  return g;
}

/** Brightness modulation of base water, +-4 %. Hue never moves, so it cannot read as flood blue. */
export const SHIMMER_AMPLITUDE = 0.04;

/** Wave constants shared by the CPU mirror and the GLSL chunk: [t1, x1, z1, t2, z2, x2]. */
const SHIMMER_WAVES = [0.8, 0.045, 0.031, 1.3, 0.057, 0] as const;

/** CPU mirror of the shader factor: 1 +- 0.04, a sum of two travelling waves. */
export function shimmerFactor(t: number, x: number, z: number): number {
  const [a, b, c, d, e, f] = SHIMMER_WAVES;
  const w = 0.5 * Math.sin(t * a + x * b + z * c) + 0.5 * Math.sin(t * d - z * e + x * f);
  return 1 + SHIMMER_AMPLITUDE * w;
}

/**
 * Adds the water shimmer to a vertex-coloured ground material, driven by the shared `uTime`
 * (Task 8's motion clock; static while it is 0). `"water-only"` limits it to pixels whose vertex
 * colour is the base water colour (land cover); `"all"` is for the base-water mesh.
 */
export function shimmerMaterial(
  mat: THREE.Material,
  uTime: { value: number },
  scope: "water-only" | "all",
): void {
  const w = new THREE.Color(LANDCOVER_COLOURS.water);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}_shimmer_${scope}`;
  const g = (i: number) => SHIMMER_WAVES[i]!.toFixed(4);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vShimXZ;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShimXZ = position.xz;");
    const gate =
      scope === "all"
        ? ""
        : `if (abs(vColor.r - ${w.r.toFixed(5)}) + abs(vColor.g - ${w.g.toFixed(5)}) + abs(vColor.b - ${w.b.toFixed(5)}) < 0.02) `;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uTime;\nvarying vec2 vShimXZ;\nvoid main() {")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
${gate}diffuseColor.rgb *= 1.0 + ${SHIMMER_AMPLITUDE} * (0.5 * sin(uTime * ${g(0)} + vShimXZ.x * ${g(1)} + vShimXZ.y * ${g(2)}) + 0.5 * sin(uTime * ${g(3)} - vShimXZ.y * ${g(4)} + vShimXZ.x * ${g(5)}));`,
      );
  };
}
