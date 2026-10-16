import { useDay } from "../../../lib/api";
import { binAt, DAY_LEGEND, hhmm, stageAt } from "../../day/dayModel";
import { useScene } from "../sceneStore";

type Bin = { t: number; walking: number; driving: number; waiting: number };

/** Elmina Day in the list view: the clock and what the residents are doing, as text. */
export function DayListSection() {
  const on = useScene((s) => s.day.on);
  const t = useScene((s) => s.day.t);
  const playing = useScene((s) => s.day.playing);
  const scenario = useScene((s) => s.day.scenario);
  const day = { on, t, scenario };
  const q = useDay(scenario, on);
  const d = q.data as
    | { scenario?: { label?: string; stages?: [number, string | null][] }; timeline?: Bin[] }
    | undefined;
  if (!day.on || !d) return null;
  const bin = binAt(d.timeline ?? [], day.t);
  const stage = stageAt(d.scenario?.stages ?? [], day.t);
  return (
    <section
      aria-labelledby="day-h"
      className="rounded-lg border border-dashed border-lilac bg-card p-4"
    >
      <h2 id="day-h" className="text-xl font-semibold">
        {d.scenario?.label ?? "Simulated day"} · {hhmm(day.t)}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">{DAY_LEGEND}</p>
      {/* announced only when the clock is stopped, not ten times a second */}
      <p className="mt-2 text-sm" aria-live={playing ? "off" : "polite"}>
        {bin?.walking ?? 0} walking, {bin?.driving ?? 0} driving, {bin?.waiting ?? 0} waiting for a
        way through.{" "}
        {stage
          ? `River ${stage.replace("stage_p", "+").replace("m", " m")} (indicative scenario).`
          : "River at its normal level."}
      </p>
    </section>
  );
}
