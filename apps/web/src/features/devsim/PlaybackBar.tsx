import { useDevsim } from "./devsimStore";
import { actAt } from "./timeline";
import { useDevsimDriver } from "./useDevsimDriver";

const btn =
  "inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border border-edge bg-raised px-3 text-sm font-semibold text-fg hover:border-fg/25 focus-visible:outline-2";

/**
 * Play / pause, restart, scrubber and act label (spec D6, AC-F6). `onClose` ends the simulation.
 */
export function PlaybackBar({ onClose }: { onClose?: () => void }) {
  useDevsimDriver();
  const plan = useDevsim((s) => s.plan);
  const t = useDevsim((s) => s.t);
  const playing = useDevsim((s) => s.playing);
  if (!plan) return null;
  const st = useDevsim.getState();
  const total = plan.total_s;
  return (
    <section
      aria-label="Simulation controls"
      data-testid="devsim-controls"
      className="glass flex w-full items-center gap-2 rounded-full px-3 py-2"
    >
      <button
        type="button"
        className={btn}
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => (playing ? st.pause() : st.play())}
      >
        <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
      </button>
      <button type="button" className={btn} aria-label="Restart" onClick={() => st.restart()}>
        <span aria-hidden="true">↺</span>
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round((t / total) * 1000)}
        aria-label="Simulation timeline"
        aria-valuetext={`${Math.round(t)} of ${Math.round(total)} seconds`}
        onChange={(e) => st.seek((Number(e.target.value) / 1000) * total)}
        className="min-w-20 flex-1 accent-[var(--c-fg)]"
      />
      <span data-testid="devsim-act" className="min-w-24 text-right text-xs font-semibold text-fg">
        {actAt(t, plan.acts).name}
      </span>
      {onClose && (
        <button type="button" className={btn} aria-label="Close simulation" onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </section>
  );
}
