import { useEffectiveView } from "../scene/useMapStyle";
import { COMPARE_TOTAL_S, useCompare } from "./compareStore";
import type { CompareIntent } from "./compareTypes";
import { exitTrip } from "./exitTrip";
import { useCompareDriver } from "./useCompareDriver";

const btn =
  "inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs text-fg hover:bg-surface-2 focus-visible:outline-2";

/**
 * Compare playback controls (AC-N10): Play/Pause, Replay, scrub and Exit trip. `player` is false
 * in the List view, which has no split-screen player: there only Exit trip is offered (the reasons
 * card and toast are shown as text, see CompareListSection).
 */
export function CompareControlsView({ player }: { player: boolean }) {
  useCompareDriver();
  const loaded = useCompare((s) => !!s.payload);
  const t = useCompare((s) => s.t);
  const playing = useCompare((s) => s.playing);
  if (!loaded) return null;
  const st = useCompare.getState();
  const done = !playing && t >= COMPARE_TOTAL_S;
  return (
    <section aria-label="Trip controls" data-testid="compare-controls" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {player && (
          <>
            <button
              type="button"
              className={btn}
              aria-pressed={playing}
              onClick={() => (playing ? st.pause() : st.play())}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className={btn} onClick={() => st.restart()}>
              {done ? "Replay" : "Restart"}
            </button>
          </>
        )}
        <button type="button" className={btn} onClick={exitTrip}>
          Exit trip
        </button>
      </div>
      {player && (
        <input
          type="range"
          aria-label="Trip position"
          aria-valuetext={`${t.toFixed(0)} of ${COMPARE_TOTAL_S} seconds`}
          className="w-full"
          min={0}
          max={COMPARE_TOTAL_S}
          step="any"
          value={t}
          onChange={(e) => st.seek(Number(e.target.value))}
          onKeyDown={(e) => {
            const d =
              e.key === "ArrowRight" || e.key === "ArrowUp"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? -1
                  : 0;
            if (!d) return;
            e.preventDefault();
            st.seek(useCompare.getState().t + d);
          }}
        />
      )}
    </section>
  );
}

export function CompareControls() {
  return <CompareControlsView player={useEffectiveView() !== "list"} />;
}

/** Controls only on the answer whose compare the player holds; gone after Exit or another answer's Watch. */
export function OwnCompareControls({ compare }: { compare: CompareIntent }) {
  // by route ids: the demo preset loads the scene store's copy of the same intent
  const mine = useCompare(
    (s) =>
      !!s.payload &&
      s.payload.recommended?.id === compare.recommended?.id &&
      s.payload.fastest?.id === compare.fastest?.id,
  );
  return mine ? <CompareControls /> : null;
}
