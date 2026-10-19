import type { Tier } from "../../shared/quality";
import type { TileRoofs } from "../facade/roofLayer";
import { whenIdle } from "../scene/idle";
import { measure, PLAN_MEASURE, type Ring, type TileContent, timed } from "./streamer";
import {
  NO_FACADES,
  NO_ROOFS,
  type PlanReply,
  type PlanRequest,
  planTile,
  type TileInputs,
  toWire,
  type WireContent,
  warmPlanners,
} from "./tilePlan";
import type { Tile, TileKey } from "./tiles";

/**
 * Plans tiles off the main thread (a module Worker) when it can, on the main thread otherwise.
 * At most one plan is in flight: a newer `plan` call supersedes a waiting one (its promise rejects
 * with a `Superseded` error and its late result is dropped).
 */
export interface PlanClient {
  plan(tile: Tile, ring: Ring, tier: Tier): Promise<TileContent>;
  readonly mode: "worker" | "main";
  dispose(): void;
}

/** The rejection of a superseded (or disposed) plan: expected, never an error to report. */
export class Superseded extends Error {
  constructor(what = "superseded") {
    super(what);
    this.name = "Superseded";
  }
}

/** User Timing name of the Worker's plan time (not a main-thread task: no `tl:stream-` prefix). */
export const WORKER_PLAN_MEASURE = "tl:worker-plan";
/** User Timing name of handling one Worker reply on the main thread (decode and unpack). */
export const REPLY_MEASURE = "tl:stream-reply";
/** User Timing name of the one-off `init` post (the inputs' structured clone, at world load). */
export const INIT_MEASURE = "tl:stream-init";

/**
 * A Worker reply back to `TileContent`, with the identities the merged layers key on restored: the
 * facade list is the inputs' own (or the shared empty list), and the roof plan of a tile is the
 * first one received for that key (`roofsByKey`; roof plans depend only on the key and inputs).
 */
export function unpackContent(
  w: WireContent,
  key: TileKey,
  inputs: TileInputs,
  roofsByKey: Map<TileKey, TileRoofs>,
): TileContent {
  const { facades, ...rest } = w;
  const content: TileContent = { ...rest };
  if (facades) content.facades = inputs.facades?.get(key) ?? NO_FACADES;
  else delete content.facades;
  if (w.roofs) {
    if (w.roofs.items.length + w.roofs.decks.length === 0) content.roofs = NO_ROOFS;
    else {
      const known = roofsByKey.get(key);
      if (known) content.roofs = known;
      else roofsByKey.set(key, w.roofs);
    }
  }
  return content;
}

/** The default Worker (Vite bundles `plan.worker.ts` as a module worker); null without Worker. */
function defaultWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./plan.worker.ts", import.meta.url), { type: "module" });
}

interface Req {
  seq: number;
  tile: Tile;
  ring: Ring;
  tier: Tier;
  resolve: (c: TileContent) => void;
  reject: (e: Error) => void;
  superseded: boolean;
}

/**
 * A plan client for one input set. Worker mode posts the inputs once (`init`), then one `plan` at a
 * time. Main mode (no `Worker`, construction threw, or after the Worker's first `error`) plans on
 * the main thread, synchronously inside `plan` (one tile per call: the P4 8 ms per-tile rule) and
 * times it as `tl:stream-plan`. A Worker `error` switches the session to main and re-plans the
 * pending tile there.
 */
export function createPlanClient(
  inputs: TileInputs,
  opts: { worker?: () => Worker | null } = {},
): PlanClient {
  let worker: Worker | null = null;
  try {
    worker = (opts.worker ?? defaultWorker)();
  } catch {
    worker = null;
  }
  let mode: "worker" | "main" = worker ? "worker" : "main";
  let seq = 0;
  let disposed = false;
  /** Posted to the Worker, waiting for its reply. */
  let inflight: Req | null = null;
  /** The newest request, waiting for the in-flight one's reply (it supersedes it). */
  let queued: Req | null = null;
  const roofsByKey = new Map<TileKey, TileRoofs>();
  /** After a Worker failure: the main thread's planners are being warmed (plans wait in `queued`). */
  let warming = false;
  let cancelWarm: (() => void) | null = null;

  const planMain = (r: Req) => {
    try {
      const t0 = performance.now();
      const content = planTile(inputs, r.tile, r.ring, r.tier);
      measure(PLAN_MEASURE, t0);
      r.resolve(content);
    } catch (err) {
      r.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };
  const post = (r: Req) => {
    inflight = r;
    const msg: PlanRequest = {
      type: "plan",
      key: r.tile.key,
      ring: r.ring,
      tier: r.tier,
      seq: r.seq,
    };
    worker?.postMessage(msg);
  };
  const stopWorker = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };
  /**
   * The Worker failed: plan on the main thread for the rest of the session. Its planners are cold
   * (the Worker warmed its own), so they are warmed first in an idle callback, outside any streamed
   * frame; then the pending tile (the newest live request) is planned there.
   */
  const toMain = () => {
    if (mode === "main") return;
    stopWorker();
    mode = "main";
    queued ??= inflight && !inflight.superseded ? inflight : null;
    inflight = null;
    warming = true;
    cancelWarm = whenIdle(() => {
      cancelWarm = null;
      if (disposed) return;
      warmPlanners(inputs);
      warming = false;
      const r = queued;
      queued = null;
      if (r) planMain(r);
    });
  };

  if (worker) {
    const w = worker;
    // One reply on the main thread, timed as `tl:stream-reply`: reading `e.data` decodes the
    // structured clone (lazily, here), then the content is unpacked.
    w.onmessage = (e: MessageEvent<PlanReply>) => {
      const t0 = performance.now();
      const planMs = timed(REPLY_MEASURE, () => {
        const reply = e.data;
        const r = inflight;
        if (!r || reply.seq !== r.seq) return null;
        inflight = null;
        let ms: number | null = null;
        if (!r.superseded) {
          if ("error" in reply) r.reject(new Error(reply.error));
          else {
            ms = reply.ms;
            r.resolve(unpackContent(reply.content, r.tile.key, inputs, roofsByKey));
          }
        }
        const next = queued;
        queued = null;
        if (next && !disposed) post(next);
        return ms;
      });
      // The Worker's own plan time, for the fly report (outside the reply's main-thread measure).
      if (planMs !== null) {
        try {
          performance.measure?.(WORKER_PLAN_MEASURE, { start: t0 - planMs, end: t0 });
        } catch {
          /* User Timing unavailable */
        }
      }
    };
    // A reply that cannot be decoded: like a Worker error.
    w.onmessageerror = () => {
      console.warn("city: plan worker reply unreadable; planning on the main thread");
      toMain();
    };
    w.onerror = (e: Event) => {
      e.preventDefault?.();
      console.warn("city: plan worker failed; planning on the main thread");
      toMain();
    };
    try {
      const t0 = performance.now();
      const init: PlanRequest = { type: "init", inputs: toWire(inputs) };
      w.postMessage(init);
      measure(INIT_MEASURE, t0);
    } catch {
      // The inputs cannot be cloned (never expected): plan on the main thread.
      stopWorker();
      mode = "main";
    }
  }

  return {
    get mode() {
      return mode;
    },
    plan(tile, ring, tier) {
      if (disposed) return Promise.reject(new Superseded("disposed"));
      return new Promise<TileContent>((resolve, reject) => {
        const r: Req = { seq: ++seq, tile, ring, tier, resolve, reject, superseded: false };
        if (mode === "main" && !warming) {
          planMain(r);
          return;
        }
        if (queued) {
          queued.superseded = true;
          queued.reject(new Superseded());
        }
        if (mode === "main") {
          // Warming after a Worker failure: the newest request waits for the warm planners.
          queued = r;
          return;
        }
        if (inflight) {
          if (!inflight.superseded) {
            inflight.superseded = true;
            inflight.reject(new Superseded());
          }
          queued = r;
          return;
        }
        post(r);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelWarm?.();
      cancelWarm = null;
      stopWorker();
      for (const r of [inflight, queued]) {
        if (r && !r.superseded) {
          r.superseded = true;
          r.reject(new Superseded("disposed"));
        }
      }
      inflight = null;
      queued = null;
    },
  };
}
