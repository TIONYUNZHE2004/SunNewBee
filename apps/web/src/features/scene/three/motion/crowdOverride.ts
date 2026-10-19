import { hash01 } from "../assets/fit";
import { BUBBLE_RADIUS_M } from "../detailBubble";
import type { ActiveTile } from "../stream/streamer";
import { TILE_M } from "../stream/tiles";
import type { Agent } from "./agents";

/**
 * ACCEPTANCE ONLY (spec P10): `?acceptance=1&crowd=N` fills the detail-bubble tiles (rings 0 and 1)
 * with extra decorative people, so that any 150 m bubble around the focus holds about N of them, to
 * measure frame rate with N crowd agents in the bubble. Never honoured without `acceptance=1`, so
 * the product and the demo never show it. The extras are copies of the tile's own planned people
 * (same footway path, a seeded start offset and pace), so they keep every crowd rule (pavements,
 * keep-out, looks, decorative note). Decorative only: no fact reads them.
 */
export const CROWD_OVERRIDE_MAX = 5000;

/** N from `?crowd=N` when `?acceptance=1` is also set; null otherwise or when N is not 1..5000. */
export function crowdOverride(search: string): number | null {
  const q = new URLSearchParams(search);
  if (q.get("acceptance") !== "1") return null;
  const raw = q.get("crowd");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= CROWD_OVERRIDE_MAX ? n : null;
}

/** People per 250 m tile for about `n` in a bubble of BUBBLE_RADIUS_M (uniform density). */
export function perTileTarget(n: number): number {
  return Math.ceil((n * TILE_M * TILE_M) / (Math.PI * BUBBLE_RADIUS_M * BUBBLE_RADIUS_M));
}

/** Suffix of an override copy's id (`<person id>~x<k>`). */
export const FILL_ID = "~x";

/**
 * The agents plus, per active tile at ring 0 or 1, copies of the tile's planned people (round robin)
 * until the tile holds perTileTarget(n) people. Deterministic: same tiles, same extras. Tiles with no
 * planned people (no footways) get none.
 */
export function fillCrowd(agents: Agent[], active: ActiveTile[], n: number): Agent[] {
  const target = perTileTarget(n);
  const extra: Agent[] = [];
  for (const t of active) {
    if (t.ring > 1) continue;
    const people = t.content.agents.filter(
      (a) => a.kind === "person" && a.variant !== "cyclist" && a.look === undefined,
    );
    if (people.length === 0) continue;
    for (let e = 0; e < target - people.length; e++) {
      const p = people[e % people.length] as Agent;
      const id = `${p.id}${FILL_ID}${Math.floor(e / people.length)}`;
      extra.push({
        ...p,
        id,
        offset: hash01(id, "fill-offset") * 2 * Math.max(1, p.length),
        speed: p.speed * (0.85 + 0.3 * hash01(id, "fill-speed")),
      });
    }
  }
  return extra.length === 0 ? agents : [...agents, ...extra];
}
