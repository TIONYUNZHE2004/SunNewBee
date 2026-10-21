import { collectProbe } from "../../../devsim/anchors";
import { useDevsim } from "../../../devsim/devsimStore";
import type { DevelopmentPlan } from "../../../devsim/types";

/**
 * TEMPORARY dev-only entry (3D lane, until FE's `useDevsimDriver` and the AI replay land): the plan
 * cannot arrive through chat yet, so `?devsim=provisional` in a dev build starts the Development
 * Simulation with a fixture plan (`plan.elmina.json` when present, else the provisional one). When FE's driver has not installed `window.__devsim`
 * yet, a minimal `{seek, play, pause, total, acts, facts, probe}` and a playback loop stand in.
 * `&setpieces=preC7` also attaches the pre-C7 `lorry_route` and `schedule` dump (C9 set pieces:
 * Raya hold, monsoon rain, lorry route) to the plan. Never active in production builds or tests.
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
  const withSetPieces = new URLSearchParams(location.search).get("setpieces") === "preC7";
  const extras = import.meta.glob<{ default: { lorry_route: unknown; schedule: unknown } }>(
    "./fixtures/setPieces.preC7.elmina.json",
  );
  const loadExtras = withSetPieces ? extras["./fixtures/setPieces.preC7.elmina.json"] : undefined;
  void Promise.all([load(), loadExtras?.()]).then(([m, x]) => {
    if (!live) return;
    const base = m.default as DevelopmentPlan;
    const plan = x
      ? ({
          ...base,
          lorry_route: x.default.lorry_route,
          schedule: x.default.schedule,
        } as DevelopmentPlan)
      : base;
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
