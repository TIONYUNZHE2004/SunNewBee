import type { BuildingsLayer } from "../../../../lib/api";
import { toBuildings } from "../../shared/model";
import { displayHeight, type Footprint, localRing } from "../cityMesh";
import type { FacadeBuilding } from "../facade/facadeLayer";
import { facadeFor } from "../facade/facadePlan";
import { type PodiumDeck, podiumDeck } from "../facade/podiumDeck";
import { area, cleanRing, MIN_ROOF_AREA_M2, type RoofBuilding } from "../facade/roofPlan";
import { type FallbackColours, fallbackColours, propsByBuildingId } from "../fallbackStyle";
import type { LocalFrame } from "../frame";
import type { Placement } from "./fit";
import { fitArchetype, footprintObb, hash01, paletteFor, precinctGroupOf, variantFor } from "./fit";
import type { AssetSpec, Manifest } from "./manifest";

export interface CityPlan {
  /** Key `${asset}/${variant}`. */
  placements: Map<string, Placement[]>;
  /**
   * Building ids that stay extruded. Every one of them gets a procedural facade (decorative; Low
   * tier draws none), including `generic` placements that would have been stretched.
   */
  extrude: Set<string>;
  landmarks: Placement[];
  stats: { placed: number; units: number; fallback: Record<string, number> };
}

const GENERIC = "generic";
const GENERIC_MIN_FILL = 0.85;
/**
 * A `generic` box is only placed when neither horizontal scale leaves this band. Outside it the
 * box would read as stretched, so the building is extruded with a facade instead (`generic_stretch`).
 */
export const GENERIC_UNSTRETCHED: [number, number] = [0.8, 1.25];
const unstretched = (s: number) => s >= GENERIC_UNSTRETCHED[0] && s <= GENERIC_UNSTRETCHED[1];
export const LANDMARK_FIT = { xz: [0.5, 2], y: [0.5, 2] } as {
  xz: [number, number];
  y: [number, number];
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const features = (fc: unknown): unknown[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features : [];

function ringOf(geom: unknown): [number, number][] | null {
  if (!isRec(geom) || geom.type !== "Polygon" || !Array.isArray(geom.coordinates)) return null;
  const ring = geom.coordinates[0];
  if (!Array.isArray(ring)) return null;
  const out: [number, number][] = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    out.push([p[0] as number, p[1] as number]);
  }
  return out.length >= 3 ? out : null;
}

function emptyPlan(): CityPlan {
  return {
    placements: new Map(),
    extrude: new Set(),
    landmarks: [],
    stats: { placed: 0, units: 0, fallback: {} },
  };
}

/**
 * Per-unit colours for a `repeat: frontage` row (shop office, link): each placed unit takes the
 * precinct palette entry `hash01(placementId, "palette")` picks, and a unit that would repeat its
 * left neighbour's entry moves to the next one, so neighbours differ whenever the list has more
 * than one entry. Deterministic per placement id. Decorative colour only. Pure.
 */
export function unitPalettes(units: Placement[], spec: AssetSpec, group: string): Placement[] {
  if (spec.repeat !== "frontage" || units.length < 2) return units;
  const own = spec.palettes[group];
  const list = own && own.length > 0 ? own : (spec.palettes.default ?? []);
  if (list.length < 2) return units;
  let prev = -1;
  return units.map((u) => {
    let k = Math.min(list.length - 1, Math.floor(hash01(u.id, "palette") * list.length));
    if (k === prev) k = (k + 1) % list.length;
    prev = k;
    return { ...u, palette: list[k]! };
  });
}

/** Which buildings get an archetype (and how many row units), and which stay extruded. Pure. */
export function planCity(
  layer: BuildingsLayer | null | undefined,
  frame: LocalFrame,
  m: Manifest,
  has: (asset: string) => boolean,
): CityPlan {
  const plan = emptyPlan();
  if (!layer) return plan;
  const fb = (reason: string) => {
    plan.stats.fallback[reason] = (plan.stats.fallback[reason] ?? 0) + 1;
  };

  const { buildings } = toBuildings(layer.buildings, displayHeight);
  const propsById = new Map<string, Record<string, unknown>>();
  features(layer.buildings).forEach((f, i) => {
    if (!isRec(f)) return;
    const props = isRec(f.properties) ? f.properties : {};
    propsById.set(String(props.id ?? f.id ?? `b${i}`), props);
  });
  const heightById = new Map(buildings.map((b) => [b.id, b.height]));

  // Landmarks: only where the data has a feature with that model. Never invent a footprint.
  const taken = new Set<string>();
  for (const f of features(layer.landmarks)) {
    if (!isRec(f) || !isRec(f.properties)) continue;
    const model = f.properties.model;
    if (typeof model !== "string") continue;
    const spec = m.assets[model];
    if (!spec || !has(model)) continue;
    if (spec.placement !== "anchor" && spec.placement !== "obb") continue; // deferred or null
    const variant = Object.keys(spec.variants)[0];
    if (!variant) continue;
    const bid = typeof f.properties.building_id === "string" ? f.properties.building_id : null;
    const id = String(f.properties.id ?? model);
    // A traced outline is the tower's own floor plate drawn over a real OSM building (its podium):
    // that building is not taken, so it stays drawn, counted and pickable at its OSM height.
    const traced = f.properties.match === "traced_outline";
    let placed: Placement | null = null;
    if (spec.placement === "anchor") {
      const a = m.landmarks[model]?.anchor;
      if (a) {
        const [x, z] = frame.toLocal(a[0], a[1]);
        placed = {
          id,
          asset: model,
          variant,
          x,
          z,
          yaw: 0,
          sx: 1,
          sy: 1,
          sz: 1,
          palette: paletteFor(spec, "default", id),
        };
      }
    } else {
      const ring = ringOf(f.geometry)?.map(([lon, lat]) => frame.toLocal(lon, lat));
      const obb = ring ? footprintObb(ring) : null;
      if (obb) {
        // A traced outline is drawn at the model's own (design) height; a building-name match at
        // the OSM building's height.
        const modelH = spec.variants[variant]!.size[1];
        const h = traced ? modelH : (bid && heightById.get(bid)) || modelH;
        // A landmark is the real footprint's OBB, so it is not fill-gated; the 0.5..2 band still is.
        const fit = fitArchetype(obb, spec, variant, h, null, id, "default", {
          minFill: 0,
          fit: LANDMARK_FIT,
        });
        if (fit?.[0])
          placed = traced
            ? { ...fit[0], asset: model, id, depthYield: true }
            : { ...fit[0], asset: model, id };
      }
    }
    if (!placed) continue;
    plan.landmarks.push(placed);
    if (bid && !traced) taken.add(bid);
  }

  for (const b of buildings) {
    if (taken.has(b.id)) continue;
    const props = propsById.get(b.id) ?? {};
    const asset = typeof props.archetype === "string" && props.archetype ? props.archetype : null;
    if (!asset) {
      plan.extrude.add(b.id);
      fb("no_archetype");
      continue;
    }
    const spec = m.assets[asset];
    if (!spec || !has(asset)) {
      plan.extrude.add(b.id);
      fb("no_asset");
      continue;
    }
    const ring = b.ring.map(([lon, lat]) => frame.toLocal(lon, lat));
    const obb = footprintObb(ring);
    if (!obb) {
      plan.extrude.add(b.id);
      fb("no_fit");
      continue;
    }
    if (asset === GENERIC && obb.fill < GENERIC_MIN_FILL) {
      plan.extrude.add(b.id);
      fb("generic_fill");
      continue;
    }
    const group = precinctGroupOf(
      typeof props.precinct === "string" ? props.precinct : undefined,
      m.precinctGroups,
    );
    const variant = variantFor(spec, group, b.height);
    const front =
      typeof props.front_deg === "number" && Number.isFinite(props.front_deg)
        ? props.front_deg
        : null;
    const fitted = fitArchetype(obb, spec, variant, b.height, front, b.id, group, {
      minFill: asset === GENERIC ? GENERIC_MIN_FILL : 0.75,
    });
    const units = fitted && unitPalettes(fitted, spec, group);
    if (!units) {
      plan.extrude.add(b.id);
      fb("no_fit");
      continue;
    }
    if (asset === GENERIC && units.some((u) => !unstretched(u.sx) || !unstretched(u.sz))) {
      plan.extrude.add(b.id);
      fb("generic_stretch");
      continue;
    }
    const key = `${asset}/${variant}`;
    const list = plan.placements.get(key) ?? [];
    for (const u of units) list.push({ ...u, asset });
    plan.placements.set(key, list);
    plan.stats.placed++;
    plan.stats.units += units.length;
  }
  return plan;
}

/**
 * The facade layer's input for the drawn extrusions (`buildCityGeometry(...).footprints`): the same
 * local ring, display height and base the extrusion uses, plus `facadeFor` with the feature's
 * archetype and precinct. Pure. Decorative only: nothing here changes a footprint or a height.
 */
export function facadeInputs(
  footprints: readonly Footprint[],
  layer: BuildingsLayer | null | undefined,
  m: Manifest | null,
): FacadeBuilding[] {
  const props = propsByBuildingId(layer?.buildings);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return footprints.map((f) => {
    const p = props.get(f.id);
    return {
      ring: f.ring,
      heightM: f.heightM,
      minHeightM: f.minHeightM,
      spec: facadeFor(
        {
          id: f.id,
          heightM: f.heightM,
          kind: f.kind,
          archetype: str(p?.archetype),
          precinct: str(p?.precinct),
        },
        m,
      ),
    };
  });
}

/** One roof the roof layer may dress (P4 Task 8): its building, palette and any podium deck. */
export interface RoofInput {
  b: RoofBuilding;
  palette: FallbackColours;
  /**
   * The decorative podium deck of a roof with a landmark's traced tower outline standing on it
   * (Kanopi, ruling P4-M), planned around the tower here, once per city plan (it is the costliest
   * roof to plan, so no streamed tick pays it).
   */
  deck?: PodiumDeck;
}

/**
 * The roof layer's input: every drawn extrusion of MIN_ROOF_AREA_M2 or more (the same local ring
 * and display height the extrusion uses), plus every podium under a traced landmark outline,
 * extruded or not. A building named by a landmark feature with a `model` is `isLandmark` (no
 * rooftop units: it is modelled, or its roof is a podium deck). Pure; decorative only.
 */
export function roofInputs(
  footprints: readonly Footprint[],
  layer: BuildingsLayer | null | undefined,
  m: Manifest | null,
  frame: LocalFrame,
): RoofInput[] {
  const props = propsByBuildingId(layer?.buildings);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const landmarkIds = new Set<string>();
  const plates = new Map<string, Array<Array<[number, number]>>>();
  for (const f of features(layer?.landmarks)) {
    if (!isRec(f) || !isRec(f.properties)) continue;
    const bid = str(f.properties.building_id);
    if (!bid || !str(f.properties.model)) continue;
    landmarkIds.add(bid);
    if (f.properties.match !== "traced_outline") continue;
    const ring = ringOf(f.geometry)?.map(([lon, lat]) => frame.toLocal(lon, lat));
    if (ring) plates.set(bid, [...(plates.get(bid) ?? []), ring]);
  }
  const input = (
    id: string,
    kind: string,
    ring: Array<[number, number]>,
    heightM: number,
  ): RoofInput => {
    const p = props.get(id);
    const archetype = str(p?.archetype);
    const palette = fallbackColours(
      { id, kind, archetype, precinct: str(p?.precinct) },
      m,
      m?.precinctGroups ?? [],
    );
    const b: RoofBuilding = { id, ring, heightM, kind, archetype, isLandmark: landmarkIds.has(id) };
    const on = plates.get(id);
    const deck = on ? podiumDeck(b, on) : null;
    return deck ? { b, palette, deck } : { b, palette };
  };
  const out: RoofInput[] = [];
  const done = new Set<string>();
  for (const f of footprints) {
    const pts = cleanRing(f.ring);
    if (!plates.has(f.id) && !(pts && Math.abs(area(pts)) >= MIN_ROOF_AREA_M2)) continue;
    out.push(input(f.id, f.kind, f.ring, f.heightM));
    done.add(f.id);
  }
  // A podium drawn as an instanced archetype still gets its deck (on its display height).
  if ([...plates.keys()].some((id) => !done.has(id))) {
    for (const b of toBuildings(layer?.buildings, displayHeight).buildings) {
      if (!plates.has(b.id) || done.has(b.id)) continue;
      const ring = localRing(b.ring, frame);
      if (ring && ring.length >= 3) out.push(input(b.id, b.kind, ring, b.height));
    }
  }
  return out;
}
