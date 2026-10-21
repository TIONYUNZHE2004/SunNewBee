import { useEffect } from "react";
import { useDevsim } from "./devsimStore";

/** Longest real step fed to the store, so a stalled frame cannot jump the simulation. */
const MAX_DT_S = 0.25;

let owners = 0;
let stop: (() => void) | null = null;

/** One requestAnimationFrame loop advancing the simulation by real dt, only while playing and visible. */
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
      useDevsim.getState().advance(dt);
    }
    if (useDevsim.getState().playing && !document.hidden) {
      last = now;
      raf = requestAnimationFrame(frame);
    } else {
      raf = 0;
      last = null;
    }
  };
  const sync = () => {
    if (useDevsim.getState().playing && !document.hidden) {
      if (!raf) {
        last = null;
        raf = requestAnimationFrame(frame);
      }
    } else halt();
  };
  document.addEventListener("visibilitychange", sync);
  const unsub = useDevsim.subscribe(sync);
  sync();
  return () => {
    document.removeEventListener("visibilitychange", sync);
    unsub();
    halt();
  };
}

/**
 * Frame driver for the Development Simulation (follows `useJourneyDriver`). Mount it from any
 * component that needs the simulation to run (the overlay, the playback bar, the list text
 * version, the 3D mount); only one loop runs however many components mount it.
 */
export function useDevsimDriver(): void {
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
