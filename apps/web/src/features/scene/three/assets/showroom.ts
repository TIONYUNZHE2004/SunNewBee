import type { Placement } from "./fit";
import { paletteFor } from "./fit";
import type { Manifest } from "./manifest";
import type { CityPlan } from "./plan";

export const SHOWROOM_SPACING_M = 30;

/**
 * Owner review layout (`?showroom=1`): every asset variant once, one row per asset (sorted ids),
 * variants along x and rows along z, both 30 m apart, the grid centred on `centre` (local x, z).
 * Nothing is extruded. Landmarks go to `landmarks`, everything else to `placements`; as in
 * planCity, `stats.units` counts placements only.
 * Pair with `showroomManifest` so every variant draws its LOD0 at any distance.
 */
export function showroomPlan(m: Manifest, centre: [number, number]): CityPlan {
  const ids = Object.keys(m.assets).sort();
  const cols = Math.max(1, ...ids.map((id) => Object.keys(m.assets[id]!.variants).length));
  const x0 = centre[0] - ((cols - 1) * SHOWROOM_SPACING_M) / 2;
  const z0 = centre[1] - ((ids.length - 1) * SHOWROOM_SPACING_M) / 2;
  const plan: CityPlan = {
    placements: new Map(),
    extrude: new Set(),
    landmarks: [],
    stats: { placed: 0, units: 0, fallback: {} },
  };
  ids.forEach((asset, row) => {
    const spec = m.assets[asset]!;
    Object.keys(spec.variants).forEach((variant, col) => {
      const id = `showroom:${asset}/${variant}`;
      const p: Placement = {
        id,
        asset,
        variant,
        x: x0 + col * SHOWROOM_SPACING_M,
        z: z0 + row * SHOWROOM_SPACING_M,
        yaw: 0,
        sx: 1,
        sy: 1,
        sz: 1,
        palette: paletteFor(spec, "default", id),
      };
      plan.stats.placed++;
      if (spec.group === "landmark") {
        plan.landmarks.push(p);
        return;
      }
      const key = `${asset}/${variant}`;
      plan.placements.set(key, [...(plan.placements.get(key) ?? []), p]);
      plan.stats.units++;
    });
  });
  return plan;
}

/** A copy of the manifest whose variants keep only LOD0, drawn at every distance (maxM null). */
export function showroomManifest(m: Manifest): Manifest {
  const assets: Manifest["assets"] = {};
  for (const [id, a] of Object.entries(m.assets)) {
    const variants: (typeof a)["variants"] = {};
    for (const [v, vs] of Object.entries(a.variants)) {
      const lod0 = vs.lods[0];
      variants[v] = { ...vs, lods: lod0 ? [{ ...lod0, maxM: null }] : [] };
    }
    assets[id] = { ...a, variants };
  }
  return { ...m, assets };
}
