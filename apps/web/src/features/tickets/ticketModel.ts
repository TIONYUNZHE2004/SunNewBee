import { attributeLabel } from "./attributeCatalogue";
import type { VR } from "./manageApi";
import { reasonLabel } from "./queueLabels";
import { currentValueText, hasCurrentValue } from "./resolveForm";

export interface Ticket {
  id: string;
  /** Attribute key, e.g. step_count (drives the value input). */
  attribute: string;
  fact: string;
  place: string;
  reason: string;
  reasonLabel: string;
  kind: string;
  asked: number;
  ago: string;
  current: string | null;
  hasCurrent: boolean;
  isOpen: boolean;
  isRejected: boolean;
  isChecked: boolean;
  resolution: {
    outcome: "verify" | "correct" | "reject";
    value: string | null;
    date: string;
  } | null;
  /** Epoch ms of creation, for ordering. */
  createdMs: number;
  /** Epoch ms of resolution (creation when unresolved), for ordering. */
  resolvedMs: number;
}

export function timeAgo(iso: string, now: Date): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const formatDate = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso)) : "");

export function toTicket(vr: VR, names: Map<string, string>, now: Date = new Date()): Ticket {
  const hasCurrent = hasCurrentValue(vr.current_value);
  const isRejected = vr.status === "rejected";
  const outcome = vr.resolution?.action;
  const rv = vr.resolution?.value;
  return {
    id: vr.id,
    attribute: vr.attribute,
    fact: attributeLabel(vr.attribute),
    place: names.get(vr.element_id) ?? vr.element_id,
    reason: vr.reason,
    reasonLabel: reasonLabel(vr.reason),
    kind: vr.question_summary ?? "Resident question",
    asked: vr.demand,
    ago: timeAgo(vr.created_at, now),
    current: hasCurrent ? currentValueText(vr.current_value) : null,
    hasCurrent,
    isOpen: vr.status === "open" || vr.status === "in_progress",
    isRejected,
    isChecked: vr.status === "resolved" || isRejected,
    resolution:
      outcome === "verify" || outcome === "correct" || outcome === "reject"
        ? {
            outcome,
            value: rv === undefined || rv === null ? null : currentValueText(rv),
            date: formatDate(vr.resolved_at),
          }
        : null,
    createdMs: new Date(vr.created_at).getTime(),
    resolvedMs: new Date(vr.resolved_at ?? vr.created_at).getTime(),
  };
}

export function groupTickets(ts: Ticket[]): { toCheck: Ticket[]; checked: Ticket[] } {
  const toCheck = ts
    .filter((t) => t.isOpen)
    .sort((a, b) => b.asked - a.asked || b.createdMs - a.createdMs);
  const checked = ts.filter((t) => t.isChecked).sort((a, b) => b.resolvedMs - a.resolvedMs);
  return { toCheck, checked };
}
