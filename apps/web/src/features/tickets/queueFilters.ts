export type QueueTab = "open" | "resolved" | "all";
export type VrFilters = { tab: QueueTab; reason: string; attribute: string; elementId: string };

export const DEFAULT_FILTERS: VrFilters = { tab: "open", reason: "", attribute: "", elementId: "" };

export const TAB_LABELS: Record<QueueTab, string> = {
  open: "Open",
  resolved: "Resolved",
  all: "All",
};

export const REASONS = [
  "unknown",
  "stale",
  "contradicted",
  "no_route_unverified_segment",
  "missing_place",
  "user_report",
] as const;

/** Query string for GET /verification-requests; blank filters are left out. */
export function buildVrQuery(f: VrFilters): string {
  const p = new URLSearchParams({ status: f.tab });
  if (f.reason) p.set("reason", f.reason);
  const attr = f.attribute.trim();
  if (attr) p.set("attribute", attr);
  const el = f.elementId.trim();
  if (el) p.set("element_id", el);
  return `?${p.toString()}`;
}

/** Prefixed with ["manage","vrs"] so one invalidation refreshes every filter view. */
export const vrQueryKey = (f: VrFilters) =>
  ["manage", "vrs", f.tab, f.reason, f.attribute.trim(), f.elementId.trim()] as const;
