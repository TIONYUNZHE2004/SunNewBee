import { claimBadge, PLACEHOLDER_SOURCE } from "../../lib/evidence";
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
}

export interface PlaceView {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  rows: ClaimRow[];
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
  const claims = (d.claims ?? {}) as Record<string, Record<string, unknown> | null>;
  const rows = Object.keys(claims)
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
      };
    });
  const type = String(d.type ?? "other");
  return { id: String(d.id), name: String(d.name), type, typeLabel: humanType(type), rows };
}
