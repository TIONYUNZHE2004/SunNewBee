/**
 * When the engine re-buckets instanced LODs: at most every `intervalMs` while the camera moves, plus
 * one trailing update after it stops (the caller wakes a frame after `trailingMs`).
 */
export function createLodSchedule(intervalMs = 250) {
  let pending = false;
  let forced = false;
  let last = Number.NEGATIVE_INFINITY;
  return {
    moved() {
      pending = true;
    },
    /** The next due() returns true (new instances, new camera). */
    force() {
      pending = true;
      forced = true;
    },
    /** Call once per frame; true means update now (and marks it done). */
    due(now: number): boolean {
      if (!pending || (!forced && now - last < intervalMs)) return false;
      pending = false;
      forced = false;
      last = now;
      return true;
    },
    /** ms until the owed trailing update, or null when none is owed. */
    trailingMs(now: number): number | null {
      return pending ? Math.max(0, intervalMs - (now - last)) : null;
    },
  };
}
