import type { Schemas } from "@tl/api-client";

export type Closure = Schemas["ClosureOut"];
export type CreateClosureBody = Schemas["CreateClosureBody"];

export const CLOSURE_SOURCE = "Reported closure (staff)";
export const CLOSURE_REASONS = [
  ["works", "Works"],
  ["event", "Event"],
  ["flooding", "Flooding"],
  ["other", "Other"],
] as const;

export type ClosureFields = {
  elementId: string;
  reason: string;
  /** `datetime-local` value, local time; "" means "now". */
  startsAt: string;
  /** `datetime-local` value, local time; "" means "until further notice". */
  endsAt: string;
  note: string;
};

export const EMPTY_FIELDS: ClosureFields = {
  elementId: "",
  reason: "works",
  startsAt: "",
  endsAt: "",
  note: "",
};

const parse = (v: string): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Validate the form and build the POST body (ISO instants), or return the message to show. */
export function buildCreateBody(
  f: ClosureFields,
  now: Date = new Date(),
): { body: CreateClosureBody } | { error: string } {
  const elementId = f.elementId.trim();
  if (!elementId) return { error: "Pick a place or enter an element id" };
  const start = parse(f.startsAt);
  const end = parse(f.endsAt);
  if (f.startsAt && !start) return { error: "Start is not a valid date" };
  if (f.endsAt && !end) return { error: "End is not a valid date" };
  if (end && end <= (start ?? now)) return { error: "End must be after the start" };
  const note = f.note.trim();
  return {
    body: {
      element_id: elementId,
      reason: f.reason as CreateClosureBody["reason"],
      ...(start ? { starts_at: start.toISOString() } : {}),
      ...(end ? { ends_at: end.toISOString() } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/** "2026-10-15" from an ISO instant. */
export const closureDay = (iso: string): string => iso.slice(0, 10);

/** One line for residents and staff. Always names the source; never claims a place is safe. */
export function closureLine(c: Pick<Closure, "label" | "starts_at">): string {
  return `${CLOSURE_SOURCE}: ${c.label} (reported from ${closureDay(c.starts_at)})`;
}

export type ClosureState = "active" | "scheduled" | "ended";
export function closureState(c: Closure): ClosureState {
  if (c.active) return "active";
  return c.ends_at && new Date(c.ends_at) <= new Date() ? "ended" : "scheduled";
}
