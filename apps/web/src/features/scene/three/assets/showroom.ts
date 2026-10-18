import type { Placement } from "./fit";
import { paletteFor } from "./fit";
import type { Manifest } from "./manifest";
import type { CityPlan } from "./plan";

export const SHOWROOM_SPACING_M = 30;
/** Clear gap kept between the largest footprints. */
export const SHOWROOM_MARGIN_M = 5;

const sizeOf = (m: Manifest, asset: string, variant: string) =>
  m.assets[asset]?.variants[variant]?.size ?? [0, 0, 0];

/**
 * Owner review layout (`?showroom=1`): every asset variant once, one row per asset (archetypes and
 * kits sorted by id, then landmarks, so the big landmarks sit on the outer rows). Each row is
 * centred on `centre` (local x, z) and spaces its variants max(30 m, widest variant + 5 m) apart;
 * rows are max(30 m, half their depths + 5 m) apart, and the middle row sits on `centre`, so a
 * model is always within 15 m of it. Every pitch is per row: one 285 m landmark never stretches the
 * small rows. Nothing is extruded. Landmarks go to `landmarks`, everything else to `placements`;
 * as in planCity, `stats.units` counts placements only.
 * Pair with `showroomManifest` so every variant draws its LOD0 at any distance.
 */
export function showroomPlan(m: Manifest, centre: [number, number]): CityPlan {
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const ids = Object.keys(m.assets).sort(byId);
  const rows = [
    ...ids.filter((id) => m.assets[id]!.group !== "landmark"),
    ...ids.filter((id) => m.assets[id]!.group === "landmark"),
  ].map((asset) => {
    const variants = Object.keys(m.assets[asset]!.variants);
    const sizes = variants.map((v) => sizeOf(m, asset, v));
    return {
      asset,
      variants,
      width: Math.max(0, ...sizes.map((s) => s[0])),
      depth: Math.max(0, ...sizes.map((s) => s[2])),
    };
  });
  // Row z offsets from the first row, then shifted so the middle row lands on the centre.
  const zs: number[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    zs.push(
      prev
        ? zs[i - 1]! + Math.max(SHOWROOM_SPACING_M, (prev.depth + r.depth) / 2 + SHOWROOM_MARGIN_M)
        : 0,
    );
  });
  const mid = zs[Math.floor((rows.length - 1) / 2)] ?? 0;

  const plan: CityPlan = {
    placements: new Map(),
    extrude: new Set(),
    landmarks: [],
    stats: { placed: 0, units: 0, fallback: {} },
  };
  rows.forEach((r, row) => {
    const spec = m.assets[r.asset]!;
    const pitch = Math.max(SHOWROOM_SPACING_M, r.width + SHOWROOM_MARGIN_M);
    const x0 = centre[0] - ((r.variants.length - 1) * pitch) / 2;
    r.variants.forEach((variant, col) => {
      const id = `showroom:${r.asset}/${variant}`;
      const p: Placement = {
        id,
        asset: r.asset,
        variant,
        x: x0 + col * pitch,
        z: centre[1] + zs[row]! - mid,
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
      const key = `${r.asset}/${variant}`;
      plan.placements.set(key, [...(plan.placements.get(key) ?? []), p]);
      plan.stats.units++;
    });
  });
  return plan;
}

/** Local xz box around every showroom footprint (yaw 0), for framing the camera. */
export function showroomBounds(
  plan: CityPlan,
  m: Manifest,
): { min: [number, number]; max: [number, number] } {
  const min: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const p of [...[...plan.placements.values()].flat(), ...plan.landmarks]) {
    const [w, , d] = sizeOf(m, p.asset, p.variant);
    min[0] = Math.min(min[0], p.x - w / 2);
    max[0] = Math.max(max[0], p.x + w / 2);
    min[1] = Math.min(min[1], p.z - d / 2);
    max[1] = Math.max(max[1], p.z + d / 2);
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0], max: [0, 0] };
  return { min, max };
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
