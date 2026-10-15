import {
  COLLECTION_DAY_UNKNOWN,
  centreSourceLabel,
  claimBadge,
  PLACEHOLDER_SOURCE,
} from "../../lib/evidence";
import { originName } from "../../lib/placeQuery";
import { centreReachLabel } from "../../lib/routeStatus";
import { closureLine } from "../manage/closureModel";
import { humanType } from "../scene/list/listModel";

export type ClaimStatus = "unknown" | "reported" | "verified" | "stale" | "contested";

export const CLAIM_STATUS: Record<ClaimStatus, { label: string; icon: string }> = {
  verified: { label: "Verified", icon: "✓" },
  reported: { label: "Reported", icon: "i" },
  stale: { label: "Stale", icon: "⏱" },
  contested: { label: "Contested", icon: "!" },
  unknown: { label: "Not checked yet", icon: "?" },
};

export interface ClaimRow {
  attr: string;
  label: string;
  value: string;
  /** Raw claim value, used to prefill the staff editor. */
  raw: unknown;
  isUnknown: boolean;
  status: ClaimStatus;
  statusLabel: string;
  icon: string;
  verifiedAt: string | null;
  source: string | null;
  placeholder: boolean;
  /** Stored photo for this claim (API path), when its evidence has one. */
  photoUrl: string | null;
}

export type PlaceKind = "place" | "evac_centre" | "waste_point";

export interface PlaceView {
  kind: PlaceKind;
  /** Prominent source label for centres and waste points; null for access places. */
  sourceLabel: string | null;
  sourceTone: "official" | "candidate" | "waste" | null;
  reachability: { label: string; origin: string; disclaimer: string | null } | null;
  /** Waste points only. We never invent a schedule. */
  collectionDay: string | null;
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  rows: ClaimRow[];
  /** Staff-reported closures in force at this place; empty when none. */
  closures: { label: string; line: string; note: string | null }[];
}

const label = (attr: string) => {
  const s = attr.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function formatValue(v: unknown): { text: string; isUnknown: boolean } {
  if (v === null || v === undefined || v === "") return { text: "unknown", isUnknown: true };
  if (v === true) return { text: "Yes", isUnknown: false };
  if (v === false) return { text: "No", isUnknown: false };
  if (typeof v === "object") return { text: JSON.stringify(v), isUnknown: false };
  return { text: String(v), isUnknown: false };
}

/** Turns a `GET /places/{id}` ToolResult into display rows. Pure and tolerant of loose data. */
export function toPlaceView(result: unknown): PlaceView | null {
  const r = result as { ok?: boolean; data?: Record<string, unknown> | null } | null | undefined;
  if (!r?.ok || !r.data || typeof r.data !== "object") return null;
  const d = r.data;
  if (!d.id || !d.name) return null;
  const kind: PlaceKind = d.kind === "evac_centre" || d.kind === "waste_point" ? d.kind : "place";
  const claims = (d.claims ?? {}) as Record<string, Record<string, unknown> | null>;
  const photos = new Map<string, string>();
  for (const e of Array.isArray((r as { evidence?: unknown }).evidence)
    ? ((r as { evidence: unknown[] }).evidence as Record<string, unknown>[])
    : []) {
    if (
      e &&
      e.element_id === d.id &&
      typeof e.attribute === "string" &&
      typeof e.photo_url === "string" &&
      e.photo_url
    )
      photos.set(e.attribute, e.photo_url);
  }
  const rows = Object.keys(claims)
    .filter((attr) => !(kind === "evac_centre" && attr === "source"))
    .sort()
    .map((attr): ClaimRow => {
      const c = claims[attr] ?? {};
      const status: ClaimStatus =
        typeof c.status === "string" && c.status in CLAIM_STATUS
          ? (c.status as ClaimStatus)
          : "unknown";
      const v = formatValue(c.value);
      const src = typeof c.evidence_type === "string" && c.evidence_type ? c.evidence_type : null;
      const badge = claimBadge(
        src,
        CLAIM_STATUS[status],
        typeof c.verified_at === "string" && c.verified_at ? c.verified_at.slice(0, 10) : null,
      );
      return {
        attr,
        label: label(attr),
        value: v.text,
        raw: c.value ?? null,
        isUnknown: v.isUnknown,
        status,
        statusLabel: badge.label,
        icon: badge.icon,
        verifiedAt: badge.verifiedAt,
        source: src && src !== PLACEHOLDER_SOURCE ? src : null,
        placeholder: badge.demo,
        photoUrl: badge.demo ? null : (photos.get(attr) ?? null),
      };
    });
  const type = String(d.type ?? "other");
  const closures = (Array.isArray(d.closures) ? d.closures : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => c.active !== false && typeof c.label === "string")
    .map((c) => ({
      label: String(c.label),
      line: closureLine({ label: String(c.label), starts_at: String(c.starts_at ?? "") }),
      note: typeof c.note === "string" && c.note ? c.note : null,
    }));
  const reach = d.reachability as Record<string, unknown> | null | undefined;
  const official = kind === "evac_centre" && d.source === "official_pps";
  return {
    kind,
    sourceLabel:
      kind === "evac_centre"
        ? centreSourceLabel(d.source)
        : kind === "waste_point"
          ? String(d.source_label ?? `Waste point: ${String(d.status ?? "unknown")}`)
          : null,
    sourceTone:
      kind === "evac_centre"
        ? official
          ? "official"
          : "candidate"
        : kind === "waste_point"
          ? "waste"
          : null,
    reachability:
      kind === "evac_centre" && reach
        ? {
            label: centreReachLabel({
              reachable: reach.reachable === true,
              route_status: String(reach.route_status ?? "no_data"),
            }),
            origin: originName(typeof reach.from === "string" ? reach.from : null),
            disclaimer: typeof reach.disclaimer === "string" ? reach.disclaimer : null,
          }
        : null,
    collectionDay: kind === "waste_point" ? COLLECTION_DAY_UNKNOWN : null,
    id: String(d.id),
    name: String(d.name),
    type,
    typeLabel: kind === "evac_centre" ? "Evacuation centre" : humanType(type),
    rows,
    closures,
  };
}
