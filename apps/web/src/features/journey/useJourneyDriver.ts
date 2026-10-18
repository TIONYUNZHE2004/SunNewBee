import { useEffect } from "react";
import { useJourney } from "./journeyStore";

/** Longest real step fed to the store, so a stalled frame cannot jump the trip. */
const MAX_DT_S = 0.25;

let owners = 0;
let stop: (() => void) | null = null;

/** One requestAnimationFrame loop advancing the journey by real dt. It runs only while playing and the tab is visible. */
function startLoop(): () => void {
  let raf = 0;
  let last: number | null = null;
  const halt = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = null;
  };
  const frame = (now: number) => {
    // raf stays non-zero while advancing, so the store subscription below does not schedule a second frame
    if (last !== null) {
      const dt = Math.min(MAX_DT_S, Math.max(0, (now - last) / 1000));
      useJourney.getState().advance(dt);
    }
    if (useJourney.getState().playing && !document.hidden) {
      last = now;
      raf = requestAnimationFrame(frame);
    } else {
      raf = 0;
      last = null;
    }
  };
  const sync = () => {
    if (useJourney.getState().playing && !document.hidden) {
      if (!raf) {
        last = null;
        raf = requestAnimationFrame(frame);
      }
    } else halt();
  };
  document.addEventListener("visibilitychange", sync);
  const unsub = useJourney.subscribe(sync);
  sync();
  return () => {
    document.removeEventListener("visibilitychange", sync);
    unsub();
    halt();
  };
}

/**
 * Frame driver for the journey player. Mount it from any component that needs the trip to run
 * (the controls, the 3D scene); only one loop runs however many components mount it.
 */
export function useJourneyDriver(): void {
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
