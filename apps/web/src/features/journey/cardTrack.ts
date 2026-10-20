import {
  type FollowScene,
  type JourneyCamMode,
  journeyCameraAt,
} from "../scene/three/journey/followRig";
import {
  type CardViewport,
  cardViewportWith,
  lockedSpot,
  type PlacementLock,
  placementLock,
  type Rect,
} from "./cardPlacement";

/**
 * Her body around her ground point for the card's hold decision (m): her drawn height is ~2.2 m
 * and her radius ~0.9 m (the walker; seated she leans), boxed with room to spare so a rule chosen
 * clear of this box stays clear of her drawn box, with the same 6 px screen pad as `heroScreenRect`.
 */
export const CARD_HERO_BOX = { radiusM: 0.9, topM: 2.6, padPx: 6 } as const;

/** The screen geometry an event card is placed from: its anchor and her body (viewport CSS px). */
export interface CardGeometry {
  anchor: { x: number; y: number } | null;
  hero: Rect | null;
}

/**
 * The card geometry the pure journey camera shows at trip time t (no drawn state): the event's
 * marker and her body box projected from `journeyCameraAt(sc, t, mode)` through the scene's view.
 * Null without a view, a marker or a camera (free mode).
 */
export function cardGeometryAt(
  sc: FollowScene,
  t: number,
  eventIndex: number,
  mode: JourneyCamMode,
): CardGeometry | null {
  const view = sc.view;
  const mk = sc.markerOf?.(eventIndex);
  const pose = journeyCameraAt(sc, t, mode);
  if (!view || !mk || !pose) return null;
  const a = view.project(pose, mk);
  const h = sc.heroAt?.(t);
  let hero: Rect | null = null;
  if (h) {
    const { radiusM: r, topM, padPx: pad } = CARD_HERO_BOX;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    let behind = false;
    for (const y of [0, topM])
      for (const dx of [-r, r])
        for (const dz of [-r, r]) {
          const q = view.project(pose, [h[0] + dx, y, h[1] + dz]);
          if (!q) behind = true;
          else {
            x0 = Math.min(x0, q[0]);
            x1 = Math.max(x1, q[0]);
            y0 = Math.min(y0, q[1]);
            y1 = Math.max(y1, q[1]);
          }
        }
    if (!behind) hero = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
  return { anchor: a ? { x: a[0], y: a[1] } : null, hero };
}

/** Trip seconds between the samples a hold's card rule is checked at. */
export const CARD_LOCK_STEP_S = 0.1;

/**
 * A hold's card rule (`PlacementLock`), chosen once from the hold's own geometry on the pure
 * journey camera: the rule `placeCard` picks at each sample of the hold (every CARD_LOCK_STEP_S)
 * is a candidate, and the one whose spot stays clear of her, the marker and the mini-map at the
 * most samples wins (ties: the one picked nearest the middle of the hold). The card then glides
 * with that rule the whole hold (iteration 2: re-deciding every frame, it jumped sides of her in
 * one frame while the hold fit eased the camera in). Pure: the same hold, view and card size give
 * the same rule however the hold was reached (AC-D17). Null without a hold, a view or a camera.
 */
export function holdCardLock(
  sc: FollowScene,
  eventIndex: number,
  mode: JourneyCamMode,
  card: { w: number; h: number },
  viewport: CardViewport,
  margin = 12,
): PlacementLock | null {
  const ph = sc.timeline.phases.find((p) => p.kind === "event" && p.eventIndex === eventIndex);
  if (!ph) return null;
  const n = Math.max(1, Math.round((ph.t1 - ph.t0) / CARD_LOCK_STEP_S));
  const views: { t: number; vp: CardViewport; anchor: CardGeometry["anchor"] }[] = [];
  for (let i = 0; i <= n; i++) {
    // the hold is [t0, t1): the last sample just inside it
    const t = Math.min(ph.t0 + (i * (ph.t1 - ph.t0)) / n, ph.t1 - 1e-3);
    const g = cardGeometryAt(sc, t, eventIndex, mode);
    if (g) views.push({ t, vp: cardViewportWith(viewport, g.hero, g.anchor), anchor: g.anchor });
  }
  const mid = (ph.t0 + ph.t1) / 2;
  let best: { lock: PlacementLock; ok: number; d: number } | null = null;
  const seen = new Set<string>();
  for (const v of views) {
    const lock = placementLock(v.anchor, card, v.vp, margin);
    if (!lock) continue;
    const key = JSON.stringify(lock);
    if (seen.has(key)) continue;
    seen.add(key);
    const ok = views.filter((u) => lockedSpot(u.anchor, card, u.vp, lock, margin)).length;
    const d = Math.abs(v.t - mid);
    if (!best || ok > best.ok || (ok === best.ok && d < best.d)) best = { lock, ok, d };
  }
  return best?.lock ?? null;
}
