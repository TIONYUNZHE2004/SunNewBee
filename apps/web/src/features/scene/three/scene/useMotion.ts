import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion, useSceneSettings } from "../../sceneSettingsStore";
import { useScene } from "../../sceneStore";
import type { Tier } from "../../shared/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { CrowdKit } from "../motion/crowdBake";
import { CROWD_LOAD_TIMEOUT_MS, loadCrowdKit } from "../motion/crowdKit";
import { createMotionDriver, type MotionDriver, motionRunning } from "../motion/motionClock";
import { createMotionLayer, type YawMemory } from "../motion/motionLayer";
import type { ActiveTile } from "../stream/streamer";
import type { SceneBus } from "./sceneBus";
import { unionById } from "./union";
import type { LoadedAssets } from "./useCityAssets";

/**
 * The motion clock (decorative traffic, pedestrians, birds, sway, shimmer, flicker): its gates
 * (Motion setting, reduced motion, tab visible, map on screen), the driver, the Day / Rollout fade
 * and the agents of the streamed tiles (one motion layer for their union, rebuilt only when the
 * set of agents changes).
 */
export function useMotion({
  engine,
  tier,
  active,
  loaded,
  showroom,
  roleUniforms,
  sectionRef,
  bus,
}: {
  engine: Engine | null;
  tier: Tier;
  active: ActiveTile[];
  loaded: LoadedAssets | null;
  showroom: boolean;
  roleUniforms: RoleUniforms;
  sectionRef: RefObject<HTMLElement | null>;
  bus: SceneBus;
}) {
  // The motion clock runs only while Motion is on, reduced motion is off, the tab is visible and
  // the map is on screen; otherwise the engine idles at render on demand (Review Focus 3).
  const motionOn = useSceneSettings((s) => s.motion);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === "visible");
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    const mq =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const onMq = () => setReduced(prefersReducedMotion());
    mq?.addEventListener?.("change", onMq);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOnScreen(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [sectionRef]);
  const running = motionRunning({ enabled: motionOn, reduced, visible: tabVisible, onScreen });
  const runningRef = useRef(running);
  runningRef.current = running;
  const [driver, setDriver] = useState<MotionDriver | null>(null);
  // At Low motion is off (ruling P4-S): no driver at all, so no motion frame, timer or flicker.
  // Sway, limbs and shimmer hold their rest pose (the engine rests uSway / uLimb with no layer).
  const low = tier === "low";
  useEffect(() => {
    if (!engine) return;
    if (low) {
      roleUniforms.uFlicker.value = 0;
      engine.setMotion(null, () => false);
      return;
    }
    const d = createMotionDriver({
      role: roleUniforms,
      ambient: () => bus.getState().ambient,
      running: () => runningRef.current,
    });
    d.setWeights(bus.getState().mood);
    const scene = useScene.getState();
    d.setTarget(scene.day.on || scene.rollout.on ? 0 : 1);
    engine.setMotion(d, () => runningRef.current);
    setDriver(d);
    bus.setState({ driver: d });
    return () => {
      bus.setState({ driver: null });
      setDriver(null);
      engine.setMotion(null, () => false);
    };
  }, [engine, roleUniforms, bus, low]);
  // Start: one frame starts the clock. Stop: static pose, then one final frame.
  useEffect(() => {
    if (!engine || !driver) return;
    if (!running) driver.rest();
    engine.requestRender();
  }, [engine, driver, running]);
  // Decorative people and vehicles fade out over 1 s while Elmina Day or Rollout playback is on.
  useEffect(() => {
    if (!engine || !driver) return;
    let target: 0 | 1 = driver.target;
    return useScene.subscribe((s) => {
      const next = s.day.on || s.rollout.on ? 0 : 1;
      if (next === target) return;
      target = next;
      driver.setTarget(next);
      engine.requestRender();
    });
  }, [engine, driver]);
  // The active tiles' agents (decorative, like the props); none at Low, even from stale content.
  const agentList = useMemo(
    () => (showroom || tier === "low" ? [] : unionById(active, (t) => t.content.agents)),
    [active, showroom, tier],
  );
  const agentKey = agentList.map((a) => a.id).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids, not the array
  const agents = useMemo(() => agentList, [agentKey]);
  // One smoothed-yaw memory for the scene's lifetime, shared by every rebuilt layer: streamed agents
  // arriving or leaving never reset the others' yaw (each rebuild prunes it to the new agent set).
  const [yaw] = useState<YawMemory>(() => new Map());
  // The crowd kit (C-T7): loaded and baked once, body by body in idle slices, the first time there
  // are agents. null while loading (no people drawn yet); undefined if it failed or timed out (the
  // legacy people kit then draws them). A kit that resolves after unmount is disposed.
  const [crowd, setCrowd] = useState<CrowdKit | null | undefined>(null);
  const crowdRef = useRef<{ failed: boolean; kit: CrowdKit | null }>({
    failed: false,
    kit: null,
  });
  const wantCrowd = agents.length > 0;
  useEffect(() => {
    const ref = crowdRef.current;
    if (!wantCrowd || ref.kit || ref.failed) return;
    const ac = new AbortController();
    let live = true;
    loadCrowdKit({ signal: ac.signal, timeoutMs: CROWD_LOAD_TIMEOUT_MS }).then(
      (k) => {
        if (!live) {
          k.dispose();
          return;
        }
        ref.kit = k;
        setCrowd(k);
      },
      () => {
        if (!live) return;
        ref.failed = true;
        setCrowd(undefined);
      },
    );
    return () => {
      live = false;
      ac.abort();
    };
  }, [wantCrowd]);
  useEffect(() => () => crowdRef.current.kit?.dispose(), []);
  useEffect(() => {
    if (!engine || !driver || !loaded || !agents || agents.length === 0) return;
    driver.setAgents(
      createMotionLayer(agents, loaded.lib, loaded.manifest, roleUniforms, engine.motion, {
        yaw,
        crowd,
      }),
    );
    engine.requestRender();
    return () => driver.setAgents(null);
  }, [engine, driver, loaded, agents, roleUniforms, yaw, crowd]);

  return { running, onScreen, agents };
}
