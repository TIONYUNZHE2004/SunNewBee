import { useDevsim } from "./devsimStore";

/**
 * D11 / AC-H4: no flood content on screen while a Development Simulation runs. The flood clause of
 * the attribution, the flood starters and chips and the Rising river launcher step aside while
 * devsim is not idle, and come back when it returns to idle. Licence attribution (OSM ODbL,
 * Copernicus) always stays.
 */
export const FLOOD_TEXT = /flood|river|water|storm/i;

/** True while a simulation is loading, playing, paused, ended or showing its unavailable note. */
export function useDevsimActive(): boolean {
  return useDevsim((s) => s.status !== "idle");
}

/** Drops the "Flood scenarios: …" clause; every licence line stays. */
export function quietAttribution(lines: readonly string[]): string[] {
  return lines.filter((l) => !/^\s*flood scenarios\b/i.test(l));
}

/** Drops starters about floods, the river, water or the storm rehearsal. */
export function quietStarters<T extends { text: string; icon: string }>(
  starters: readonly T[],
): T[] {
  return starters.filter((s) => s.icon !== "flood" && !FLOOD_TEXT.test(s.text));
}
