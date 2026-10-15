export type Kind = "number" | "boolean" | "enum" | "text";

/** Mirrors the server attribute catalogue (world-model-schema §2.4). */
const NUMBER_KEYS = ["step_count", "step_height_cm", "incline_pct", "width_m"];
const BOOLEAN_KEYS = ["ramp", "tactile_paving", "lit", "seating_adjacent", "seating", "covered"];
const TEXT_KEYS = ["opening_hours", "name"];
const ENUMS: Record<string, string[]> = {
  wheelchair: ["yes", "limited", "no"],
  handrail: ["both", "one_side", "none"],
  sidewalk: ["both", "one_side", "none", "separate"],
  surface: [
    "asphalt",
    "concrete",
    "paving_stones",
    "tiles",
    "gravel",
    "grass",
    "grating",
    "metal",
    "unpaved",
    "wood",
  ],
  surface_condition: ["good", "uneven", "obstructed"],
  kerb: ["flush", "lowered", "raised", "rolled"],
  shelter: ["covered", "partial", "none"],
  door_type: ["automatic", "push", "pull", "sliding", "revolving", "none"],
};

export interface AttrSpec {
  kind: Kind;
  options: string[];
}

/** "one_side" -> "One side". */
export function optionLabel(v: string): string {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  step_count: "Step count",
  step_height_cm: "Step height (cm)",
  incline_pct: "Incline (%)",
  width_m: "Width (m)",
};

/** Staff-facing attribute name: "incline_pct" -> "Incline (%)"; unknown keys fall back to optionLabel. */
export function attributeLabel(key: string): string {
  return ATTRIBUTE_LABELS[key] ?? optionLabel(key);
}

/** The catalogue wins for known keys (even with a non-null value); other keys infer from the value. */
export function specFor(key: string | undefined, value: unknown): AttrSpec {
  if (key) {
    if (ENUMS[key]) return { kind: "enum", options: ENUMS[key] };
    if (NUMBER_KEYS.includes(key)) return { kind: "number", options: [] };
    if (BOOLEAN_KEYS.includes(key)) return { kind: "boolean", options: [] };
    if (TEXT_KEYS.includes(key)) return { kind: "text", options: [] };
  }
  if (typeof value === "boolean") return { kind: "boolean", options: [] };
  if (typeof value === "number") return { kind: "number", options: [] };
  return { kind: "text", options: [] };
}
