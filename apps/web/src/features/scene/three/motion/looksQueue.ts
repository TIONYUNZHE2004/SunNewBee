import type { CrowdLook } from "../assets/crowdManifest";
import { measure } from "../stream/streamer";
import type { Agent } from "./agents";
import { type LookJob, type LookMemory, lookJob } from "./crowdRules";

/** Main-thread time (ms) the crowd look search may take per animation frame (GATE AC-D18). */
export const LOOKS_SLICE_MS = 4;
/** User Timing name of one slice of the look search. */
export const LOOKS_MEASURE = "tl:crowd-looks";

/**
 * The crowd look search for each new agent set, run in slices of at most LOOKS_SLICE_MS per frame
 * instead of all at once inside a React effect (GATE AC-D18: a 516-person set cost ~250 ms on the
 * main thread). Requests run strictly in order and every one runs to the end, so the look memory
 * evolves exactly as it did with one `assignLooks` per set: slicing changes when the work happens,
 * never which look anyone gets. Decorative only.
 */
export interface LooksQueue {
  /** Resolves with look index by agent id for `people` once its turn and its slices are done. */
  request(people: readonly Agent[], looks: readonly CrowdLook[]): Promise<Map<string, number>>;
  /** Requests waiting or running (tests). */
  readonly pending: number;
  /** Stops; pending requests reject. */
  dispose(): void;
}

type Schedule = (cb: () => void) => () => void;

const defaultSchedule: Schedule = (cb) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => cb());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
};

export function createLooksQueue(
  memory: LookMemory,
  opts: { budgetMs?: number; schedule?: Schedule; now?: () => number } = {},
): LooksQueue {
  const budget = opts.budgetMs ?? LOOKS_SLICE_MS;
  const schedule = opts.schedule ?? defaultSchedule;
  const now = opts.now ?? (() => performance.now());
  interface Req {
    people: readonly Agent[];
    looks: readonly CrowdLook[];
    resolve(m: Map<string, number>): void;
    reject(e: Error): void;
    job: LookJob | null;
  }
  const queue: Req[] = [];
  let cancel: (() => void) | null = null;
  let disposed = false;

  const slice = () => {
    cancel = null;
    if (disposed) return;
    const t0 = now();
    // One frame's budget, across requests when one finishes early; always some progress.
    let first = true;
    while (queue.length > 0) {
      const r = queue[0] as Req;
      // The job starts (and reads the memory) only after the previous one has written it.
      r.job ??= lookJob(r.people, r.looks, memory);
      const left = budget - (now() - t0);
      if (!first && left <= 0) break;
      first = false;
      if (!r.job.step(Math.max(0, left), now)) break;
      queue.shift();
      r.resolve(r.job.result());
    }
    measure(LOOKS_MEASURE, t0);
    if (queue.length > 0) cancel = schedule(slice);
  };

  return {
    request(people, looks) {
      if (disposed) return Promise.reject(new Error("looks queue disposed"));
      return new Promise((resolve, reject) => {
        queue.push({ people, looks, resolve, reject, job: null });
        cancel ??= schedule(slice);
      });
    },
    get pending() {
      return queue.length;
    },
    dispose() {
      disposed = true;
      cancel?.();
      cancel = null;
      for (const r of queue.splice(0)) r.reject(new Error("looks queue disposed"));
    },
  };
}
