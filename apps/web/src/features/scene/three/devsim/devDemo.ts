import { collectProbe } from "../../../devsim/anchors";
import { useDevsim } from "../../../devsim/devsimStore";
import type { DevelopmentPlan } from "../../../devsim/types";

/**
 * TEMPORARY dev-only entry (3D lane, until FE's `useDevsimDriver` and the AI replay land): the plan
 * cannot arrive through chat yet, so `?devsim=provisional` in a dev build starts the Development
 * Simulation with a fixture plan (`plan.elmina.json` when present, else the provisional one). When FE's driver has not installed `window.__devsim`
 * yet, a minimal `{seek, play, pause, total, acts, facts, probe}` and a playback loop stand in.
 * `plan.elmina.json` is the 45 s building plan (C7), so the set pieces and move-in play on it. Never
 * active in production builds or tests.
 */
export function devDemoRequested(search: string = location.search): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).get("devsim") === "provisional";
}

export function startDevDemo(): () => void {
  let live = true;
  let raf = 0;
  let installed = false;
  // the Elmina build's plan when it is in the tree (BE lane), else the provisional fixture
  const fixtures = import.meta.glob<{ default: unknown }>("../../../devsim/fixtures/plan.*.json");
  const load =
    fixtures["../../../devsim/fixtures/plan.elmina.json"] ??
    fixtures["../../../devsim/fixtures/plan.provisional.json"];
  if (!load) return () => {};
  void load().then((m) => {
    if (!live) return;
    const plan = m.default as DevelopmentPlan;
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
