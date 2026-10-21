import { forwardRef } from "react";
import { badgeTooltips } from "./buildModel";
import { matrixCellText, PROFILE_HEAD } from "./copy";
import type { BriefRow, BriefSection, DailyLifeMatrix } from "./planTypes";
import { SourceBadge } from "./SourceBadge";
import type { DevelopmentPlan } from "./types";

function Row({ row, tips }: { row: BriefRow; tips: ReturnType<typeof badgeTooltips> }) {
  return (
    <div
      data-testid="devsim-brief-row"
      data-key={row.key}
      className="flex justify-between gap-3 border-b border-dashed border-edge py-1 text-[13px] leading-snug"
    >
      <span>
        {row.label}
        {row.badges.map((b) => (
          <SourceBadge key={b} badge={b} tooltip={tips[b]} />
        ))}
      </span>
      <span className="text-right font-extrabold">{row.value}</span>
    </div>
  );
}

/** The daily-life walk minutes (prototype `#brief table`): targets × route profiles. */
export function MatrixTable({ matrix }: { matrix: DailyLifeMatrix }) {
  return (
    <table data-testid="devsim-brief-matrix" className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          <th scope="col" className="border-b border-dashed border-edge px-1 py-1 text-left">
            <span className="sr-only">Place</span>
          </th>
          {matrix.profiles.map((p) => (
            <th
              key={p}
              scope="col"
              className="border-b border-dashed border-edge px-1 py-1 text-center font-semibold text-fg-soft"
            >
              {PROFILE_HEAD[p] ?? p}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.rows.map((r) => (
          <tr key={r.target.id}>
            <th
              scope="row"
              className="border-b border-dashed border-edge px-1 py-1 text-left font-normal"
            >
              {r.target.name}
            </th>
            {r.cells.map((c) => {
              const v = matrixCellText(c.value);
              return (
                <td
                  key={c.profile}
                  title={v.title}
                  data-value={String(c.value)}
                  className={`border-b border-dashed border-edge px-1 py-1 text-center ${
                    v.unknown ? "font-extrabold underline decoration-dotted" : ""
                  }`}
                >
                  {v.text}
                  <span className="sr-only"> ({v.title})</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ s, plan }: { s: BriefSection; plan: DevelopmentPlan }) {
  const tips = badgeTooltips(plan);
  // the flood line always carries the disclaimer, even if a plan's notes were to leave it out
  const notes =
    s.key === "handover" && !s.notes.some((n) => n.includes(plan.flood.disclaimer))
      ? [plan.flood.disclaimer, ...s.notes]
      : s.notes;
  return (
    <section
      data-testid="devsim-brief-section"
      data-section={s.key}
      aria-labelledby={`devsim-brief-${s.key}`}
      className="border-t-2 border-edge py-2"
    >
      <h3
        id={`devsim-brief-${s.key}`}
        className="m-0 mb-1 text-xs font-bold uppercase tracking-[.07em] text-fg-soft"
      >
        {s.title}
      </h3>
      {s.rows.map((r) => (
        <Row key={r.key} row={r} tips={tips} />
      ))}
      {s.key === "daily_life" && <MatrixTable matrix={plan.access_matrix} />}
      {notes.map((n) => (
        <p key={n} data-testid="devsim-brief-note" className="m-0 mt-1 text-[11px] text-fg-soft">
          {n}
        </p>
      ))}
    </section>
  );
}

/**
 * Impact brief (prototype `#brief`; spec §6.2, AC-W6): During construction / At handover / Daily
 * life, each row with its source badges (ROUTE, FLOOD, ESTIMATE, CALENDAR; the tooltip names the
 * source). Every label and value is the plan's `brief`, verbatim; the daily-life table is the
 * plan's `access_matrix`. `inline` lays it out in the flow (the List text version).
 */
export const ImpactBrief = forwardRef<
  HTMLElement,
  { plan: DevelopmentPlan; inline?: boolean; style?: React.CSSProperties }
>(function ImpactBrief({ plan, inline = false, style }, ref) {
  const b = plan.brief;
  return (
    <aside
      ref={ref}
      aria-label={b.title}
      data-testid="devsim-impact-brief"
      data-beat="impact-brief"
      data-devsim="brief"
      style={style}
      className={`bg-surface text-fg ${
        inline
          ? "rounded-lg border border-edge p-4"
          : "h-full overflow-y-auto border-l-2 border-edge px-4 pt-3.5 pb-6 shadow-[var(--c-shadow)]"
      }`}
    >
      <h2 className="m-0 text-lg font-bold">{b.title}</h2>
      <p className="mt-0.5 mb-2.5 text-xs text-fg-soft">{b.subtitle}</p>
      {b.sections.map((s) => (
        <Section key={s.key} s={s} plan={plan} />
      ))}
    </aside>
  );
});
