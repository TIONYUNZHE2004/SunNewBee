/**
 * Navigation compare copy (spec §5.3, AC-N5 / AC-N6). Every number is filled from the
 * `route.compare` payload (packages/spatial facts), never written here.
 */
import type { CompareIntent, ReasonSet } from "../compareTypes";

const ATTRIBUTE_NAMES: Record<string, string> = {
  step_count: "Steps",
  incline_pct: "Incline",
  width_m: "Width",
  covered: "Cover",
  kerb: "Kerb",
  sidewalk: "Sidewalk",
  seating: "Seating",
  surface: "Surface",
  lit: "Lighting",
  crossing: "Crossing",
  handrail: "Handrail",
  tactile_paving: "Tactile paving",
};

/** "incline_pct" -> "Incline"; unknown keys: first word capitalised, underscores as spaces. */
export function attributeName(attr: string): string {
  const known = ATTRIBUTE_NAMES[attr];
  if (known) return known;
  const s = attr.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : attr;
}

export const metres = (m: number): number => Math.round(m);

export const NOT_CHECKED_YET = "Not checked yet";
export const REASONS_FOOT = "Reasons use checked facts only.";
export const DEMO_VALUES = "Demo values · not surveyed";
export const TOAST_TITLE = "Survey ticket queued for staff";

/** "step-free" only when the recommended route has a known 0 steps (AC-N2). */
export const isStepFree = (c: CompareIntent): boolean => c.reasons.recommended?.steps === 0;

export function reasonsTitle(c: CompareIntent): string {
  const d = c.extra_minutes ?? 0;
  return isStepFree(c)
    ? `Recommended: the step-free route (+${d} min)`
    : `Recommended route (+${d} min)`;
}

/** The toast body after its title (AC-N5); null without a ticket or unchecked stretch. */
export function toastBody(c: CompareIntent): string | null {
  const u = c.unchecked[0];
  if (!c.vr || !u || c.confirm_n === null) return null;
  return `${attributeName(u.attribute)} on ${metres(u.length_m)} m of the recommended path is not checked yet. Checking it would confirm ${c.confirm_n} wheelchair trips.`;
}

/** The full toast text, title included, exactly as AC-N5. */
export function toastText(c: CompareIntent): string | null {
  const body = toastBody(c);
  return body ? `${TOAST_TITLE} · ${body}` : null;
}

/** The reasons card's unchecked line, or null when nothing on the recommended route is unchecked. */
export function uncheckedLine(c: CompareIntent): string | null {
  const u = c.unchecked[0];
  if (!u) return null;
  const queued = c.vr ? "survey queued; " : "";
  return `? ${NOT_CHECKED_YET}: ${attributeName(u.attribute).toLowerCase()} on ${metres(u.length_m)} m of the recommended path (${queued}it did not count for or against).`;
}

export type ReasonRow = { label: string; fastest: string; recommended: string };

const or = (v: number | null | undefined, f: (n: number) => string) =>
  v === null || v === undefined ? NOT_CHECKED_YET : f(v);

const steps = (n: number) => (n === 0 ? "None" : `${n} ${n === 1 ? "step" : "steps"}`);
const pct = (n: number) => `${Number(n.toFixed(1))}%`;
const width = (n: number) => `${Number(n.toFixed(2))} m`;
const share = (n: number) => `${Math.round(n * 100)}%`;
const rests = (n: number) => (n === 0 ? "None" : `${n} on the way`);

/** The five rows of the reasons card (AC-N6); a null fact reads "Not checked yet", never a guess. */
export function reasonRows(c: CompareIntent): ReasonRow[] {
  const f: Partial<ReasonSet> = c.reasons.fastest ?? {};
  const r: Partial<ReasonSet> = c.reasons.recommended ?? {};
  return [
    { label: "Steps", fastest: or(f.steps, steps), recommended: or(r.steps, steps) },
    {
      label: "Steepest slope",
      fastest: or(f.max_incline_pct, pct),
      recommended: or(r.max_incline_pct, pct),
    },
    {
      label: "Narrowest point",
      fastest: or(f.min_width_m, width),
      recommended: or(r.min_width_m, width),
    },
    {
      label: "Covered from sun and rain",
      fastest: or(f.covered_share, share),
      recommended: or(r.covered_share, share),
    },
    {
      label: "Rest stop on the way",
      fastest: or(f.rest_stops, rests),
      recommended: or(r.rest_stops, rests),
    },
  ];
}

/** True when a shown value rests on placeholder (team_survey_placeholder) evidence. */
export const usesDemoValues = (c: CompareIntent): boolean =>
  !!c.fastest?.demo_evidence || !!c.recommended?.demo_evidence || c.pois.some((p) => p.demo);
