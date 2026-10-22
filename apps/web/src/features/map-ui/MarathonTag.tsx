import { useEffect } from "react";
import { COURSE_STYLE } from "../closures/closureSimModel";
import { PLAY_LABEL, PLAY_NOTE, PLAY_S, PLAY_STYLE, simClock } from "../closures/marathonPlay";
import { useMarathonPlay } from "../closures/marathonPlayStore";
import { useScene } from "../scene/sceneStore";
import { rendererFor } from "../scene/three/engineChoice";
import { useEffectiveView, useMapStyle } from "../scene/useMapStyle";
import { InSlot } from "./mapSlots";

/** Longest real step fed to the store, so a stalled frame cannot jump the playback. */
const MAX_DT_S = 0.25;

/** One requestAnimationFrame loop advancing the playback while it plays and the tab is visible. */
function useMarathonDriver(playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const frame = (now: number) => {
      if (last !== null && !document.hidden)
        useMarathonPlay.getState().advance(Math.min(MAX_DT_S, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

const btn =
  "grid size-11 shrink-0 place-items-center rounded-full text-fg-soft hover:bg-raised focus-visible:outline-2";

/**
 * T-028 "Watch the marathon" controls: the "Simulation · illustrative" label, the simulated clock,
 * play / pause, a scrubber and close, plus the legend for runners, cars and the closed course.
 */
export function MarathonTag() {
  const result = useMarathonPlay((s) => s.result);
  const t = useMarathonPlay((s) => s.t);
  const playing = useMarathonPlay((s) => s.playing);
  const view = useEffectiveView();
  const { style } = useMapStyle();
  useMarathonDriver(playing && !!result);
  // a later answer that clears the course from the map ends the playback too
  const courseOn = useScene((s) => !!s.closureSim);
  useEffect(() => {
    if (!courseOn && result) useMarathonPlay.getState().stop();
  }, [courseOn, result]);
  if (!result) return null;
  const st = useMarathonPlay.getState();
  const time = simClock(result, t);
  const drawn = rendererFor(view, style) === "three"; // the stylised map draws runners and cars
  return (
    <InSlot name="sim">
      <section
        aria-label="Marathon simulation"
        data-testid="marathon-play"
        className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-edge bg-surface/95 py-1 pl-3 pr-1 text-sm text-fg shadow-md"
      >
        <strong role="note" className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-[#f5c518]" />
          {PLAY_LABEL}
        </strong>
        {time && (
          <span data-testid="marathon-clock" className="tabular-nums font-semibold">
            {time}
          </span>
        )}
        <button
          type="button"
          className={btn}
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => (playing ? st.pause() : st.play())}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round((t / PLAY_S) * 1000)}
          aria-label="Marathon timeline"
          aria-valuetext={time ?? `${Math.round(t)} of ${PLAY_S} seconds`}
          onChange={(e) => st.seek((Number(e.target.value) / 1000) * PLAY_S)}
          className="min-w-20 flex-1 accent-[var(--c-fg)]"
        />
        <button
          type="button"
          className={btn}
          aria-label="Close marathon simulation"
          onClick={() => st.stop()}
        >
          ×
        </button>
        <span className="flex w-full flex-wrap items-center gap-x-3 text-xs text-fg-soft">
          {drawn ? (
            <>
              <Key color={PLAY_STYLE.runner} round label="Runners" />
              <Key color={PLAY_STYLE.car} label="Sample cars on detours" />
              <Key color={COURSE_STYLE.color} label={COURSE_STYLE.label} />
              <Key color={PLAY_STYLE.before} label="Car route before the closure" />
            </>
          ) : (
            <span>Runners and cars play on the 3D stylised map.</span>
          )}
          <span>{PLAY_NOTE}</span>
        </span>
      </section>
    </InSlot>
  );
}

function Key({ color, label, round }: { color: string; label: string; round?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden="true"
        className={round ? "size-2.5 rounded-full" : "h-1 w-4 rounded-sm"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
