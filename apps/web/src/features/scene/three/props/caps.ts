import type { Tier } from "../../cesium/stylised/quality";

export type PropKind = "trees" | "lamps" | "furniture" | "construction" | "people" | "vehicles";

/**
 * Instance caps per tier and kind. Decorative props only; Low draws none. Measured at hero-mid
 * (software GL, indicative): after the shadow levers and KIT_LOD_SCALE, Medium holds the plan's
 * 3500/900/350/200 at 2.27 M tris / 83 draws (budget 2.5 M / 150). High keeps the plan's numbers
 * (6000/1500/600/300) at 3.99 M tris with its 0.75 kit scale; it has no stated budget.
 * `people` and `vehicles` are for Task 7.
 */
export const PROP_CAPS: Record<Tier, Record<PropKind, number>> = {
  high: { trees: 6000, lamps: 1500, furniture: 600, construction: 300, people: 400, vehicles: 250 },
  medium: {
    trees: 3500,
    lamps: 900,
    furniture: 350,
    construction: 200,
    people: 220,
    vehicles: 140,
  },
  low: { trees: 0, lamps: 0, furniture: 0, construction: 0, people: 0, vehicles: 0 },
};

export function capFor(tier: Tier, kind: PropKind): number {
  return PROP_CAPS[tier][kind];
}

/**
 * Runtime multiplier on every kit LOD distance (the manifest's maxM is unchanged on disk). Kits
 * are small, so on Medium they drop to their cheaper LODs sooner; archetypes are not scaled.
 */
/* Medium 0.5 and High 0.75 were chosen from hero-mid measurements. */
export const KIT_LOD_SCALE: Record<Tier, number> = { high: 0.75, medium: 0.5, low: 1 };
