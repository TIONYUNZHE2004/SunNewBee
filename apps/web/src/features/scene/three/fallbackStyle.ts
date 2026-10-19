import { hash01, paletteFor, precinctGroupOf } from "./assets/fit";
import type { Manifest } from "./assets/manifest";
import { CLAY_PALETTE } from "./shared/clayTokens";

export interface FallbackColours {
  wall: string;
  roof: string;
  trim: string;
}

/** No manifest: a neutral warm white wall, dark roof and a slightly darker parapet. */
export const NEUTRAL_COLOURS: FallbackColours = { ...CLAY_PALETTE.neutral };

/** The archetype whose palette stands in for a building of this OSM kind. Display only. */
export const KIND_ARCHETYPE: Record<string, string> = {
  residential: "semi_d",
  commercial: "shop_office",
  office: "shop_office",
  retail: "shop_office",
  industrial: "factory",
  civic: "school",
};

/** Flat-roof block archetypes: their manifest palettes hold only three walls, so they also draw from BLOCK_WALLS. */
const BLOCK_ARCHETYPES = new Set([
  "generic",
  "shop_office",
  "highrise",
  "school",
  "mosque",
  "factory",
  "mall",
]);
/**
 * Extra pale wall tones for flat-roof blocks (A-T9): sand, sage, peach, stone. Picked by
 * hash01(id, "wall:variant") together with the palette wall. Display only; none is a water colour.
 */
export const BLOCK_WALLS = CLAY_PALETTE.blockWalls;

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
/** The wall colour darkened by 8%: the parapet band reads as a coping, not a stripe. */
function darken(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const k = 0.92;
  return `#${hex2(((n >> 16) & 255) * k)}${hex2(((n >> 8) & 255) * k)}${hex2((n & 255) * k)}`;
}

/**
 * Colours for an extruded building, so fallbacks blend with the instanced archetypes: walls from
 * the archetype (else kind-based residential/commercial/...) palette primary, roof from the
 * secondary, and a parapet band in a darker wall tone. Deterministic per id.
 */
export function fallbackColours(
  p: { archetype?: string; kind?: string; precinct?: string; id: string },
  m: Manifest | null,
  groups: [string, string][],
): FallbackColours {
  if (!m) return NEUTRAL_COLOURS;
  const name =
    (p.archetype && m.assets[p.archetype] ? p.archetype : undefined) ??
    KIND_ARCHETYPE[p.kind ?? ""] ??
    "generic";
  const spec = m.assets[name] ?? m.assets.generic ?? Object.values(m.assets)[0];
  if (!spec) return NEUTRAL_COLOURS;
  const [palWall, roof] = paletteFor(spec, precinctGroupOf(p.precinct, groups), p.id);
  let wall = palWall;
  if (BLOCK_ARCHETYPES.has(name)) {
    const pool = [palWall, ...BLOCK_WALLS];
    wall = pool[Math.min(pool.length - 1, Math.floor(hash01(p.id, "wall:variant") * pool.length))]!;
  }
  return { wall, roof, trim: darken(wall) };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Feature properties by building id, with the same id rule as `toBuildings`. */
export function propsByBuildingId(fc: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const feats = isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
  feats.forEach((f: unknown, i: number) => {
    if (!isRec(f)) return;
    const props = isRec(f.properties) ? f.properties : {};
    out.set(String(props.id ?? f.id ?? `b${i}`), props);
  });
  return out;
}

/** The `colours` callback for `buildCityGeometry`, from the buildings layer and the manifest. */
export function fallbackColourFn(
  buildingsFc: unknown,
  m: Manifest,
): (b: { id: string; kind: string }) => FallbackColours {
  const props = propsByBuildingId(buildingsFc);
  return (b) => {
    const pr = props.get(b.id);
    return fallbackColours(
      {
        id: b.id,
        kind: b.kind,
        archetype: typeof pr?.archetype === "string" ? pr.archetype : undefined,
        precinct: typeof pr?.precinct === "string" ? pr.precinct : undefined,
      },
      m,
      m.precinctGroups,
    );
  };
}
