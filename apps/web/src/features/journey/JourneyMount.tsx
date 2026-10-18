import { type RefObject, useCallback, useEffect, useReducer, useState } from "react";
import { useScene } from "../scene/sceneStore";
import type { Engine } from "../scene/three/engine";
import type { LocalFrame } from "../scene/three/frame";
import { JourneyOverlay } from "./JourneyOverlay";
import { journeyStateOf, useJourney } from "./journeyStore";
import { createJourneyLayer, type JourneyLayer } from "./three/journeyLayer";
import { projectToScreen } from "./three/project";

/** Longest frame step the player takes (a hidden tab or a stall must not skip events). */
const MAX_STEP_S = 0.1;

/** CSS px of an inherited custom property at `el` (e.g. `--panel-w: 360px`); 0 when unset. */
function cssPx(el: Element | null | undefined, name: string): number {
  if (!el) return 0;
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
}

/** Bottom of the map's top stack (label, HUD, route tag) below the top of `el`, CSS px; 0 without one. */
function topStackBottom(el: Element | null | undefined): number {
  const stack = el?.ownerDocument.querySelector('[data-testid="top-stack"]');
  if (!el || !stack) return 0;
  return Math.max(0, stack.getBoundingClientRect().bottom - el.getBoundingClientRect().top);
}

/**
 * Minimal journey mount for the Three.js map (D-T7): while the scene store holds a journey it adds
 * the ribbon and the event markers to the engine and shows the DOM overlay (label, HUD, mini-map,
 * event card). It never starts playback (D-T8 adds the controls, D-T10 the demo auto-play); while
 * the store is playing it advances the timeline once per animation frame.
 */
export function JourneyMount({
  engine,
  frame,
  hostRef,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  /** The map element: the side panel and phone sheet sizes are read from its CSS variables. */
  hostRef?: RefObject<HTMLElement | null>;
}) {
  const plan = useScene((s) => s.journey);
  const [layer, setLayer] = useState<JourneyLayer | null>(null);

  useEffect(() => {
    if (!engine || !frame || !plan) return;
    const l = createJourneyLayer(plan, frame);
    engine.setJourney(l);
    setLayer(l);
    return () => {
      engine.setJourney(null); // disposes the layer
      setLayer(null);
    };
  }, [engine, frame, plan]);

  // The hold event marker grows.
  const activeEvent = useJourney((s) => {
    const st = journeyStateOf(s);
    return st?.phase.kind === "event" ? (st.eventIndex ?? null) : null;
  });
  useEffect(() => {
    if (!layer) return;
    layer.setActive(activeEvent);
    engine?.requestRender();
  }, [layer, activeEvent, engine]);

  // Player clock: advance while playing (no auto-play here).
  const playing = useJourney((s) => s.playing);
  useEffect(() => {
    if (!playing || !plan) return;
    let raf = 0;
    let last: number | null = null;
    const step = (now: number) => {
      if (last !== null) useJourney.getState().advance(Math.min(MAX_STEP_S, (now - last) / 1000));
      last = now;
      engine?.requestRender();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan, engine]);

  // Re-place the card on every rendered frame (the camera may have moved).
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => (engine && plan ? engine.onFrame(() => bump()) : undefined), [engine, plan]);

  const project = useCallback(
    (i: number) => {
      const a = layer?.anchorOf(i);
      if (!a || !engine) return null;
      const v = engine.pickView();
      return projectToScreen(v.camera, a, v.size);
    },
    [layer, engine],
  );

  if (!plan || !engine) return null;
  const size = engine.pickView().size;
  // The card stays clear of the side panel and the phone sheet that cover the map.
  const host = hostRef?.current;
  const viewport = {
    w: Math.max(1, size[0] - cssPx(host, "--panel-w")),
    h: Math.max(1, size[1] - cssPx(host, "--sheet-h") - cssPx(host, "--attr-h")),
    top: topStackBottom(host),
  };
  return <JourneyOverlay project={project} viewport={viewport} />;
}
