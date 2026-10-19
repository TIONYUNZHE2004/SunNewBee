import { useEffect } from "react";
import type { Engine } from "../engine";
import type { Boundary } from "../ground/boundary";

/**
 * The diorama slab (A-T4, display only): set on the engine whenever the world has an outline; a
 * world without one keeps the rectangular base plane. Removed on unmount or engine switch.
 */
export function useSlab({
  engine,
  boundary,
}: {
  engine: Engine | null;
  boundary: Boundary | null;
}) {
  useEffect(() => {
    if (!engine || !boundary) return;
    engine.setSlab(boundary);
    return () => engine.setSlab(null);
  }, [engine, boundary]);
}
