import { useEffect } from "react";
import { useJourney } from "./journeyStore";

/** Longest real step fed to the store, so a stalled frame cannot jump the trip. */
const MAX_DT_S = 0.25;

let owners = 0;
let stop: (() => void) | null = null;

/** One requestAnimationFrame loop advancing the journey by real dt while it plays. Paused while the tab is hidden. */
function startLoop(): () => void {
  let raf = 0;
  let last: number | null = null;
  const frame = (now: number) => {
    raf = 0;
    if (last !== null) {
      const dt = Math.min(MAX_DT_S, Math.max(0, (now - last) / 1000));
      useJourney.getState().advance(dt);
    }
    last = now;
    raf = requestAnimationFrame(frame);
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = null;
    } else if (!raf) {
      last = null;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (!document.hidden) raf = requestAnimationFrame(frame);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (raf) cancelAnimationFrame(raf);
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
