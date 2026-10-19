import type { Placement } from "../assets/fit";
import type { ActiveTile } from "../stream/streamer";

/** Every list of `pick` over the active tiles, deduplicated by id (each tile owns its items). */
export function unionById<T extends { id: string }>(
  active: ActiveTile[],
  pick: (a: ActiveTile) => T[],
) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of active)
    for (const v of pick(a)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
  return out;
}

/**
 * The union of the active tiles' kit placements, per kit key, deduplicated by placement id. The
 * verge shrubs (Task 9, `trees` kit variants) join their `trees/<variant>` buckets here.
 */
export function unionKits(active: ActiveTile[]): Map<string, Placement[]> {
  const out = new Map<string, Placement[]>();
  const seen = new Set<string>();
  const add = (k: string, p: Placement) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const cur = out.get(k);
    if (cur) cur.push(p);
    else out.set(k, [p]);
  };
  for (const a of active) {
    for (const [k, l] of a.content.kits) for (const p of l) add(k, p);
    for (const p of a.content.verges?.shrubs ?? []) add(`${p.asset}/${p.variant}`, p);
  }
  return out;
}
