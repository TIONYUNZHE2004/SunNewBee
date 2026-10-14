import { optionLabel as optionLabelOf, specFor } from "./attributeCatalogue";
import { parseValue } from "./attributeForm";
import type { ResolveBody } from "./manageApi";

export type FormState = {
  action: ResolveBody["action"];
  value: string;
  note: string;
  status: "idle" | "submitting" | "error";
  error: string | null;
};
export type FormAction =
  | { type: "set"; field: "action" | "value" | "note"; v: string }
  | { type: "submit" }
  | { type: "fail"; message: string };

export const initialForm: FormState = {
  action: "verify",
  value: "",
  note: "",
  status: "idle",
  error: null,
};

export const VERIFY_DISABLED_TEXT = "Nothing to verify yet: enter the observed value with Correct";

export const hasCurrentValue = (v: unknown): boolean => v !== null && v !== undefined && v !== "";

/** Default action follows the claim: Verify confirms an existing value, so with none the form
 * starts on Correct. */
export function initialFormFor(currentValue: unknown): FormState {
  return hasCurrentValue(currentValue) ? initialForm : { ...initialForm, action: "correct" };
}

export function currentValueText(v: unknown): string {
  if (!hasCurrentValue(v)) return "no value recorded";
  if (v === true) return "Yes";
  if (v === false) return "No";
  return String(v);
}

export function formReducer(s: FormState, a: FormAction): FormState {
  switch (a.type) {
    case "set":
      return { ...s, [a.field]: a.v } as FormState;
    case "submit":
      return { ...s, status: "submitting", error: null };
    case "fail":
      return { ...s, status: "error", error: a.message };
  }
}

export const needsValue = (a: FormState["action"]) => a === "correct";

export function validateForm(s: FormState, attribute?: string): string | null {
  if (!s.note.trim()) return "A note is required.";
  if (needsValue(s.action)) {
    if (!s.value.trim()) return "A corrected value is required.";
    const spec = specFor(attribute, null);
    if (spec.kind === "enum" && !spec.options.includes(s.value.trim()))
      return "Choose one of the listed options.";
    if (parseValue(spec.kind, s.value) === null)
      return spec.kind === "number"
        ? "Enter the corrected value as a number."
        : spec.kind === "boolean"
          ? "Choose yes or no."
          : "A corrected value is required.";
  }
  return null;
}

/** Corrected value typed by the attribute catalogue (number, boolean or string), as the server
 * validates it. Verify sends no value: the server keeps the claim's current one. */
export function buildResolveBody(s: FormState, attribute?: string): ResolveBody {
  const note = s.note.trim();
  if (!needsValue(s.action)) return { action: s.action, note };
  const value = parseValue(specFor(attribute, null).kind, s.value);
  return value === null ? { action: s.action, note } : { action: s.action, value, note };
}

export function errorMessage(status: number | undefined, detail?: string): string {
  if (status === 401) return "Staff token required or invalid";
  if (status === 404) return "Request not found (it may already be resolved).";
  if (status === 409) return "This request was already resolved. Refresh the queue.";
  if (status === 422) {
    if (!detail) return "The server rejected this value.";
    if (/value is required/i.test(detail))
      return "There is no current value to verify. Choose Correct and enter the observed value.";
    const m = /^(\w+) must be (a number|a boolean|one of.*)$/i.exec(detail);
    if (m) return `${optionLabelOf(m[1] ?? "")} must be ${m[2]}.`;
    return `The server rejected this value: ${detail}`;
  }
  return "Could not save. Please try again.";
}
