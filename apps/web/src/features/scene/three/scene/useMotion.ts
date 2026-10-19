import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { journeyHero } from "../../../journey/journeyStore";
import { prefersReducedMotion, useSceneSettings } from "../../sceneSettingsStore";
import { useScene } from "../../sceneStore";
import type { Tier } from "../../shared/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import type { CrowdKit } from "../motion/crowdBake";
import { CROWD_LOAD_TIMEOUT_MS, loadCrowdKit } from "../motion/crowdKit";
import { crowdOverride, fillCrowd } from "../motion/crowdOverride";
import type { HeroXZ, LookMemory } from "../motion/crowdRules";
import { createLooksQueue, type LooksQueue } from "../motion/looksQueue";
import { createMotionDriver, type MotionDriver, motionRunning } from "../motion/motionClock";
import { createMotionLayer, crowdPeopleOf, type YawMemory } from "../motion/motionLayer";
import { type ActiveTile, measure } from "../stream/streamer";
import type { SceneBus } from "./sceneBus";
import { unionById } from "./union";
import type { LoadedAssets } from "./useCityAssets";

/**
 * The rendered hero's position, heading and next 10 m of path (`ahead`) for the crowd keep-out (C-T8,
 * P8): only these positions from the journey store's `journeyHero` holder, never the plan or its
 * events (P9). null without a journey.
 */
export function heroXZ(): HeroXZ | null {
  const h = journeyHero.current;
  return h ? { x: h.x, z: h.z, yaw: h.yaw, ...(h.ahead ? { ahead: h.ahead } : {}) } : null;
}

/** User Timing name of building one motion layer (agents, crowd renderer) on the main thread. */
export const MOTION_BUILD_MEASURE = "tl:motion-build";

/** `?acceptance=1&crowd=N` (spec P10 measurement only), read once per page. */
const CROWD_OVERRIDE = typeof location === "undefined" ? null : crowdOverride(location.search);

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
  const agentList = useMemo(() => {
    if (showroom || tier === "low") return [];
    const all = unionById(active, (t) => t.content.agents);
    return CROWD_OVERRIDE ? fillCrowd(all, active, CROWD_OVERRIDE) : all;
  }, [active, showroom, tier]);
  const agentKey = agentList.map((a) => a.id).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids, not the array
  const agents = useMemo(() => agentList, [agentKey]);
  // One smoothed-yaw memory for the scene's lifetime, shared by every rebuilt layer: streamed agents
  // arriving or leaving never reset the others' yaw (each rebuild prunes it to the new agent set).
  const [yaw] = useState<YawMemory>(() => new Map());
  // Crowd looks by agent id, kept the same way (C-T8, P3): streamed tiles never re-dress people.
  const [looks] = useState<LookMemory>(() => new Map());
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
  // The crowd look search for each agent set, in slices of <= 4 ms per frame (GATE AC-D18), in
  // order, so the looks are the same as one search per set at once.
  // Made on first use and dropped on unmount (StrictMode's dev re-mount makes a fresh one).
  const looksQueue = useRef<LooksQueue | null>(null);
  useEffect(
    () => () => {
      looksQueue.current?.dispose();
      looksQueue.current = null;
    },
    [],
  );
  // A new agent set builds its layer off the critical path: looks searched in slices, then the
  // layer built and its programs compiled in parallel (engine.prepare), then swapped in. The
  // previous layer stays drawn meanwhile, so streaming never blanks or hitches the crowd.
  // The agent set whose layer is drawn now (acceptance: a beat is judged once the crowd of its
  // streamed tiles is in, `data-crowd` on the scene element).
  const [shownAgents, setShownAgents] = useState<readonly unknown[] | null>(null);
  useEffect(() => {
    if (!engine || !driver || !loaded) return;
    if (agents.length === 0) {
      setShownAgents(agents);
      driver.setAgents(null);
      engine.requestRender();
      return;
    }
    let live = true;
    const build = (assigned?: Map<string, number>) => {
      if (!live) return;
      const t0 = performance.now();
      const layer = createMotionLayer(
        agents,
        loaded.lib,
        loaded.manifest,
        roleUniforms,
        engine.motion,
        { yaw, crowd, looks, hero: heroXZ, ...(assigned ? { assigned } : {}) },
      );
      measure(MOTION_BUILD_MEASURE, t0);
      const show = () => {
        if (!live) {
          layer.dispose();
          return;
        }
        driver.setAgents(layer);
        setShownAgents(agents);
        engine.requestRender();
      };
      if (engine.prepare) engine.prepare(layer.group).then(show);
      else show();
    };
    if (crowd) {
      looksQueue.current ??= createLooksQueue(looks);
      looksQueue.current.request(crowdPeopleOf(agents), crowd.manifest.looks).then(build, () => {});
    } else build();
    return () => {
      live = false;
    };
  }, [engine, driver, loaded, agents, roleUniforms, yaw, crowd, looks]);
  // The layer goes with its driver (engine change, Low tier, unmount) and with the asset library it
  // shares geometry with: when `loaded` is dropped (library disposed, assets off, build failed) the
  // layer is cleared at once, never drawn on disposed attributes. Agent-set changes keep the
  // no-blank swap above.
  useEffect(() => {
    if (!driver || !loaded) return;
    return () => {
      driver.setAgents(null);
      engine?.requestRender();
    };
  }, [driver, loaded, engine]);

  return { running, onScreen, agents, crowdShown: shownAgents === agents };
}
