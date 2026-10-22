/**
 * Navigation compare copy (spec §5.3, AC-N5 / AC-N6). Every number is filled from the
 * `route.compare` payload (packages/spatial facts), never written here.
 */
import type { CompareIntent, ReasonField, ReasonSet } from "../compareTypes";

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
export const DEMO_VALUE = "Demo value · not surveyed";
/** The reasons card marks each demo value with this sign and explains it in its footer (R45). */
export const DEMO_MARK = "†";
export const TOAST_TITLE = "Survey ticket queued for staff";

/**
 * "step-free" only when the recommended route has a known 0 steps (AC-N2). `steps` is null unless
 * every edge's step count is known (R44), so a partly checked route is never step-free.
 */
export const isStepFree = (c: CompareIntent): boolean => {
  const s = c.reasons.recommended?.steps;
  return typeof s === "number" && s === 0;
};

/** True when this route's shown `field` value rests on placeholder evidence (R45). */
export const isDemoField = (r: ReasonSet | null | undefined, field: ReasonField): boolean =>
  !!r && r[field] !== null && r[field] !== undefined && (r.demo_fields ?? []).includes(field);

/** The "step-free" claim (pill, title, Arrived tag) rests on demo step counts. */
export const stepFreeIsDemo = (c: CompareIntent): boolean =>
  isStepFree(c) && isDemoField(c.reasons.recommended, "steps");

export function reasonsTitle(c: CompareIntent): string {
  const d = c.extra_minutes ?? 0;
  return isStepFree(c)
    ? `Recommended: the step-free route (+${d} min)`
    : `Recommended route (+${d} min)`;
}

/**
 * The toast body after its title (AC-N5); null without a ticket or unchecked stretch. Without a
 * computed N, or with N = 0 (`confirm_n` null or 0, ruling R30), only the first sentence is shown
 * (R22: N always counts wheelchair sample journeys, whatever the profile).
 */
export function toastBody(c: CompareIntent): string | null {
  const u = c.unchecked[0];
  if (!c.vr || !u) return null;
  const first = `${attributeName(u.attribute)} on ${metres(u.length_m)} m of the recommended path is not checked yet.`;
  return !c.confirm_n
    ? first
    : `${first} Checking it would confirm ${c.confirm_n} wheelchair trips.`;
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

export type ReasonRow = {
  label: string;
  fastest: string;
  recommended: string;
  /** The shown value rests on placeholder evidence: marked "Demo value · not surveyed" (R45). */
  fastestDemo: boolean;
  recommendedDemo: boolean;
};

const or = (v: number | null | undefined, f: (n: number) => string) =>
  v === null || v === undefined ? NOT_CHECKED_YET : f(v);

const steps = (n: number) => (n === 0 ? "None" : `${n} ${n === 1 ? "step" : "steps"}`);
const pct = (n: number) => `${Number(n.toFixed(1))}%`;
const width = (n: number) => `${Number(n.toFixed(2))} m`;
const share = (n: number) => `${Math.round(n * 100)}%`;
const rests = (n: number) => (n === 0 ? "None" : `${n} on the way`);

const ROWS: [string, ReasonField, (n: number) => string][] = [
  ["Steps", "steps", steps],
  ["Steepest slope", "max_incline_pct", pct],
  ["Narrowest point", "min_width_m", width],
  ["Covered from sun and rain", "covered_share", share],
  ["Rest stop on the way", "rest_stops", rests],
];

const value = (r: ReasonSet | null, f: ReasonField) => r?.[f] as number | null | undefined;

/** The five rows of the reasons card (AC-N6); a null fact reads "Not checked yet", never a guess. */
export function reasonRows(c: CompareIntent): ReasonRow[] {
  const f = c.reasons.fastest;
  const r = c.reasons.recommended;
  return ROWS.map(([label, field, fmt]) => ({
    label,
    fastest: or(value(f, field), fmt),
    recommended: or(value(r, field), fmt),
    fastestDemo: isDemoField(f, field),
    recommendedDemo: isDemoField(r, field),
  }));
}

/** True when a value the reasons card shows rests on placeholder evidence (R45). */
export const reasonsUseDemo = (c: CompareIntent): boolean =>
  reasonRows(c).some((r) => r.fastestDemo || r.recommendedDemo);

/** The stop fact is a demo value: the server's flag from the stop's own evidence (R45). */
export const stopIsDemo = (c: CompareIntent): boolean => c.stop?.demo === true;

// ---------------------------------------------------------------- 3D overlay copy (B10)

const minutes = (m: number | null | undefined): string =>
  m === null || m === undefined ? "?" : String(Number(m.toFixed(1)));

/** Left pill (AC-N2): "Fastest route · {minutes} min walking". */
export function fastestPill(c: CompareIntent): string {
  return `Fastest route · ${minutes(c.reasons.fastest?.minutes ?? c.fastest?.est_minutes)} min walking`;
}

/** The note under the right pill: "Demo value · not surveyed" when "step-free" rests on demo steps. */
export const recommendedPillNote = (c: CompareIntent): string | undefined =>
  stepFreeIsDemo(c) ? DEMO_VALUE : undefined;

/** Right pill (AC-N2): "Recommended · step-free · {minutes} min"; "step-free" only with 0 known steps. */
export function recommendedPill(c: CompareIntent): string {
  const m = minutes(c.reasons.recommended?.minutes ?? c.recommended?.est_minutes);
  return isStepFree(c) ? `Recommended · step-free · ${m} min` : `Recommended · ${m} min`;
}

const PROFILE_NAMES: Record<string, string> = {
  default: "Walking",
  stroller: "Stroller",
  wheelchair: "Wheelchair",
  older_adult_rest: "Older adult (rest stops)",
  drive: "Driving",
};

/** The query chip: "Wheelchair · {from} → {to}". */
export function queryChip(c: CompareIntent): string {
  return `${PROFILE_NAMES[c.profile] ?? c.profile} · ${c.from_place.name || c.from_place.id} → ${c.to_place.name || c.to_place.id}`;
}

export const NOT_COUNTED = "Not counted for or against";

/** The unchecked tag (AC-N4), exactly: "? Not checked yet · {Attribute} on this {m} m · Not counted for or against". */
export function uncheckedTagParts(
  c: CompareIntent,
): { key: string; text: string; note: string } | null {
  const u = c.unchecked[0];
  if (!u) return null;
  return {
    key: `? ${NOT_CHECKED_YET}`,
    text: `${attributeName(u.attribute)} on this ${metres(u.length_m)} m`,
    note: NOT_COUNTED,
  };
}

export const uncheckedTagText = (c: CompareIntent): string | null => {
  const p = uncheckedTagParts(c);
  return p ? `${p.key} · ${p.text} · ${p.note}` : null;
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "{value} {attribute}" for the stop tag, e.g. "3 steps", "raised kerb", "12% incline". */
export function barrierText(attribute: string, value: unknown): string {
  if (attribute === "step_count" && typeof value === "number")
    return `${value} ${value === 1 ? "step" : "steps"}`;
  if (attribute === "incline_pct" && typeof value === "number") return `${value}% incline`;
  if (attribute === "width_m" && typeof value === "number") return `${value} m wide`;
  if (attribute === "kerb" && typeof value === "string") return `${value} kerb`;
  if (value === null || value === undefined || value === "")
    return attributeName(attribute).toLowerCase();
  return `${String(value)} ${attributeName(attribute).toLowerCase()}`;
}

export interface TagCopy {
  key: string;
  text: string;
  /** Shown under the text: "Demo value · not surveyed", or the unchecked note. */
  note?: string;
  tone: "ok" | "info" | "unknown" | "fail" | "route";
}

/** The red stop tag: "Not passable · {value} {attribute}". */
export function stopTag(c: CompareIntent): TagCopy | null {
  if (!c.stop) return null;
  return {
    key: "Not passable",
    text: barrierText(c.stop.attribute, c.stop.value),
    note: stopIsDemo(c) ? DEMO_VALUE : undefined,
    tone: "fail",
  };
}

/** The left "Fastest" tag: the shortest walk, with its length from the route. */
export function fastestTag(c: CompareIntent): TagCopy {
  const m = c.fastest?.distance_m;
  return {
    key: "Fastest",
    text: m === undefined ? "Shortest walk" : `Shortest walk · ${metres(m)} m`,
    tone: "route",
  };
}

/** A POI tag's copy from `pois` (AC-N4); demo values carry "Demo value · not surveyed". */
export function poiTag(c: CompareIntent, index: number): TagCopy | null {
  const p = c.pois[index];
  if (!p) return null;
  const note = p.demo ? DEMO_VALUE : undefined;
  const v = p.value;
  switch (p.kind) {
    case "kerb":
      return {
        key: "Kerb",
        text: typeof v === "string" ? `${cap(v)} kerb` : "Kerb",
        note,
        tone: "ok",
      };
    case "covered_start":
      return { key: "Covered", text: "Covered walkway starts", note, tone: "info" };
    case "incline":
      return {
        key: "Slope",
        text: typeof v === "number" ? `Incline ${Number(v.toFixed(1))}%` : "Incline",
        note,
        tone: "ok",
      };
    case "seating":
      return {
        key: "Rest",
        text: typeof v === "string" && v ? cap(v) : "Seating",
        note,
        tone: "info",
      };
    case "arrival":
      return {
        key: "Arrived",
        text: `${c.to_place.name || c.to_place.id}${isStepFree(c) ? " · step-free" : ""}`,
        note: p.demo || stepFreeIsDemo(c) ? DEMO_VALUE : undefined,
        tone: "ok",
      };
    default:
      return null;
  }
}

/** The ticket card that flies to the chip. */
export function flightCard(c: CompareIntent): { title: string; text: string } | null {
  const u = c.unchecked[0];
  if (!c.vr || !u) return null;
  return { title: "Survey queued", text: `${attributeName(u.attribute)} not checked on this path` };
}

export const TICKETS_CHIP = "Tickets";

/**
 * Greetings only, never a fact, no digits (D4, AC-N8). Not "Selamat pagi": "selamat" is on the
 * honesty banned list (`test/honesty.ts`), so the Malay greeting is "Pagi!" ("Morning!").
 */
export const GREETINGS = ["Pagi! 👋", "Morning! 👋", "Hai, jalan elok-elok!"] as const;
export const SIMULATED_RESIDENT = "Simulated resident";

/** One greeting, picked by a seed string (stable per compare). */
export function greetingFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GREETINGS[h % GREETINGS.length] ?? GREETINGS[0];
}
