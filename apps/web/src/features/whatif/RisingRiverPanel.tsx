import { useState } from "react";
import { useRiverRollout } from "../../lib/api";
import { Button } from "../../ui/Button";
import { useScene } from "../scene/sceneStore";
import { ROLLOUT_LEGEND, stageRows } from "./rolloutModel";
import { pct } from "./whatifModel";

const LABEL: Record<string, string> = {
  wheelchair: "Wheelchair",
  stroller: "Stroller",
  older_adult_rest: "Older adult",
  default: "Walking",
};

/** Management panel: synthetic residents per persona heading for the nearest evacuation centre
 * while the river rises stage by stage. Playback drives the 3D layer (RolloutLayer) and the
 * flood layer; every number is the engine's. A simulation, not a forecast. */
export function RisingRiverPanel() {
  const rollout = useScene((s) => s.rollout);
  const setRollout = useScene((s) => s.setRollout);
  const [open, setOpen] = useState(false);
  const shown = open || rollout.on;
  const q = useRiverRollout(shown);
  const d = q.data;
  const stages = d?.stages ?? [];
  const stage = stages[rollout.stage];

  if (!shown)
    return (
      <div className="border-b border-edge px-4 py-2">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Rising river
        </Button>
        <span className="ml-2 text-xs text-fg-soft">Who loses their route as the water rises?</span>
      </div>
    );

  return (
    <section
      aria-label="Rising river"
      className="max-h-[48vh] space-y-3 overflow-y-auto border-b border-edge px-4 py-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">Rising river · synthetic residents</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setRollout({ on: false, playing: false });
          }}
          className="min-h-11 rounded px-2 text-fg-soft hover:bg-raised"
        >
          Close
        </button>
      </div>
      <p role="note" className="rounded border border-dashed border-lilac p-2 text-xs text-fg">
        {d?.disclaimer ?? ROLLOUT_LEGEND}
      </p>
      {q.isFetching && <p className="text-fg-soft">Simulating synthetic residents…</p>}
      {q.isError && <p role="alert">The rising-river simulation could not run.</p>}
      {d && (
        <>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">River level</legend>
            {stages.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={rollout.on && i === rollout.stage}
                onClick={() => setRollout({ on: true, stage: i, playing: false })}
                className={`min-h-11 rounded-full border px-3 text-xs ${
                  rollout.on && i === rollout.stage
                    ? "border-accent bg-accent text-on-accent"
                    : "border-edge bg-raised text-fg"
                }`}
              >
                {s.label}
              </button>
            ))}
            <Button
              onClick={() =>
                setRollout(
                  rollout.on && rollout.playing
                    ? { playing: false }
                    : {
                        on: true,
                        playing: true,
                        stage: rollout.stage >= stages.length - 1 ? 0 : rollout.stage,
                      },
                )
              }
            >
              {rollout.on && rollout.playing ? "Pause" : "Play"}
            </Button>
          </fieldset>
          <p aria-live="polite" className="sr-only">
            {stage ? `Showing ${stage.label}` : ""}
          </p>
          {stage && (
            <ul className="space-y-2" aria-label={`At ${stage.label}`}>
              {stageRows(d.counts, stage.id).map((r) => (
                <li key={r.profile}>
                  <div className="flex justify-between text-xs text-fg">
                    <span>{LABEL[r.profile] ?? r.profile}</span>
                    <span>
                      {r.reach} of {r.total} still reach a centre
                      {r.cutOff ? ` · ${r.cutOff} cut off` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-edge" aria-hidden="true">
                    <div
                      className="h-2 rounded bg-accent"
                      style={{ width: `${pct(r.reach, r.total)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
