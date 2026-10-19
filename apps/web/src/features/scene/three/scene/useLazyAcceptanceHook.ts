import { useEffect } from "react";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { acceptanceEnabled } from "./acceptanceFlag";

/**
 * `window.__tlAcceptance` (dev or `?acceptance=1`), with the hook module (and the hero lab) loaded
 * on demand, so test-only code stays out of the production entry chunk (final review).
 */
export function useLazyAcceptanceHook(engine: Engine | null, frame: LocalFrame | null): void {
  useEffect(() => {
    if (!engine || !frame) return;
    if (!acceptanceEnabled(import.meta.env.DEV, location.search)) return;
    let live = true;
    let off: (() => void) | undefined;
    void import("./useAcceptanceHook").then((m) => {
      if (live) off = m.installAcceptanceHook(engine, frame);
    });
    return () => {
      live = false;
      off?.();
    };
  }, [engine, frame]);
}
