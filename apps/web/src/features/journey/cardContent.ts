/** Card content for one journey event (spec §6.4/§6.5/§7). One pure function shared by every
 * renderer (Three.js EventCard, List view, Mapbox lite) so they cannot disagree. Dependency-free. */

export interface JourneyCardEvent {
  kind: string;
  title: string;
  body: string;
  status: string;
  demo: boolean;
  element_id?: string | null;
  source?: string | null;
}

export interface JourneyCard {
  title: string;
  body: string;
  /** Element id, else the route-level source, else "". */
  source: string;
  /** True exactly when event.demo is true: show "Demo value · not surveyed". */
  demoChip: boolean;
  /** Short status words. Never "Verified" for a demo event; unknown reads "Not checked yet". */
  statusLabel: string;
}

export const DEMO_CHIP_TEXT = "Demo value · not surveyed";
export const SIMULATION_LABEL = "Simulation · indicative times, not a prediction";

function statusLabel(e: JourneyCardEvent): string {
  if (e.demo) return DEMO_CHIP_TEXT;
  if (e.kind === "gap") return "No mapped rest stop ahead";
  switch (e.status) {
    case "verified":
      return "Verified";
    case "unknown":
      return "Not checked yet";
    case "reported":
      return "Reported, not checked";
    case "stale":
      return "Out of date";
    case "contested":
      return "Disputed";
    case "route":
      return "From the route";
    default:
      return "Not checked yet";
  }
}

export function journeyCardContent(e: JourneyCardEvent): JourneyCard {
  return {
    title: e.title,
    body: e.body,
    source: e.element_id || e.source || "",
    demoChip: e.demo === true,
    statusLabel: statusLabel(e),
  };
}
