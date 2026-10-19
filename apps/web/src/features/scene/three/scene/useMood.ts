import { type RefObject, useEffect, useState } from "react";
import { useTheme } from "../../../../ui/theme";
import { reducedMotion } from "../../cesium/controls/cameraOps";
import { useScene } from "../../sceneStore";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { LIGHT_PRESETS } from "../lighting";
import {
  dominant,
  glowFor,
  type MoodSource,
  type MoodWeights,
  mixWeights,
  moodKeyDir,
  moodPreset,
  moodSource,
  moodWeights,
} from "../mood";
import { sunNow } from "../sunClock";
import type { SceneBus } from "./sceneBus";

/** Mood crossfade on a source change: day to dusk, and any other pair. */
const DAY_DUSK_FADE_MS = 3000;
const FADE_MS = 2000;

/**
 * Lighting follows the mood clock: Elmina Day playback, else a pinned theme, else the real Kuala
 * Lumpur clock. A source change crossfades (reduced motion applies at once). Also the window glow,
 * the container background and the fog range. Display only.
 */
export function useMood({
  engine,
  roleUniforms,
  sectionRef,
  home,
  bus,
}: {
  engine: Engine | null;
  roleUniforms: RoleUniforms;
  sectionRef: RefObject<HTMLElement | null>;
  home: { lat: number; lon: number };
  bus: SceneBus;
}) {
  const theme = useTheme((s) => s.theme);
  // Constant for React; the mood loop then drives the live (blended) colour on the element.
  const [initialBackground] = useState(() => LIGHT_PRESETS[theme].background);

  useEffect(() => {
    if (!engine) return;
    let shown: MoodWeights | null = null;
    let key = "";
    let fade: { from: MoodWeights; start: number; dur: number } | null = null;
    let raf = 0;
    const source = () => {
      const day = useScene.getState().day;
      return moodSource({
        dayOn: day.on,
        dayT: day.t,
        choice: useTheme.getState().choice,
        // The clock source: the real time, or the pinned sun time (acceptance, demo; sunClock.ts).
        now: sunNow(),
      });
    };
    const apply = (w: MoodWeights, src: MoodSource) => {
      shown = w;
      bus.setState({ mood: w });
      bus.getState().driver?.setWeights(w);
      const g = glowFor(w);
      roleUniforms.uWindowGlow.value = g.uWindowGlow;
      roleUniforms.uLitShare.value = g.uLitShare;
      roleUniforms.uLightGlow.value = g.uLightGlow;
      const preset = moodPreset(w);
      if (sectionRef.current) sectionRef.current.style.background = preset.background;
      engine.setLighting(preset, moodKeyDir(src, w, sunNow(), home.lat, home.lon));
    };
    const step = () => {
      raf = 0;
      if (!fade) return;
      const src = source();
      const k = Math.min(1, (performance.now() - fade.start) / fade.dur);
      const to = moodWeights(src);
      apply(k >= 1 ? to : mixWeights(fade.from, to, k), src);
      if (k >= 1) fade = null;
      else raf = requestAnimationFrame(step);
    };
    const evaluate = () => {
      const src = source();
      const to = moodWeights(src);
      const k = src.kind === "pinned" ? `p:${src.theme}` : src.kind;
      const changed = shown !== null && k !== key;
      key = k;
      if (changed && shown && !reducedMotion()) {
        const pair = new Set([dominant(shown), dominant(to)]);
        const dayDusk = pair.size === 2 && pair.has("day") && pair.has("dusk");
        fade = {
          from: shown,
          start: performance.now(),
          dur: dayDusk ? DAY_DUSK_FADE_MS : FADE_MS,
        };
        if (!raf) raf = requestAnimationFrame(step);
        return;
      }
      if (fade) return; // the running crossfade follows the new target by itself
      apply(to, src);
    };
    engine.setFogRange(engine.rig.get().rangeM);
    evaluate();
    const offTheme = useTheme.subscribe(evaluate);
    const offDay = useScene.subscribe((s, prev) => {
      if (s.day.on !== prev.day.on || s.day.t !== prev.day.t) evaluate();
    });
    const timer = setInterval(evaluate, 60_000);
    return () => {
      offTheme();
      offDay();
      clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [engine, roleUniforms, home.lat, home.lon, sectionRef, bus]);

  // Fog follows the camera range (only when it moves by more than 10 %).
  useEffect(() => {
    if (!engine) return;
    let last = engine.rig.get().rangeM;
    return engine.onFrame(() => {
      const r = engine.rig.get().rangeM;
      if (Math.abs(r - last) > 0.1 * last) {
        last = r;
        engine.setFogRange(r);
      }
    });
  }, [engine]);

  return { initialBackground };
}
