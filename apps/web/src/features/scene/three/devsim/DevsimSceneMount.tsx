import { type RefObject, useEffect, useState } from "react";
import { registerProbe } from "../../../devsim/anchors";
import { useDevsim } from "../../../devsim/devsimStore";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { Tier } from "../../shared/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createFrameStats } from "../frameStats";
import type { CrowdKit } from "../motion/crowdBake";
import { CROWD_LOAD_TIMEOUT_MS, loadCrowdKit } from "../motion/crowdKit";
import type { SceneBus } from "../scene/sceneBus";
import type { LoadedAssets } from "../scene/useCityAssets";
import { type Cast, createCast } from "./cast";
import { devDemoRequested, startDevDemo } from "./devDemo";
import { createDevsimLayer, type DevsimLayer } from "./devsimLayer";
import { devsimCamera } from "./devsimView";
import { createSite, nearClosed } from "./site";
import { flowSeconds } from "./state";
import { createTower } from "./tower";
import { loadWorkerKit } from "./workerKit";

/** The plan's closed edge from the walk layer (a feature whose id is `facts.detour.edge_id`). */
export function closedEdgeOf(plan: DevelopmentPlan, accessData: unknown): number[][] | null {
  const id = plan.facts.detour?.edge_id;
  const fc = accessData as { features?: GeoJSON.Feature[] } | null | undefined;
  if (!id || !fc?.features) return null;
  for (const f of fc.features) {
    const fid = f.id ?? (f.properties as { id?: unknown } | null)?.id;
    if (fid !== id || f.geometry?.type !== "LineString") continue;
    return f.geometry.coordinates as number[][];
  }
  return null;
}

export interface DevsimSceneMountProps {
  engine: Engine | null;
  frame: LocalFrame | null;
  bus: SceneBus;
  roleUniforms: RoleUniforms;
  tier: Tier;
  loaded: LoadedAssets | null;
  accessData: unknown;
  /** The map element: name tags are positioned in it. */
  hostRef: RefObject<HTMLElement | null>;
}

/**
 * Development Simulation mount for the Stylised (Three.js) map (spec §5.3 Scene): while the devsim
 * store holds a plan it adds the devsim layer to the engine, poses it at the store's t, and
 * registers the scene part of `window.__devsim.probe()`. FE owns the clock and the overlays.
 */
export function DevsimSceneMount(props: DevsimSceneMountProps) {
  const { engine, frame, accessData, roleUniforms, loaded, hostRef, bus } = props;
  const plan = useDevsim((s) => s.plan);
  const [layer, setLayer] = useState<{ layer: DevsimLayer; cast: Cast } | null>(null);

  // The crowd kit for the cast (loaded once a plan is shown; kept for the session's mount).
  const [kit, setKit] = useState<CrowdKit | null>(null);
  const wantKit = !!plan && !!engine;
  useEffect(() => {
    if (!wantKit || kit || import.meta.env.MODE === "test") return;
    const ac = new AbortController();
    let live = true;
    loadCrowdKit({ signal: ac.signal, timeoutMs: CROWD_LOAD_TIMEOUT_MS }).then(
      (k) => {
        if (live) setKit(k);
        else k.dispose();
      },
      () => {},
    );
    return () => {
      live = false;
      ac.abort();
    };
  }, [wantKit, kit]);
  useEffect(() => () => kit?.dispose(), [kit]);
  // The site worker model (ASSETS lane, crowd.json `worker`), when the manifest has it.
  const [workerKit, setWorkerKit] = useState<CrowdKit | null>(null);
  useEffect(() => {
    if (!wantKit || workerKit || import.meta.env.MODE === "test") return;
    const ac = new AbortController();
    let live = true;
    loadWorkerKit({ signal: ac.signal }).then(
      (k) => {
        if (live) setWorkerKit(k);
        else k?.dispose();
      },
      () => {},
    );
    return () => {
      live = false;
      ac.abort();
    };
  }, [wantKit, workerKit]);
  useEffect(() => () => workerKit?.dispose(), [workerKit]);
  useEffect(() => {
    if (!layer || !engine) return;
    layer.cast.setWorkerKit(workerKit);
    engine.requestRender();
  }, [layer, workerKit, engine]);
  useEffect(() => {
    if (!layer || !engine) return;
    layer.cast.setKit(kit);
    engine.requestRender();
  }, [layer, kit, engine]);

  // dev-only: `?devsim=provisional` starts the provisional plan (see devDemo.ts)
  useEffect(() => {
    if (!devDemoRequested()) return;
    return startDevDemo();
  }, []);

  useEffect(() => {
    if (!engine?.setDevsim || !frame || !plan) return;
    let fps: number | undefined;
    const stats = createFrameStats({
      frames: () => {},
      perf: (p) => {
        if (p.fps !== undefined) fps = p.fps;
      },
    });
    const offFrame = engine.onFrame((dt, info) => stats.frame(engine.frames, dt, info.calls));
    const l = createDevsimLayer({
      plan,
      frame,
      closedEdge: closedEdgeOf(plan, accessData),
      clearance: () => engine.clearance?.() ?? null,
      fps: () => fps,
      flowSamples: () => bus.getState().driver?.samples() ?? null,
    });
    l.setTower(
      createTower({ geom: l.geom, roleUniforms, lib: loaded?.lib, manifest: loaded?.manifest }),
    );
    l.add(createSite({ geom: l.geom, roleUniforms, lib: loaded?.lib, manifest: loaded?.manifest }));
    const cast = createCast({
      plan,
      geom: l.geom,
      tagHost: hostRef.current,
      flowT: (t) => flowSeconds(t, plan),
    });
    l.add(cast);
    l.setT(useDevsim.getState().t);
    engine.setDevsim(l);
    setLayer({ layer: l, cast });
    // Fast-forward flow (spec §7): the decorative people and cars run on the devsim flow clock
    // (timeScale integrated over t, so a seek is deterministic), thinned by the flow density, and
    // people keep off the hoarded footway while the hoarding stands.
    const geom = l.geom;
    const avoid = (x: number, z: number) => nearClosed(geom, x, z);
    const applyFlow = () => {
      const st = l.state();
      if (!st) return;
      bus.getState().driver?.setFlow({
        timeScale: st.flow.timeScale,
        peopleDensity: st.flow.peopleDensity,
        vehicleDensity: st.flow.vehicleDensity,
        ...(st.hoarding ? { avoid } : {}),
      });
    };
    applyFlow();
    // The devsim camera (§4.4 beats from StateAt.camera), clamped out of every building (Q2).
    engine.setCameraDriver?.(() => {
      const st = l.state();
      if (!st) return null;
      return devsimCamera(st, frame, l.geom, l.towerTopM(), engine.clearance?.() ?? null);
    });
    engine.setDecorClock?.(() => flowSeconds(useDevsim.getState().t, plan));
    const unsub = useDevsim.subscribe((s, prev) => {
      if (s.t !== prev.t && s.plan === plan) {
        l.setT(s.t);
        applyFlow();
        engine.requestRender();
      }
    });
    const unprobe = registerProbe("scene", () => l.probe());
    return () => {
      unsub();
      unprobe();
      engine.setDecorClock?.(null);
      engine.setCameraDriver?.(null);
      bus.getState().driver?.setFlow(null);
      offFrame();
      stats.dispose();
      engine.setDevsim?.(null); // disposes the layer
      setLayer(null);
    };
  }, [engine, frame, plan, accessData, roleUniforms, loaded, hostRef, bus]);

  return null;
}
