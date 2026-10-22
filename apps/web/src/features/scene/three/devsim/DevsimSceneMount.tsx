import { type RefObject, useEffect, useState } from "react";
import { registerDemoState } from "../../../demo/demoHook";
import { registerProbe } from "../../../devsim/anchors";
import { useDevsim } from "../../../devsim/devsimStore";
import { cameraSiteWeight } from "../../../devsim/timeline";
import type { DevelopmentPlan } from "../../../devsim/types";
import { projectToScreen } from "../../../journey/three/project";
import type { Tier } from "../../shared/quality";
import { type Road, roadsFromWalk } from "../../shared/roads";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { CameraDriver, Engine } from "../engine";
import { releaseSlots } from "../engineSlots";
import type { LocalFrame } from "../frame";
import { createFrameStats } from "../frameStats";
import type { CrowdKit } from "../motion/crowdBake";
import { CROWD_LOAD_TIMEOUT_MS, loadCrowdKit } from "../motion/crowdKit";
import type { SceneBus } from "../scene/sceneBus";
import type { LoadedAssets } from "../scene/useCityAssets";
import { type Cast, createCast } from "./cast";
import { devDemoRequested, startDevDemo } from "./devDemo";
import { createDevsimLayer, type DevsimLayer } from "./devsimLayer";
import {
  devsimCamera,
  devsimCameraDriver,
  framingOffset,
  glideRect,
  type ScreenRect,
} from "./devsimView";
import { createMoveIn } from "./moveIn";
import { createPilingRig } from "./pilingRig";
import { createRain } from "./rain";
import { createScaffold } from "./scaffold";
import { setPieceTiming } from "./setPieces";
import { createSite, nearClosed, nearQueue, queueShown } from "./site";
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

/** The carriageways of the walk layer (streets and major roads, as the stylised city draws them). */
export function streetsOf(accessData: unknown): Road[] {
  return roadsFromWalk(accessData).filter((r) => r.kind === "major" || r.kind === "residential");
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
      roads: streetsOf(accessData),
      clearance: () => engine.clearance?.() ?? null,
      fps: () => fps,
      flowSamples: () => bus.getState().driver?.samples() ?? null,
    });
    l.setTower(
      createTower({ geom: l.geom, roleUniforms, lib: loaded?.lib, manifest: loaded?.manifest }),
    );
    l.add(createSite({ geom: l.geom, roleUniforms, lib: loaded?.lib, manifest: loaded?.manifest }));
    // C9 construction set pieces: scaffold + netting, the piling rig, monsoon rain
    l.add(createScaffold({ geom: l.geom }));
    l.add(createPilingRig({ geom: l.geom }));
    l.add(createRain());
    // C10 move-in: the box stack and the cars parking in the tower car park
    l.add(
      createMoveIn({
        geom: l.geom,
        timing: setPieceTiming(plan),
        roleUniforms,
        lib: loaded?.lib,
        manifest: loaded?.manifest,
      }),
    );
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
    // people keep off the hoarded footway. The zone stays for the whole run (gate 2: dropping it
    // when the hoarding came down, 28 s on the 45 s plan (`BUILD_T.hoarding`), snapped every
    // clipped walker onto its full path; a position-keeping hand-over would make the frame depend
    // on the seek history).
    const geom = l.geom;
    const avoid = (x: number, z: number) => nearClosed(geom, x, z);
    const avoidVehicles = (x: number, z: number) => nearQueue(geom, x, z);
    // the school-run queue stands only on the legacy 66 s plan (the 45 s plan has no school run)
    const legacy = setPieceTiming(plan).mode === "legacy";
    const applyFlow = () => {
      const st = l.state();
      if (!st) return;
      bus.getState().driver?.setFlow({
        timeScale: st.flow.timeScale,
        peopleDensity: st.flow.peopleDensity,
        vehicleDensity: st.flow.vehicleDensity,
        avoid,
        // decorative traffic never drives through the parked school-run queue
        ...(legacy && queueShown(useDevsim.getState().t) ? { avoidVehicles } : {}),
      });
    };
    applyFlow();
    // The devsim camera (§4.4 beats from StateAt.camera), clamped out of every building (Q2),
    // and framed in the map area the overlays leave clear (V2 fix B-a): the site (hoarding, tower)
    // or the beat's person sits in the clear area, never under the left stack, the brief or bars.
    const siteAt = (): [number, number, number] => [
      l.geom.centre[0],
      Math.max(4, l.towerTopM() / 2),
      l.geom.centre[1],
    ];
    let clear: ScreenRect | null = null;
    let clearAt = 0;
    const driver: CameraDriver = devsimCameraDriver({
      state: () => l.state(),
      pose: (st) => devsimCamera(st, frame, l.geom, l.towerTopM(), engine.clearance?.() ?? null),
      playing: () => useDevsim.getState().playing,
      frame: (_st, pose, now) => {
        const d = useDevsim.getState();
        clear = glideRect(clear, d.clear, now - clearAt, d.playing);
        clearAt = now;
        const off = framingOffset({
          pose,
          size: engine.pickView().size,
          clear,
          site: siteAt(),
          siteWeight: cameraSiteWeight(d.t, plan),
        });
        const x = off ? Math.round(off[0]) : 0;
        if (x !== d.viewShiftPx) d.setViewShift(x);
        return off;
      },
    });
    // where the site is drawn now (CSS px of the map stage), for the demo hook (V2 fix B-a)
    let siteScreen: { x: number; y: number } | null = null;
    const offSite = engine.onFrame(() => {
      const v = engine.pickView();
      v.camera.updateMatrixWorld();
      siteScreen = projectToScreen(v.camera, siteAt(), v.size);
    });
    const clock = () => flowSeconds(useDevsim.getState().t, plan);
    engine.setCameraDriver?.(driver);
    engine.setDecorClock?.(clock);
    const unsub = useDevsim.subscribe((s, prev) => {
      if (s.t !== prev.t && s.plan === plan) {
        l.setT(s.t);
        applyFlow();
        engine.requestRender();
      }
    });
    const unprobe = registerProbe("scene", () => l.probe());
    // `window.__tl.demo.state()` ("bld"): crane, rain, rig, lorries, scaffold (AC-W3/W4)
    const undemo = registerDemoState("bld", () => ({
      ...l.demoState(),
      siteScreen,
      clearRect: useDevsim.getState().clear,
    }));
    // dev builds: the layer for console inspection (QA and lane debugging)
    const w = window as unknown as { __devsimLayer?: DevsimLayer };
    if (import.meta.env.DEV) w.__devsimLayer = l;
    return () => {
      unsub();
      offSite();
      unprobe();
      undemo();
      if (w.__devsimLayer === l) delete w.__devsimLayer;
      // only its own slots: a trip that took them meanwhile keeps its camera and clock
      releaseSlots(engine, { driver, clock });
      bus.getState().driver?.setFlow(null);
      offFrame();
      stats.dispose();
      engine.setDevsim?.(null); // disposes the layer
      setLayer(null);
    };
  }, [engine, frame, plan, accessData, roleUniforms, loaded, hostRef, bus]);

  return null;
}
