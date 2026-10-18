import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Tier } from "../../cesium/stylised/quality";
import { prefersReducedMotion, useSceneSettings } from "../../sceneSettingsStore";
import { useScene } from "../../sceneStore";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
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
  useEffect(() => {
    if (!engine) return;
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
  }, [engine, roleUniforms, bus]);
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
  useEffect(() => {
    if (!engine || !driver || !loaded || !agents || agents.length === 0) return;
    driver.setAgents(
      createMotionLayer(agents, loaded.lib, loaded.manifest, roleUniforms, engine.motion, { yaw }),
    );
    engine.requestRender();
    return () => driver.setAgents(null);
  }, [engine, driver, loaded, agents, roleUniforms, yaw]);

  return { running, onScreen, agents };
}
