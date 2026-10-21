import { isDemoPreset } from "../demo/demoFlag";
import { registerDemo } from "../demo/demoHook";
import { moveInCounter } from "../scene/three/devsim/setPieces";
import { collectProbe, hasProbe } from "./anchors";
import { buildBeatsAt, hudAt } from "./buildModel";
import { useDevsim } from "./devsimStore";
import { isBuildPlan, stateAt } from "./timeline";
import type { Act, DevsimFacts, Probe, StateAt } from "./types";

/** `window.__devsim`, as the prototype's (spec §4, §5.3), plus `probe()` and `state()`. */
export interface DevsimHook {
  seek: (s: number) => void;
  play: () => void;
  pause: () => void;
  /** Screen seconds of the run (45), or 0 without a plan. */
  readonly total: number;
  readonly acts: Act[];
  readonly facts: DevsimFacts | null;
  /** Projected rects (3D part + DOM part) and flow samples at the current t (§10). */
  probe: () => Probe;
  /** Current screen time and the timeline state, or null without a plan. */
  state: () => (StateAt & { t: number; playing: boolean }) | null;
}

export function createDevsimHook(): DevsimHook {
  const s = () => useDevsim.getState();
  return {
    seek: (x) => s().seek(x),
    play: () => s().play(),
    pause: () => s().pause(),
    get total() {
      return s().plan?.total_s ?? 0;
    },
    get acts() {
      return s().plan?.acts ?? [];
    },
    get facts() {
      return s().plan?.facts ?? null;
    },
    probe: () => {
      const { plan, t } = s();
      const p = collectProbe(t);
      if (!plan) return p;
      // the lit share the tower draws: the move-in's floor-by-floor share in schedule mode (C10),
      // the timeline's otherwise (`litShareAt` returns it unchanged in legacy mode)
      const expected = moveInCounter(plan, t).litShare;
      p.expectedWindowsLitFraction = expected;
      // Only without a 3D part is the timeline's value reported as the drawn one (List view);
      // a registered scene part's value is never masked, so a broken render shows (Q4).
      if (!hasProbe("scene")) p.windowsLitFraction = expected;
      return p;
    },
    state: () => {
      const { plan, t, playing } = s();
      return plan ? { ...stateAt(t, plan), t, playing } : null;
    },
  };
}

/** Exposes window.__devsim in dev and test builds and in the demo preset; never on a normal production load. */
export function installDevsimHook(
  opts: { dev: boolean; search?: string },
  target: { __devsim?: DevsimHook } = globalThis as unknown as { __devsim?: DevsimHook },
): boolean {
  if (!opts.dev && !isDemoPreset(opts.search)) return false;
  target.__devsim = createDevsimHook();
  return true;
}

/** The `data-beat` ids of the overlay elements on screen now (spec §7: visible overlay ids). */
function visibleBeats(doc: Document | undefined): string[] {
  if (!doc) return [];
  const out = new Set<string>();
  for (const el of doc.querySelectorAll<HTMLElement>("[data-beat]")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) out.add(el.dataset.beat as string);
  }
  return [...out].sort();
}

/**
 * `window.__tl.demo.state()` for "bld" (spec §7): screen time, beat ids (§6.3), the overlay ids on
 * screen, the HUD counters, and the screen boxes AC-W6 compares (`towerBbox` from the 3D probe,
 * `panelLeft` the Impact Brief's left edge, both CSS px relative to the map stage). The 3D lane adds
 * its own fields (crane, rain, lorries, …) through `registerDemoState("bld", …)`.
 */
export function buildDemoState(): Record<string, unknown> {
  const { plan, t, playing } = useDevsim.getState();
  if (!plan) return { t, playing, total: 0, plan: false };
  const st = stateAt(t, plan);
  const probe = collectProbe(t);
  const build = isBuildPlan(plan);
  const hud = build ? hudAt(plan, t) : null;
  return {
    plan: true,
    t,
    playing,
    total: plan.total_s,
    act: st.act,
    beats: build ? buildBeatsAt(plan, t) : [],
    overlays: visibleBeats(typeof document === "undefined" ? undefined : document),
    bubbles: st.bubbles.map((b) => b.n),
    hud: hud
      ? {
          monthIndex: hud.at.monthIndex,
          ym: hud.at.ym,
          floors: hud.at.floors,
          costRm: hud.at.costRm,
          daysLost: hud.at.daysLost,
          movedIn: hud.moveIn?.n ?? null,
        }
      : null,
    floorsBuilt: st.floorsBuilt,
    windowsLitFraction: st.windowsLitFraction,
    occupancy: st.occupancy,
    brief: st.brief,
    viewShiftPx: useDevsim.getState().viewShiftPx,
    towerBbox: probe.rects.tower ?? null,
    panelLeft: probe.rects.brief?.x ?? null,
  };
}

/** Registers the building playback as the hook's "bld" demo (done once at module load). */
export function registerBuildDemo(): () => void {
  const s = () => useDevsim.getState();
  return registerDemo("bld", {
    seek: (x) => s().seek(x),
    play: () => s().play(),
    pause: () => s().pause(),
    state: buildDemoState,
  });
}

registerBuildDemo();
