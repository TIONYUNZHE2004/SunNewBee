import { optionLabel } from "./attributeCatalogue";

const REASON_LABELS: Record<string, string> = {
  no_route_unverified_segment: "No route: unverified segment",
};

/** Staff-facing reason: "no_route_unverified_segment" -> "No route: unverified segment". */
export function reasonLabel(r: string): string {
  return REASON_LABELS[r] ?? optionLabel(r);
}

type Feature = { geometry?: { type?: string } | null; properties?: Record<string, unknown> | null };

/** Segment id -> display name from the access layer: its OSM name, else "Unnamed footway / street / major road".
 * Point names come from `useElementNames` and are merged by the caller. */
export function edgeNames(layer: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const feats = (layer as { features?: Feature[] } | null | undefined)?.features ?? [];
  for (const f of feats) {
    if (f?.geometry?.type !== "LineString") continue;
    const p = f.properties ?? {};
    if (!p.id) continue;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const type = typeof p.type === "string" && p.type ? p.type : "footway";
    out.set(String(p.id), name || `Unnamed ${type.replaceAll("_", " ")}`);
  }
  return out;
}
