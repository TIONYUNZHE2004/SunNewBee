import type { JourneyEvent } from "./timeline";

/**
 * The one place journey card wording is decided (3D event cards, and the List / Mapbox step list).
 * Dependency-free and pure. Honesty rules (AGENTS.md, spec §7):
 * - the "Demo value · not surveyed" chip shows exactly when `event.demo` is true;
 * - "Verified" only for a verified claim that is not a demo value;
 * - UNKNOWN facts say "Not checked yet"; "verification request filed" only when one was filed
 *   (`withVerificationRequest`), since the plan itself does not say so;
 * - the rest gap is named as a data gap, never "blocked" or "unsafe".
 * Title and body are the plan's own text (built from world data by `journey.build_journey`).
 */
export interface JourneyCardContent {
  title: string;
  body: string;
  /** Where the fact comes from and how sure it is, e.g. "Not checked yet". */
  source: string;
  /** Show the "Demo value · not surveyed" chip. */
  demoChip: boolean;
  /** Short badge text for the card's kind, e.g. "Data gap". */
  statusLabel: string;
}

export const DEMO_CHIP = "Demo value · not surveyed";
export const NOT_CHECKED = "Not checked yet";
export const VR_FILED = "verification request filed";

/** How sure a claim is, in words; never "verified" for a demo value. */
function certainty(e: JourneyEvent): string {
  switch (e.status) {
    case "verified":
      return e.demo ? "demo value" : "verified";
    case "reported":
      return "reported, not checked yet";
    case "stale":
      return "checked a while ago, needs a re-check";
    case "contested":
      return "reports disagree";
    default:
      return "not checked yet";
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function label(e: JourneyEvent): string {
  switch (e.kind) {
    case "unknown":
      return NOT_CHECKED;
    case "gap":
      return "Data gap";
    case "arrive":
      return "Destination";
    case "rest":
      return e.status === "verified" && !e.demo ? "Rest stop · verified" : "Rest stop";
    case "covered":
      if (e.status === "reported") return "Reported roof";
      return e.status === "verified" && !e.demo ? "Verified roof" : "Roof";
    case "verified":
      return e.status === "verified" && !e.demo ? "Verified" : cap(certainty(e));
  }
}

function source(e: JourneyEvent): string {
  switch (e.kind) {
    case "unknown":
      return NOT_CHECKED;
    case "gap":
      return "From the route check · rest rule for this profile";
    case "arrive":
      return "Destination";
    case "rest":
      return `Bench · ${certainty(e)}`;
    case "covered":
      return `Roof · ${certainty(e)}`;
    case "verified":
      return `Path survey · ${certainty(e)}`;
  }
}

export function journeyCardContent(event: JourneyEvent): JourneyCardContent {
  return {
    title: event.title,
    body: event.body,
    source: source(event),
    demoChip: event.demo === true,
    statusLabel: label(event),
  };
}

/** True when the card is about a fact nobody has checked yet (a VR would ask for exactly that). */
const unchecked = (e: JourneyEvent) =>
  e.kind === "unknown" || (e.kind === "covered" && e.status !== "verified");

/**
 * Adds "verification request filed" to an unchecked card when a request for its element was filed
 * this session (a `verification.requested` event); otherwise returns the content unchanged.
 */
export function withVerificationRequest(
  content: JourneyCardContent,
  event: JourneyEvent,
  filed: boolean,
): JourneyCardContent {
  if (!filed || !unchecked(event)) return content;
  const base = event.kind === "unknown" ? NOT_CHECKED : content.source;
  return { ...content, source: `${base} · ${VR_FILED}` };
}
