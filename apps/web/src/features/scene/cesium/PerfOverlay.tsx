import { create } from "zustand";
import { InSlot } from "../../map-ui/mapSlots";
import { useScene } from "../sceneStore";
import type { Tier } from "./stylised/quality";

interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  /** Triangles per frame (three.js engine only; 0 elsewhere). */
  tris: number;
  /** Geometry + instance buffer MB (three.js engine only; 0 elsewhere). */
  gpuMB: number;
  tier: Tier;
  /** True while the median stays under 15 fps although the tier is already Low. */
  slow: boolean;
  update: (p: Partial<Omit<PerfStats, "update">>) => void;
}

export const usePerfStats = create<PerfStats>((set) => ({
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  tris: 0,
  gpuMB: 0,
  tier: "medium",
  slow: false,
  update: (p) => set(p),
}));

/** Dev-facing readout; renders only with `?perf=1`. */
export function PerfOverlay() {
  const s = usePerfStats();
  if (typeof location === "undefined" || !new URLSearchParams(location.search).has("perf"))
    return null;
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-30 rounded-md bg-black/70 px-2 py-1 font-mono text-xs text-white">
      {Math.round(s.fps)} fps · {s.frameMs.toFixed(1)} ms · {s.drawCalls} draws
      {s.tris > 0 ? ` · ${(s.tris / 1e6).toFixed(2)} M tris` : ""}
      {s.gpuMB > 0 ? ` · ${s.gpuMB.toFixed(0)} MB` : ""} · {s.tier}
    </div>
  );
}

/** Offer (never force) the List view when even the Low tier is slow. */
export function SlowBanner() {
  const slow = usePerfStats((s) => s.slow);
  if (!slow) return null;
  return (
    <InSlot name="notes">
      <div
        role="status"
        className="glass flex items-center gap-2 rounded-md px-2 py-1 text-xs text-fg"
      >
        <span>The 3D map is running slowly on this device.</span>
        <button
          type="button"
          className="rounded border border-line px-2 py-0.5 font-medium underline"
          onClick={() => useScene.getState().setView("list")}
        >
          Use the list view
        </button>
      </div>
    </InSlot>
  );
}
