/**
 * Pure helpers for the 45 s building overlay (spec 2026-10-21 §6.2, §6.3; AC-W6, W8, W9): which
 * banners, tags and cards are on at t, the source tooltip of each badge, and the §6.3 beat ids the
 * test hook reports. Every value is the plan's; nothing here computes a fact.
 */
import {
  CALENDAR_SOURCE,
  FLOOD_SOURCE,
  HOARDING_CARD,
  ROUTE_SOURCE,
  SCHEDULE_LEGEND,
} from "./copy";
import { estimateTooltip } from "./DevsimHud";
import type { Banner, BriefBadge, BriefRow, TimedTag } from "./planTypes";
import { RES_BUTTON_AT, RES_DETAIL_AT, RES_PANEL_AT } from "./residents/residentsScript";
import { monthAt, planPlayback, scheduleAt } from "./schedulePlayback";
import { BUILD_T, buildOccupancyAt } from "./timeline";
import type { DevelopmentPlan } from "./types";

const on = (t: number, w: { t0: number; t1: number }) => t >= w.t0 && t < w.t1;

/** The hoarding impact card's screen window (prototype `#hoard`: 4–9.5 s, with the detour tag). */
export const HOARDING_CARD_WINDOW = { t0: 4, t1: 9.5 } as const;

/** Banners on screen at t (the plan's windows, title and text). */
export const bannersAt = (plan: DevelopmentPlan, t: number): Banner[] =>
  plan.banners.filter((b) => on(t, b));

/** Tags (detour, lorry route) on screen at t. */
export const tagsAt = (plan: DevelopmentPlan, t: number): TimedTag[] =>
  plan.tags.filter((g) => on(t, g));

export const hoardingCardOn = (t: number) => on(t, HOARDING_CARD_WINDOW);

/** The brief's construction rows the hoarding card shows, in card order (labels from the plan). */
export function hoardingRows(plan: DevelopmentPlan): BriefRow[] {
  const rows = plan.brief.sections.find((s) => s.key === "construction")?.rows ?? [];
  return HOARDING_CARD.rows
    .map((k) => rows.find((r) => r.key === k))
    .filter((r): r is BriefRow => !!r);
}

const tooltipCache = new WeakMap<DevelopmentPlan, Record<BriefBadge, string>>();

/** Each badge's source tooltip (spec §3: every estimate carries its source line). */
export function badgeTooltips(plan: DevelopmentPlan): Record<BriefBadge, string> {
  const hit = tooltipCache.get(plan);
  if (hit) return hit;
  const sch = plan.schedule;
  const expected = sch.holidays.filter((h) => h.status !== "gazetted").length;
  const calendarRows = plan.estimate_sources
    .filter(
      (s) =>
        s.kind === "climatology" || s.kind === "gazetted" || s.id === "raya_shutdown_working_days",
    )
    .map(
      (s) => `${s.label}: ${s.value} ${s.unit}${s.kind === "assumption" ? " (assumption)" : ""}`,
    );
  const out: Record<BriefBadge, string> = {
    ROUTE: ROUTE_SOURCE(plan.impact.provenance),
    FLOOD: FLOOD_SOURCE(plan.flood.scenarios_checked, plan.flood.disclaimer),
    ESTIMATE: estimateTooltip(sch, plan.estimate_sources),
    CALENDAR: [
      CALENDAR_SOURCE(sch.holidays.length, expected),
      ...(expected > 0 ? [SCHEDULE_LEGEND.expected] : []),
      ...calendarRows,
    ].join("\n"),
  };
  tooltipCache.set(plan, out);
  return out;
}

/**
 * The §6.3 beat ids live at t (`window.__tl.demo.state().beats`): the same names the overlay's
 * `data-beat` attributes carry.
 */
export function buildBeatsAt(plan: DevelopmentPlan, t: number): string[] {
  const out: string[] = [];
  if (t < BUILD_T.construction[0]) out.push("brief-overview");
  if (t >= BUILD_T.hoarding[0] && t < BUILD_T.hoarding[1]) out.push("hoarding");
  if (hoardingCardOn(t)) out.push("hoarding-card");
  for (const g of tagsAt(plan, t)) out.push(`${g.kind}-tag`);
  for (const b of bannersAt(plan, t)) out.push(`banner-${b.kind}`);
  for (const b of plan.bubbles) if (on(t, b)) out.push(`bubble-${b.n}`);
  if (t >= BUILD_T.construction[0] && t < BUILD_T.construction[1]) out.push("construction");
  if (t >= BUILD_T.handover[0] && t < BUILD_T.handover[1]) out.push("move-in");
  if (t >= BUILD_T.brief) out.push("impact-brief");
  if (t >= RES_BUTTON_AT) out.push("residents-button");
  if (t >= RES_PANEL_AT) out.push("residents-panel-tap");
  if (t >= RES_DETAIL_AT) out.push("resident-detail-tap");
  return out;
}

/** The HUD at t: the schedule row for the month shown, and homes occupied from handover. */
export function hudAt(plan: DevelopmentPlan, t: number) {
  const m = monthAt(t, planPlayback(plan).keys);
  return {
    month: m,
    at: scheduleAt(plan.schedule, m),
    occupancy:
      t >= BUILD_T.handover[0] ? { n: buildOccupancyAt(t, plan), homes: plan.site.homes } : null,
  };
}
