import {
  ESTIMATE_BADGE,
  ESTIMATE_FOOTNOTE,
  formatDays,
  formatRmMillions,
  monthLabel,
} from "./copy";
import type { EstimateSource, Schedule } from "./planTypes";
import type { ScheduleAt } from "./schedulePlayback";
import type { StateAt } from "./types";

function Cell({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="px-2 text-center">
      <b data-testid={id} className="block whitespace-nowrap text-lg tabular-nums leading-tight">
        {value}
      </b>
      <span className="text-[11px] uppercase tracking-wide text-fg">{label}</span>
    </div>
  );
}

/**
 * Development Simulation HUD (spec §4.1): Act · Simulated time · Homes occupied. Display values of
 * the simulation clock, under the "Simulation · illustrative" badge; never cited as facts (§3).
 * Kept for the 66 s timeline until C7/C11 swap in `EstimateHud`.
 */
export function DevsimHud({ state }: { state: StateAt }) {
  return (
    <div data-testid="devsim-hud" aria-live="off" className="glass rounded-2xl px-2 py-1.5 text-fg">
      <div className="grid grid-cols-3 gap-1">
        <Cell id="devsim-hud-act" value={state.act} label="Act" />
        <Cell id="devsim-hud-when" value={state.simClock.label} label="Simulated time" />
        <Cell id="devsim-hud-homes" value={String(state.occupancy)} label="Homes occupied" />
      </div>
    </div>
  );
}

/** The ESTIMATE badge's tooltip: the schedule's source line, then each source row it used. */
export function estimateTooltip(schedule: Schedule, sources: readonly EstimateSource[]): string {
  const used = new Set(schedule.source_ids);
  const rows = sources
    .filter((s) => used.has(s.id))
    .map(
      (s) => `${s.label}: ${s.value} ${s.unit}${s.kind === "assumption" ? " (assumption)" : ""}`,
    );
  return [schedule.source_line, ...rows].join("\n");
}

/** Fixed pair, ≥ 4.5:1 on both skins (prototype `#hud em` amber). */
export const ESTIMATE_STYLE = { bg: "#fff1c9", fg: "#6b4e00" };

/** The ESTIMATE chip with its source tooltip (spec §3: every estimate carries the badge). */
export function EstimateBadge({ tooltip }: { tooltip: string }) {
  return (
    <span
      data-testid="devsim-estimate-badge"
      title={tooltip}
      className="inline-block rounded-md px-1.5 text-[10px] font-bold tracking-wide"
      style={{ background: ESTIMATE_STYLE.bg, color: ESTIMATE_STYLE.fg }}
    >
      {ESTIMATE_BADGE}
      <span className="sr-only">: {tooltip}</span>
    </span>
  );
}

/**
 * Building HUD (prototype `#hud`; spec §6.2, AC-W2): Month, Floors x/storeys, Spent (est.),
 * Days lost, and the footnote "Estimate from published benchmarks" with the ESTIMATE badge.
 * Pure rendering of `at` (`scheduleAt`): the plan's numbers for the month shown.
 */
export function EstimateHud({
  schedule,
  at,
  sources,
}: {
  schedule: Schedule;
  at: ScheduleAt;
  sources: readonly EstimateSource[];
}) {
  return (
    <div
      data-testid="devsim-estimate-hud"
      data-beat="estimate-hud"
      data-month-index={at.monthIndex}
      aria-live="off"
      className="glass rounded-2xl px-2.5 py-2 text-fg"
    >
      <div className="grid grid-cols-4 gap-0.5">
        <Cell
          id="devsim-hud-month"
          value={monthLabel(at.ym)}
          label={`Month ${at.monthIndex + 1} of ${schedule.months_total}`}
        />
        <Cell id="devsim-hud-floors" value={`${at.floors}/${schedule.storeys}`} label="Floors" />
        <Cell id="devsim-hud-cost" value={formatRmMillions(at.costRm)} label="Spent (est.)" />
        <Cell id="devsim-hud-lost" value={formatDays(at.daysLost)} label="Days lost" />
      </div>
      <p
        data-testid="devsim-hud-footnote"
        className="m-0 mt-1 flex items-center justify-center gap-1.5 text-[11px] text-fg-soft"
      >
        <EstimateBadge tooltip={estimateTooltip(schedule, sources)} />
        <span>{ESTIMATE_FOOTNOTE}</span>
      </p>
    </div>
  );
}
