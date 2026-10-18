import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useCameraHeading } from "../../cesium/controls/cameraHeadingStore";
import { usePerfStats } from "../../cesium/PerfOverlay";
import {
  createFrameMonitor,
  gpuName,
  lowerTier,
  pickTier,
  type Tier,
} from "../../cesium/stylised/quality";
import { useSceneSettings } from "../../sceneSettingsStore";
import { createEngine, type Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { createFrameStats } from "../frameStats";

const RAD = Math.PI / 180;
const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

/**
 * The engine on a fresh canvas in `hostRef`, sized to `sectionRef`; camera bounds from the site
 * extent; the quality tier (user choice, else GPU-picked and lowered by the frame monitor); the
 * frame count and perf line; the slow-device banner.
 */
export function useEngine({
  createEngineFn = createEngine,
  hostRef,
  sectionRef,
  frame,
  bbox,
}: {
  createEngineFn?: typeof createEngine;
  hostRef: RefObject<HTMLDivElement | null>;
  sectionRef: RefObject<HTMLElement | null>;
  frame: LocalFrame | null;
  bbox: number[] | undefined;
}) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const quality = useSceneSettings((s) => s.quality);

  // The initial tier: the user's choice, else Medium until the GPU is known.
  const initialTier = useRef<Tier>(quality === "auto" ? "medium" : quality);

  // Quality tier: the user's choice, or the GPU-picked tier lowered by the frame monitor.
  const detected = useMemo<Tier>(
    () =>
      engine
        ? pickTier(
            gpuName(engine.gl()),
            (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          )
        : "medium",
    [engine],
  );
  const [dropped, setDropped] = useState<Tier | null>(null);
  const tier: Tier = quality === "auto" ? (dropped ?? detected) : quality;
  /** The live tier for the perf line, which must not re-subscribe on a tier change. */
  const tierRef = useRef(tier);
  tierRef.current = tier;

  // A fresh canvas per engine: dispose() forces its context lost, so a remount (StrictMode, HMR)
  // must never reuse it. Construction and runtime failures (context lost, shader errors) go to the
  // error boundary through `failure`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    host.appendChild(canvas);
    let e: Engine;
    try {
      e = createEngineFn(canvas, initialTier.current);
    } catch (err) {
      canvas.remove();
      setFailure(asError(err));
      return;
    }
    const offFatal = e.onFatal((err) => setFailure(err));
    setEngine(e);
    return () => {
      offFatal();
      setEngine(null);
      e.dispose();
      canvas.remove();
    };
  }, [createEngineFn, hostRef]);

  // Canvas size.
  useEffect(() => {
    const el = sectionRef.current;
    if (!engine || !el) return;
    const apply = () => engine.resize(el.clientWidth, el.clientHeight);
    apply();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine, sectionRef]);

  // Camera bounds: the site extent until the city arrives (setCity replaces them).
  useEffect(() => {
    if (!engine || !frame || bbox?.length !== 4) return;
    const a = frame.toLocal(bbox[0] as number, bbox[1] as number);
    const b = frame.toLocal(bbox[2] as number, bbox[3] as number);
    engine.setBounds({
      min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
      max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    });
  }, [engine, frame, bbox]);

  useEffect(() => {
    engine?.setTier(tier);
  }, [engine, tier]);

  // `data-frames` (first frames at once, then at most every 500 ms) and the compass heading follow
  // every engine frame; separate from the tier listener below so a tier change never drops a count.
  const [frames, setFrames] = useState(0);
  useEffect(() => {
    if (!engine) return;
    const stats = createFrameStats({
      frames: setFrames,
      perf: (p) => usePerfStats.getState().update({ ...p, tier: tierRef.current }),
    });
    const off = engine.onFrame((dt, info) => {
      const heading = engine.rig.get().headingDeg * RAD;
      if (useCameraHeading.getState().heading !== heading) useCameraHeading.setState({ heading });
      stats.frame(engine.frames, dt, info.calls, info.tris);
    });
    return () => {
      off();
      stats.dispose();
    };
  }, [engine]);

  // Auto-drop (auto quality only) and the slow-device banner (Low only).
  useEffect(() => {
    if (!engine) return;
    usePerfStats.getState().update({ tier });
    const autoMonitor =
      quality === "auto"
        ? createFrameMonitor(() => setDropped((d) => lowerTier(d ?? detected)))
        : null;
    const slowMonitor =
      tier === "low"
        ? createFrameMonitor(() => usePerfStats.getState().update({ slow: true }), { minFps: 15 })
        : null;
    if (tier !== "low") usePerfStats.getState().update({ slow: false });
    if (!autoMonitor && !slowMonitor) return;
    return engine.onFrame((dt, info) => {
      autoMonitor?.sample(dt, info.moving);
      slowMonitor?.sample(dt, info.moving);
    });
  }, [engine, quality, detected, tier]);
  useEffect(() => () => usePerfStats.getState().update({ slow: false }), []);

  return { engine, failure, tier, frames };
}
