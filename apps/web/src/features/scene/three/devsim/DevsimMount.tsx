import { type RefObject, useEffect, useState } from "react";
import { registerProbe } from "../../../devsim/anchors";
import { useDevsim } from "../../../devsim/devsimStore";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { Tier } from "../../shared/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createFrameStats } from "../frameStats";
import type { SceneBus } from "../scene/sceneBus";
import type { LoadedAssets } from "../scene/useCityAssets";
import { devDemoRequested, startDevDemo } from "./devDemo";
import { createDevsimLayer, type DevsimLayer } from "./devsimLayer";
import { createSite } from "./site";
import { createTower } from "./tower";

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

export interface DevsimMountProps {
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
export function DevsimMount(props: DevsimMountProps) {
  const { engine, frame, accessData, roleUniforms, loaded } = props;
  const plan = useDevsim((s) => s.plan);
  const [layer, setLayer] = useState<DevsimLayer | null>(null);

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
    });
    l.setTower(
      createTower({ geom: l.geom, roleUniforms, lib: loaded?.lib, manifest: loaded?.manifest }),
    );
    l.add(createSite({ geom: l.geom, roleUniforms, lib: loaded?.lib, manifest: loaded?.manifest }));
    l.setT(useDevsim.getState().t);
    engine.setDevsim(l);
    setLayer(l);
    const unsub = useDevsim.subscribe((s, prev) => {
      if (s.t !== prev.t && s.plan === plan) {
        l.setT(s.t);
        engine.requestRender();
      }
    });
    const unprobe = registerProbe("scene", () => l.probe());
    return () => {
      unsub();
      unprobe();
      offFrame();
      stats.dispose();
      engine.setDevsim?.(null); // disposes the layer
      setLayer(null);
    };
  }, [engine, frame, plan, accessData, roleUniforms, loaded]);

  void layer;
  return null;
}
