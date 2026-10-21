import type { BriefBadge } from "./planTypes";

export type SourceBadgeKind = BriefBadge | "ROUTE ENGINE" | "SIMULATED";

/**
 * Source chip colours (prototype `#brief .badge`): fixed pairs, readable in both skins
 * (≥ 4.5:1, see contrast test).
 */
export const BADGE_STYLE: Record<SourceBadgeKind, { bg: string; fg: string }> = {
  "ROUTE ENGINE": { bg: "#dcebfb", fg: "#1d4f86" },
  SIMULATED: { bg: "#f1e7ff", fg: "#5b3a8c" },
  ROUTE: { bg: "#e3f4ec", fg: "#1a6b4c" },
  FLOOD: { bg: "#e6eefc", fg: "#2b569f" },
  ESTIMATE: { bg: "#fff1c9", fg: "#6b4e00" },
  CALENDAR: { bg: "#fde7ea", fg: "#9a3347" },
};

/**
 * A source chip (ROUTE, FLOOD, ESTIMATE, CALENDAR; spec §6.2). `tooltip` names the source; it is
 * also read out to screen readers.
 */
export function SourceBadge({ badge, tooltip }: { badge: SourceBadgeKind; tooltip?: string }) {
  const s = BADGE_STYLE[badge];
  return (
    <span
      data-testid="devsim-source-badge"
      data-badge={badge}
      title={tooltip}
      className="ml-1.5 inline-block rounded-md px-1.5 align-[1px] text-[10px] font-bold tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {badge}
      {tooltip && <span className="sr-only">: {tooltip}</span>}
    </span>
  );
}
