import { holidayTooltip, monthLabel, monthShort, SCHEDULE_LEGEND } from "./copy";
import type { Schedule } from "./planTypes";
import { monthIndex, monthOf } from "./schedulePlayback";

/** Prototype `#tl` colours (fixed: they read on both skins' paper). */
const HOLIDAY = "#c0566b";
const MONSOON =
  "repeating-linear-gradient(135deg, rgba(79,127,209,.28) 0 6px, rgba(79,127,209,.12) 6px 12px)";
const PROGRESS = "#ffd98a";

const pct = (m: number, total: number) => `${(Math.max(0, Math.min(total, m)) / total) * 100}%`;

/** "Nov–Mar" from the widest monsoon band (bands at the project's ends are clipped). */
export function monsoonSpan(schedule: Schedule): string | null {
  const b = [...schedule.monsoon_bands].sort(
    (x, y) => y.end_index - y.start_index - (x.end_index - x.start_index),
  )[0];
  if (!b) return null;
  const m = (ym: string) => Number(ym.split("-")[1]);
  return `${monthShort(m(b.start_month))}–${monthShort(m(b.end_month))}`;
}

/** True when any holiday on the bar is not yet gazetted (its date is an expected date). */
export const hasExpected = (schedule: Schedule) =>
  schedule.holidays.some((x) => x.status !== "gazetted");

/** Year labels: the start, each January in between, and the handover month. */
function yearMarks(schedule: Schedule): { at: number; text: string; edge?: "start" | "end" }[] {
  const n = schedule.months_total;
  const out: { at: number; text: string; edge?: "start" | "end" }[] = [
    { at: 0, text: `${monthLabel(schedule.months[0] ?? "")} · start`, edge: "start" },
  ];
  schedule.months.forEach((ym, i) => {
    // keep clear of the edge labels
    if (i > 0 && ym.endsWith("-01") && i / n > 0.14 && i / n < 0.84)
      out.push({ at: i, text: monthLabel(ym) });
  });
  out.push({
    at: n,
    text: `${monthLabel(schedule.months[n - 1] ?? "")} · handover`,
    edge: "end",
  });
  return out;
}

/**
 * Building timeline bar (prototype `#tl`; spec §6.2, AC-W1): start month -> handover, monsoon
 * bands, one tick per public holiday (tooltip: the name, plus "expected" when not gazetted), the
 * Hari Raya set-piece tick emphasised, progress fill and a now-marker at `month` (fractional; the
 * marker's month index is the HUD month). Pure rendering: every value comes from `schedule`.
 */
export function ScheduleBar({ schedule, month }: { schedule: Schedule; month: number }) {
  const n = schedule.months_total;
  const now = monthIndex(schedule, month);
  const raya = schedule.raya_set_piece?.date ?? null;
  const span = monsoonSpan(schedule);
  const expected = hasExpected(schedule);
  const summary = `Schedule estimate from ${monthLabel(schedule.months[0] ?? "")} to ${monthLabel(
    schedule.months[n - 1] ?? "",
  )}; now ${monthLabel(schedule.months[now] ?? "")}, month ${now + 1} of ${n}`;
  return (
    <section
      aria-label="Building timeline"
      data-testid="devsim-schedule-bar"
      data-beat="schedule-bar"
      className="glass rounded-2xl px-3.5 pt-2.5 pb-2 text-fg"
    >
      <div
        role="img"
        aria-label={summary}
        data-testid="devsim-schedule-track"
        className="relative h-[22px] overflow-hidden rounded-lg bg-raised"
      >
        <div
          data-testid="devsim-schedule-fill"
          className="absolute inset-y-0 left-0"
          style={{ width: pct(month, n), background: PROGRESS }}
        />
        {schedule.monsoon_bands.map((b) => (
          <div
            key={b.start_month}
            data-testid="devsim-monsoon-band"
            data-start={b.start_index}
            data-end={b.end_index}
            title={SCHEDULE_LEGEND.monsoon(
              `${monthLabel(b.start_month)}–${monthLabel(b.end_month)}`,
            )}
            className="absolute inset-y-0"
            style={{
              left: pct(b.start_index, n),
              width: pct(b.end_index + 1 - b.start_index, n),
              background: MONSOON,
            }}
          />
        ))}
        {schedule.holidays.map((h) => {
          const big = h.date === raya;
          return (
            <div
              key={`${h.date}-${h.name}`}
              data-testid="devsim-holiday-tick"
              data-date={h.date}
              data-status={h.status}
              data-emphasis={big ? "raya" : undefined}
              title={holidayTooltip(h)}
              className={`absolute ${big ? "inset-y-0 w-1 opacity-100" : "inset-y-[3px] w-0.5 opacity-55"}`}
              style={{ left: pct(monthOf(schedule, h.date), n), background: HOLIDAY }}
            />
          );
        })}
        <div
          data-testid="devsim-schedule-now"
          data-month-index={now}
          className="absolute -inset-y-[3px] w-[3px] rounded-sm bg-fg"
          style={{ left: `calc(${pct(month, n)} - 1px)` }}
        />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-fg-soft">
        {yearMarks(schedule).map((y) => (
          <span
            key={y.text}
            className="absolute whitespace-nowrap"
            style={
              y.edge === "start"
                ? { left: 0 }
                : y.edge === "end"
                  ? { right: 0 }
                  : { left: pct(y.at, n), transform: "translateX(-50%)" }
            }
          >
            {y.text}
          </span>
        ))}
      </div>
      <ul
        data-testid="devsim-schedule-legend"
        className="m-0 mt-0.5 flex list-none flex-wrap gap-x-3.5 gap-y-0.5 p-0 text-[11px] text-fg-soft"
      >
        <li>
          <i
            aria-hidden="true"
            className="mr-1 inline-block h-2 w-0.5 align-[0]"
            style={{ background: HOLIDAY }}
          />
          {SCHEDULE_LEGEND.holiday}
        </li>
        {raya && (
          <li>
            <i
              aria-hidden="true"
              className="mr-1 inline-block h-2 w-1 align-[0]"
              style={{ background: HOLIDAY }}
            />
            {SCHEDULE_LEGEND.raya}
          </li>
        )}
        {span && (
          <li>
            <i
              aria-hidden="true"
              className="mr-1 inline-block h-2 w-3 rounded-sm align-[0]"
              style={{ background: MONSOON }}
            />
            {SCHEDULE_LEGEND.monsoon(span)}
          </li>
        )}
        <li>
          <i
            aria-hidden="true"
            className="mr-1 inline-block h-2 w-3 rounded-sm align-[0]"
            style={{ background: PROGRESS }}
          />
          {SCHEDULE_LEGEND.progress}
        </li>
        {expected && <li>{SCHEDULE_LEGEND.expected}</li>}
      </ul>
    </section>
  );
}
