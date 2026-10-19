import type { Tier } from "../../shared/quality";

export type PropKind = "trees" | "lamps" | "furniture" | "construction" | "people" | "vehicles";

/**
 * Runtime multiplier on every kit LOD distance (the manifest's maxM is unchanged on disk). Kits
 * are small, so on Medium they drop to their cheaper LODs sooner; archetypes are not scaled.
 */
/* Medium 0.5 and High 0.75 were chosen from hero-mid measurements. */
export const KIT_LOD_SCALE: Record<Tier, number> = { high: 0.75, medium: 0.5, low: 1 };
