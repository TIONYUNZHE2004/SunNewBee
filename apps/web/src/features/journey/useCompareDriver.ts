import { useEffect } from "react";
import { useCompare } from "./compareStore";

/** Longest real step fed to the store, so a stalled frame cannot jump the playback. */
const MAX_DT_S = 0.25;

let owners = 0;
let stop: (() => void) | null = null;

/** One requestAnimationFrame loop advancing the compare by real dt, only while playing and visible. */
function startLoop(): () => void {
  let raf = 0;
  let last: number | null = null;
  const halt = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = null;
  };
  const frame = (now: number) => {
    if (last !== null) {
      const dt = Math.min(MAX_DT_S, Math.max(0, (now - last) / 1000));
      useCompare.getState().advance(dt);
    }
    if (useCompare.getState().playing && !document.hidden) {
      last = now;
      raf = requestAnimationFrame(frame);
    } else {
      raf = 0;
      last = null;
    }
  };
  const sync = () => {
    if (useCompare.getState().playing && !document.hidden) {
      if (!raf) {
        last = null;
        raf = requestAnimationFrame(frame);
      }
    } else halt();
  };
  document.addEventListener("visibilitychange", sync);
  const unsub = useCompare.subscribe(sync);
  sync();
  return () => {
    document.removeEventListener("visibilitychange", sync);
    unsub();
    halt();
  };
}

/**
 * Frame driver for the compare playback (same pattern as `useJourneyDriver`): mount it from any
 * component that needs the playback to run; one ref-counted loop however many mount it.
 */
export function useCompareDriver(): void {
  useEffect(() => {
    if (owners++ === 0) stop = startLoop();
    return () => {
      if (--owners === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
}
