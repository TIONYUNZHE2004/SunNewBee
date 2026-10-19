import type { Tier } from "../../shared/quality";
import type { Placement } from "../assets/fit";
import type { FacadeBuilding } from "../facade/facadeLayer";
import type { TileRoofs } from "../facade/roofLayer";
import type { Ribbon } from "../ground/ribbons";
import type { Agent } from "../motion/agents";
import type { Site } from "../props/construction";
import type { SignPlacement } from "../signs/signPlan";
import type { PlanClient } from "./planClient";
import { activeTiles, RING2_MAX_RANGE_M, type Tile, type TileKey } from "./tiles";

export type Ring = 0 | 1 | 2;

/** What one planned tile contributes to the merged decorative layers. Pure data (no GPU objects yet). */
export interface TileContent {
  /** Kit placements by `${asset}/${variant}` (trees, lamp posts, furniture, construction). */
  kits: Map<string, Placement[]>;
  /** The lamp posts among `kits` (furniture/lamp_single + lamp_double): their light pools. */
  lamps: Placement[];
  agents: Agent[];
  signs: SignPlacement[];
  ribbons: Ribbon[];
  verges?: { strips: Float32Array; skirts?: Float32Array; shrubs: Placement[] }; // Task 9
  parking?: { stalls: Float32Array; cars: Placement[] }; // Task 10
  tracks?: Float32Array; // Task 10 construction tracks
  /** Task 10: the construction sites touching this tile, tinted gravel whole (deduplicated by id). */
  gravel?: Site[];
  /** Procedural facade inputs of the extrusions in this tile; planned for rings 0-1 only (P4-H). */
  facades?: FacadeBuilding[];
  /** Dressed roofs and podium decks of the large roofs in this tile; rings 0-1 only (Task 8). */
  roofs?: TileRoofs;
  dispose?(): void;
}

export interface ActiveTile {
  key: TileKey;
  tile: Tile;
  /** The ring the tile is at now (its content may still be a stale plan for another ring). */
  ring: Ring;
  content: TileContent;
}

export interface StreamStats {
  /** Tiles planned since creation. */
  planned: number;
  /** ms of the last plan, and the worst so far. */
  lastMs: number;
  maxMs: number;
  /** Plans that took longer than `budgetMs` (still one tile in that call). */
  overBudget: number;
}

export interface Streamer {
  /**
   * Plans at most one tile, then rebuilds the active list. `changed`: the active list differs
   * (tiles, rings or content). `pending`: tiles still wait for a plan (call again on a later tick).
   */
  update(target: { x: number; z: number }, rangeM: number): { changed: boolean; pending: boolean };
  /** Tiles with content, ring 0 first (near content appears first). */
  active(): ActiveTile[];
  /** Invalidates every tile; each is re-planned on later updates (its old content shows until then). */
  setTier(t: Tier): void;
  /** Same as a tier change for new input data (e.g. the manifest or the facade inputs arrived). */
  invalidate(): void;
  stats(): StreamStats;
  dispose(): void;
}

export type TilePlanner = (tile: Tile, ring: Ring, tier: Tier) => TileContent;
/** A synchronous planner (the main-thread path). */
export type PlanFn = TilePlanner;

interface Entry {
  id: string;
  key: TileKey;
  content: TileContent;
  tier: Tier;
  gen: number;
}

interface Job {
  id: string;
  key: TileKey;
  tile: Tile;
  ring: Ring;
  tier: Tier;
  gen: number;
}

/** What a tile whose plan failed shows: nothing (frozen, never disposed). */
const EMPTY: TileContent = Object.freeze({
  kits: new Map(),
  lamps: [],
  agents: [],
  signs: [],
  ribbons: [],
}) as TileContent;

const idOf = (key: TileKey, ring: Ring) => `${key}|${ring}`;
/** User Timing names for the browser run: one tile plan, and one merge of the streamed layers. */
export const PLAN_MEASURE = "tl:stream-plan";
export const MERGE_MEASURE = "tl:stream-merge";
/** User Timing name of a render-phase union of the active tiles' content (one merged list). */
export const UNION_MEASURE = "tl:stream-union";
/** User Timing name of the first render after a streamed layer swap (its GPU uploads). */
export const UPLOAD_MEASURE = "tl:stream-upload";
/** `performance.measure(name)` from `startMs` to now, where User Timing exists (never throws). */
export function measure(name: string, startMs: number): void {
  try {
    performance.measure?.(name, { start: startMs, end: performance.now() });
  } catch {
    /* User Timing unavailable: timing only */
  }
}
/** Runs `fn` and times it as the User Timing measure `name` (one main-thread streaming task). */
export function timed<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    measure(name, t0);
  }
}
const RINGS: Ring[] = [0, 1, 2];
/** Kits drawn beyond RING2_MAX_RANGE_M: trees only (the global "trees and roads only" rule). */
const isTreeKit = (k: string) => k.startsWith("trees/");

const farViews = new WeakMap<TileContent, TileContent>();
/**
 * Beyond RING2_MAX_RANGE_M only trees and roads show: the same content without lamps, furniture,
 * construction, agents, signs, facades, roofs or (later) verges and parking. Memoised per content, so
 * the active list keeps its identity between updates.
 */
export function farView(c: TileContent): TileContent {
  let v = farViews.get(c);
  if (!v) {
    const kits = new Map<string, Placement[]>();
    for (const [k, l] of c.kits) if (isTreeKit(k)) kits.set(k, l);
    v = { kits, lamps: [], agents: [], signs: [], ribbons: c.ribbons };
    farViews.set(c, v);
  }
  return v;
}

/**
 * The township streamer: which 250 m tiles are around the camera target (ring 0 first), their
 * planned content (an LRU of `lru` plans keyed by tile and ring), and at most ONE plan per
 * `update` (the hitch budget: no frame plans more than one tile, however slow the planner).
 *
 * A tile whose ring changed, or whose plan is stale (tier change, `invalidate`), keeps showing its
 * last content until the new plan replaces it, so panning and tier switches never blank the ground.
 * Plan order: tiles with nothing to show first, then stale or other-ring tiles, each ring 0 first.
 * Evicted and replaced content is disposed exactly once; shown content is never evicted.
 *
 * `plan` is a synchronous planner (one plan inside `update`, timed as `tl:stream-plan`) or a
 * `PlanClient` (the Worker path): then `update` starts at most one plan, keeps it in flight across
 * updates (superseding it only when it no longer matches), and applies a result on a later
 * `update` only if its tile key, ring, tier and inputs still match; anything else is disposed.
 */
export function createStreamer(
  plan: PlanFn | PlanClient,
  opts: {
    lru?: number;
    budgetMs?: number;
    initialTier?: Tier;
    /** Async client only: a result arrived (call `update` soon to apply it). */
    onReady?: () => void;
  } = {},
): Streamer {
  const lru = opts.lru ?? 64;
  const budgetMs = opts.budgetMs ?? 8;
  let tier: Tier = opts.initialTier ?? "medium";
  let gen = 0;
  /** Insertion order = recency (oldest first). */
  const cache = new Map<string, Entry>();
  let shown: ActiveTile[] = [];
  let shownIds = new Set<string>();
  const stats: StreamStats = { planned: 0, lastMs: 0, maxMs: 0, overBudget: 0 };
  let disposed = false;
  /** Async client: the one plan in flight, and the results waiting for the next `update`. */
  let inflight: Job | null = null;
  const ready: { job: Job; content: TileContent }[] = [];

  const fresh = (e: Entry | undefined): boolean => !!e && e.tier === tier && e.gen === gen;
  const touch = (e: Entry) => {
    cache.delete(e.id);
    cache.set(e.id, e);
  };
  const release = (e: Entry) => {
    cache.delete(e.id);
    e.content.dispose?.();
  };
  /** Drops every stale entry nobody is looking at (it can never become fresh again). */
  const dropStale = () => {
    for (const e of [...cache.values()]) if (!fresh(e) && !shownIds.has(e.id)) release(e);
  };
  const evict = () => {
    if (cache.size <= lru) return;
    for (const e of [...cache.values()]) {
      if (cache.size <= lru) break;
      if (!shownIds.has(e.id)) release(e);
    }
  };
  /** What to show for a tile: its exact fresh plan, else a fresh plan of another ring, else any. */
  const best = (key: TileKey, ring: Ring): Entry | undefined => {
    const exact = cache.get(idOf(key, ring));
    if (fresh(exact)) return exact;
    let stale: Entry | undefined = exact;
    for (const r of RINGS) {
      if (r === ring) continue;
      const e = cache.get(idOf(key, r));
      if (fresh(e)) return e;
      stale ??= e;
    }
    return stale;
  };

  /** A plan result into the cache (replacing, and disposing, any older plan of that tile and ring). */
  const store = (job: Pick<Job, "id" | "key" | "tier" | "gen">, content: TileContent) => {
    const old = cache.get(job.id);
    if (old) release(old);
    cache.set(job.id, { id: job.id, key: job.key, content, tier: job.tier, gen: job.gen });
  };
  const start = (client: PlanClient, job: Job) => {
    inflight = job;
    client.plan(job.tile, job.ring, job.tier).then(
      (content) => {
        if (inflight === job) inflight = null;
        if (disposed) {
          content.dispose?.();
          return;
        }
        ready.push({ job, content });
        opts.onReady?.();
      },
      (err: unknown) => {
        if (inflight === job) inflight = null;
        if (disposed || (err instanceof Error && err.name === "Superseded")) return;
        // A planner failure: the tile shows nothing (decorative) rather than re-planning forever.
        console.warn(`city: tile ${job.key} plan failed: ${String(err)}`);
        ready.push({ job, content: EMPTY });
        opts.onReady?.();
      },
    );
  };

  return {
    update(target, rangeM) {
      if (disposed) return { changed: false, pending: false };
      const far = rangeM > RING2_MAX_RANGE_M;
      const want = activeTiles(target, rangeM);
      const wantedNow = new Set(want.map((w) => idOf(w.tile.key, w.ring)));
      // Async results: applied only if their tile is still wanted at that ring, for this tier and
      // these inputs; anything else is dropped (and disposed, exactly once).
      for (const r of ready.splice(0)) {
        if (r.job.tier === tier && r.job.gen === gen && wantedNow.has(r.job.id)) {
          stats.planned++;
          store(r.job, r.content);
        } else r.content.dispose?.();
      }
      // One plan, nearest ring first (near detail first); within a ring, a tile with nothing to
      // show before a tile showing stale / other-ring content.
      const empty: ({ tile: Tile; ring: Ring } | undefined)[] = [];
      const stale: ({ tile: Tile; ring: Ring } | undefined)[] = [];
      let missing = 0;
      for (const w of want) {
        if (fresh(cache.get(idOf(w.tile.key, w.ring)))) continue;
        missing++;
        if (best(w.tile.key, w.ring)) stale[w.ring] ??= w;
        else empty[w.ring] ??= w;
      }
      let job: { tile: Tile; ring: Ring } | undefined;
      for (const r of RINGS) {
        job = empty[r] ?? stale[r];
        if (job) break;
      }
      if (typeof plan === "function") {
        if (job) {
          const t0 = performance.now();
          const content = plan(job.tile, job.ring, tier);
          const ms = performance.now() - t0;
          measure(PLAN_MEASURE, t0);
          stats.planned++;
          stats.lastMs = ms;
          stats.maxMs = Math.max(stats.maxMs, ms);
          if (ms > budgetMs) stats.overBudget++;
          store({ id: idOf(job.tile.key, job.ring), key: job.tile.key, tier, gen }, content);
          missing--;
        }
      } else {
        // At most one plan in flight. One that no longer matches (its tile left, or the tier or
        // inputs changed) is superseded by the next job; its late result is dropped either way.
        const current = (j: Job) => j.tier === tier && j.gen === gen && wantedNow.has(j.id);
        if (job) {
          const id = idOf(job.tile.key, job.ring);
          if (!inflight || !current(inflight))
            start(plan, { id, key: job.tile.key, tile: job.tile, ring: job.ring, tier, gen });
        }
      }
      const next: ActiveTile[] = [];
      for (const w of want) {
        const e = best(w.tile.key, w.ring);
        if (!e) continue;
        next.push({
          key: w.tile.key,
          tile: w.tile,
          ring: w.ring,
          content: far ? farView(e.content) : e.content,
        });
      }
      // Recency: ring 0 most recent.
      for (let i = next.length - 1; i >= 0; i--) {
        const n = next[i] as ActiveTile;
        const e = best(n.key, n.ring);
        if (e) touch(e);
      }
      const changed =
        next.length !== shown.length ||
        next.some((n, i) => {
          const s = shown[i] as ActiveTile;
          return s.key !== n.key || s.ring !== n.ring || s.content !== n.content;
        });
      shown = next;
      shownIds = new Set(next.map((n) => (best(n.key, n.ring) as Entry).id));
      // A replaced stale plan that is no longer shown goes now; then the LRU bound.
      dropStale();
      evict();
      return { changed, pending: missing > 0 || inflight !== null || ready.length > 0 };
    },
    active: () => shown,
    setTier(t) {
      if (disposed || t === tier) return;
      tier = t;
      gen++;
      dropStale();
    },
    invalidate() {
      if (disposed) return;
      gen++;
      dropStale();
    },
    stats: () => ({ ...stats }),
    dispose() {
      if (disposed) return;
      disposed = true;
      inflight = null;
      for (const r of ready.splice(0)) r.content.dispose?.();
      for (const e of [...cache.values()]) release(e);
      shown = [];
      shownIds = new Set();
    },
  };
}
