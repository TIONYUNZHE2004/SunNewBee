import { useId } from "react";
import { type CamMode, journeyStateOf, useJourney } from "./journeyStore";
import { useJourneyDriver } from "./useJourneyDriver";

const CAMS: { mode: CamMode; label: string }[] = [
  { mode: "follow", label: "Follow" },
  { mode: "overview", label: "Overview" },
  { mode: "free", label: "Free" },
];

const btn =
  "inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs text-fg hover:bg-surface-2 focus-visible:outline-2";

/** Player controls (spec §6.4, R-J4): play/pause, restart, scrub with phase ticks, camera mode. */
export function JourneyControls() {
  useJourneyDriver();
  const ticksId = useId();
  const timeline = useJourney((s) => s.timeline);
  const t = useJourney((s) => s.t);
  const playing = useJourney((s) => s.playing);
  const camMode = useJourney((s) => s.camMode);
  if (!timeline) return null;
  const { total, phases } = timeline;
  const hud = journeyStateOf({ timeline, t });
  const where = hud?.event?.title ?? hud?.phase ?? "";
  const ticks = phases.slice(1).map((p) => p.t0);
  const st = useJourney.getState();
  return (
    <section aria-label="Trip controls" data-testid="journey-controls" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn}
          aria-pressed={playing}
          onClick={() => (playing ? st.pause() : st.play())}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className={btn} onClick={() => st.restart()}>
          Restart
        </button>
        <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
          <legend className="sr-only">Camera</legend>
          {CAMS.map((c) => (
            <button
              key={c.mode}
              type="button"
              className={`${btn} ${camMode === c.mode ? "bg-surface-2 font-medium" : ""}`}
              aria-pressed={camMode === c.mode}
              onClick={() => st.setCam(c.mode)}
            >
              {c.label}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="relative">
        <input
          type="range"
          aria-label="Trip position"
          aria-valuetext={`${hud?.clock ?? ""} ${where}, ${t.toFixed(0)} of ${total.toFixed(0)} seconds`.trim()}
          className="w-full"
          min={0}
          max={total}
          step="any"
          value={t}
          list={ticksId}
          onChange={(e) => st.seek(Number(e.target.value))}
          onKeyDown={(e) => {
            // keyboard steps a whole second; pointer scrubbing stays fine-grained
            const d =
              e.key === "ArrowRight" || e.key === "ArrowUp"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? -1
                  : 0;
            if (!d) return;
            e.preventDefault();
            st.seek(useJourney.getState().t + d);
          }}
        />
        <datalist id={ticksId}>
          {ticks.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
    </section>
  );
}
