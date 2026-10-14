export type Kind = "number" | "boolean" | "text";
export type EditStatus = "verified" | "reported" | "unknown";

export const SOURCE_TYPES = [
  { value: "staff_site_visit", label: "Staff site visit" },
  { value: "staff_photo", label: "Staff photo" },
  { value: "sdp_document", label: "SDP document" },
  { value: "resident_report", label: "Resident report" },
] as const;

export const EDIT_STATUSES: { value: EditStatus; label: string }[] = [
  { value: "verified", label: "Verified" },
  { value: "reported", label: "Reported" },
  { value: "unknown", label: "Unknown" },
];

export interface AttrForm {
  kind: Kind;
  raw: string;
  status: EditStatus;
  sourceType: string;
  note: string;
}

export interface AttrPayload {
  value: number | boolean | string | null;
  status: EditStatus;
  source_type: string;
  note?: string;
}

const NUMBER_KEYS = new Set(["step_count", "incline_pct", "width_m", "step_height_cm"]);
const BOOLEAN_KEYS = new Set([
  "wheelchair",
  "lit",
  "ramp",
  "covered",
  "seating",
  "tactile_paving",
  "handrail",
]);

/** Kind from the current value; for a null value, from the attribute key (else text). */
export function kindOf(v: unknown, key?: string): Kind {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (v === null || v === undefined) {
    if (key && NUMBER_KEYS.has(key)) return "number";
    if (key && BOOLEAN_KEYS.has(key)) return "boolean";
  }
  return "text";
}

export function parseValue(kind: Kind, raw: string): number | boolean | string | null {
  const s = raw.trim();
  if (kind === "boolean") return s === "yes" ? true : s === "no" ? false : null;
  if (kind === "number") {
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return s === "" ? null : s;
}

export function initialAttrForm(value: unknown, status: string, key?: string): AttrForm {
  const kind = kindOf(value, key);
  const raw =
    value === null || value === undefined
      ? ""
      : kind === "boolean"
        ? value
          ? "yes"
          : "no"
        : String(value);
  const st: EditStatus =
    status === "verified"
      ? "verified"
      : status === "unknown" && raw === ""
        ? "unknown"
        : "reported";
  return { kind, raw, status: st, sourceType: "", note: "" };
}

export function validate(f: AttrForm): string | null {
  if (!f.sourceType) return "Choose a source type.";
  if (f.status !== "unknown" && parseValue(f.kind, f.raw) === null) {
    return f.kind === "number"
      ? "Enter a value as a number."
      : f.kind === "boolean"
        ? "Choose yes or no."
        : "Enter a value.";
  }
  return null;
}

export function toPayload(f: AttrForm): AttrPayload {
  const note = f.note.trim();
  return {
    value: f.status === "unknown" ? null : parseValue(f.kind, f.raw),
    status: f.status,
    source_type: f.sourceType,
    ...(note ? { note } : {}),
  };
}

export function errorMessage(status: number | undefined, detail?: string): string {
  if (status === 401) return "Staff token required or invalid.";
  if (status === 503) return "Staff editing is not configured on the server.";
  if (status === 404) return "Element not found.";
  if (status === 422) return detail || "The server rejected this value.";
  return "Could not save. Please try again.";
}
