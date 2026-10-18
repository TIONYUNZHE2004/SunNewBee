import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Tier } from "../../cesium/stylised/quality";
import { prefersReducedMotion, useSceneSettings } from "../../sceneSettingsStore";
import { useScene } from "../../sceneStore";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { planAgents } from "../motion/agents";
import { createMotionDriver, type MotionDriver, motionRunning } from "../motion/motionClock";
import { createMotionLayer } from "../motion/motionLayer";
import { capFor } from "../props/caps";
import type { SceneBus } from "./sceneBus";
import type { LoadedAssets } from "./useCityAssets";
import { heroBox } from "./useDecor";
import type { LayerData } from "./useGround";

/**
 * The motion clock (decorative traffic, pedestrians, birds, sway, shimmer, flicker): its gates
 * (Motion setting, reduced motion, tab visible, map on screen), the driver, the Day / Rollout fade
 * and the seeded agents.
 */
export function useMotion({
  engine,
  frame,
  tier,
  detailsOn,
  walk,
  loaded,
  showroom,
  roleUniforms,
  sectionRef,
  bus,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  tier: Tier;
  detailsOn: boolean;
  walk: LayerData | undefined;
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
  // Seeded agents on the hero district's walk edges (decorative, like the props).
  const agents = useMemo(
    () =>
      frame && detailsOn && walk && loaded && !showroom
        ? planAgents({
            walk,
            places: walk,
            frame,
            // Until the streamer plans per tile (Task 4): the P3 hero box and totals.
            area: { box: heroBox(frame), seed: "motion" },
            tier,
            caps: { vehicles: capFor(tier, "vehicles"), people: capFor(tier, "people") },
            m: loaded.manifest,
          })
        : null,
    [frame, detailsOn, walk, loaded, showroom, tier],
  );
  useEffect(() => {
    if (!engine || !driver || !loaded || !agents || agents.length === 0) return;
    driver.setAgents(
      createMotionLayer(agents, loaded.lib, loaded.manifest, roleUniforms, engine.motion),
    );
    engine.requestRender();
    return () => driver.setAgents(null);
  }, [engine, driver, loaded, agents, roleUniforms]);

  return { running, onScreen, agents };
}
