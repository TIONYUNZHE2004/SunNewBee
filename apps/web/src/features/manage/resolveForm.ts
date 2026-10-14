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

export function validateForm(s: FormState): string | null {
  if (!s.note.trim()) return "A note is required.";
  if (needsValue(s.action) && !s.value.trim()) return "A corrected value is required.";
  return null;
}

export function errorMessage(status: number | undefined): string {
  if (status === 401) return "Staff token required or invalid";
  if (status === 404) return "Request not found (it may already be resolved).";
  return "Could not save. Please try again.";
}
