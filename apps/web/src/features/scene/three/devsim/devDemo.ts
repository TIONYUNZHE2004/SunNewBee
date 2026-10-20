import { collectProbe } from "../../../devsim/anchors";
import { useDevsim } from "../../../devsim/devsimStore";
import type { DevelopmentPlan } from "../../../devsim/types";

/**
 * TEMPORARY dev-only entry (3D lane, until FE's `useDevsimDriver` and the AI replay land): the plan
 * cannot arrive through chat yet, so `?devsim=provisional` in a dev build starts the Development
 * Simulation with the provisional fixture. When FE's driver has not installed `window.__devsim`
 * yet, a minimal `{seek, play, pause, total, acts, facts, probe}` and a playback loop stand in.
 * Never active in production builds or tests.
 */
export function devDemoRequested(search: string = location.search): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).get("devsim") === "provisional";
}

export function startDevDemo(): () => void {
  let live = true;
  let raf = 0;
  let installed = false;
  void import("../../../devsim/fixtures/plan.provisional.json").then((m) => {
    if (!live) return;
    const plan = (m.default ?? m) as unknown as DevelopmentPlan;
    useDevsim.getState().start(plan, "dev: provisional fixture");
    const w = window as unknown as { __devsim?: unknown };
    if (w.__devsim) return; // FE's driver owns playback
    installed = true;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = useDevsim.getState();
      if (!s.playing || !s.plan) return;
      if (s.t + dt >= s.plan.total_s) {
        s.setT(s.plan.total_s);
        s.pause();
      } else s.setT(s.t + dt);
    };
    raf = requestAnimationFrame(loop);
    w.__devsim = {
      total: plan.total_s,
      acts: plan.acts,
      facts: plan.facts,
      seek: (t: number) => useDevsim.getState().seek(t),
      play: () => useDevsim.getState().play(),
      pause: () => useDevsim.getState().pause(),
      probe: () => collectProbe(useDevsim.getState().t),
    };
  });
  return () => {
    live = false;
    cancelAnimationFrame(raf);
    if (installed) delete (window as unknown as { __devsim?: unknown }).__devsim;
  };
}
