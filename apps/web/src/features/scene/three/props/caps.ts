import type { Tier } from "../../cesium/stylised/quality";

export type PropKind = "trees" | "lamps" | "furniture" | "construction" | "people" | "vehicles";

/**
 * Instance caps per tier and kind. Decorative props only; Low draws none. The plan's numbers
 * (high 6000/1500/600/300, medium 3500/900/350/200) blew the hero-mid budget: the city alone is
 * about 2.43 M tris of 2.5 M, and 3500/900/350/200 measured 4.41 M. Medium is lowered to 80/60/30/8
 * (measured 2.48 M tris, 74 draws); high keeps the same ratio. Raise them as the city's own
 * triangle count comes down. `people` and `vehicles` are for Task 7.
 */
export const PROP_CAPS: Record<Tier, Record<PropKind, number>> = {
  high: { trees: 140, lamps: 100, furniture: 50, construction: 12, people: 400, vehicles: 250 },
  medium: { trees: 80, lamps: 60, furniture: 30, construction: 8, people: 220, vehicles: 140 },
  low: { trees: 0, lamps: 0, furniture: 0, construction: 0, people: 0, vehicles: 0 },
};

export function capFor(tier: Tier, kind: PropKind): number {
  return PROP_CAPS[tier][kind];
}
