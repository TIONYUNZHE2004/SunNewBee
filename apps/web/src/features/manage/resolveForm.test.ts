import { describe, expect, it } from "vitest";
import {
  buildResolveBody,
  currentValueText,
  errorMessage,
  formReducer,
  initialForm,
  initialFormFor,
  PHOTO_PRIVACY_NOTE,
  validateForm,
} from "./resolveForm";

describe("resolve form", () => {
  it("submit/fail transitions", () => {
    const s = formReducer(initialForm, { type: "submit" });
    expect(s.status).toBe("submitting");
    const f = formReducer(s, { type: "fail", message: "x" });
    expect(f).toMatchObject({ status: "error", error: "x" });
    expect(formReducer(f, { type: "submit" }).error).toBeNull();
  });
  it("validates", () => {
    expect(validateForm(initialForm)).toMatch(/note/);
    const ok = formReducer(initialForm, { type: "set", field: "note", v: "ok" });
    expect(validateForm(ok)).toBeNull();
    const c = formReducer(ok, { type: "set", field: "action", v: "correct" });
    expect(validateForm(c)).toMatch(/value/);
  });
  it("maps 401", () => {
    expect(errorMessage(401)).toBe("Staff token required or invalid");
  });
  it("builds a typed value from the attribute catalogue", () => {
    const base = { ...initialForm, note: " ok ", action: "correct" as const };
    expect(buildResolveBody({ ...base, value: " 4.5 " }, "incline_pct")).toEqual({
      action: "correct",
      value: 4.5,
      note: "ok",
    });
    expect(buildResolveBody({ ...base, value: "yes" }, "seating")).toMatchObject({
      value: true,
    });
    expect(buildResolveBody({ ...base, value: "flush" }, "kerb")).toMatchObject({
      value: "flush",
    });
  });
  it("verify sends no value so the server keeps the current one", () => {
    expect(buildResolveBody({ ...initialForm, note: "n" }, "incline_pct")).toEqual({
      action: "verify",
      note: "n",
    });
  });
  it("rejects a non-numeric corrected value for a number attribute", () => {
    const c = { ...initialForm, note: "n", action: "correct" as const, value: "steep" };
    expect(validateForm(c, "incline_pct")).toMatch(/number/);
    expect(validateForm({ ...c, value: "4" }, "incline_pct")).toBeNull();
  });
  it("shows the server's 422 detail", () => {
    expect(errorMessage(422, "incline_pct must be a number")).toBe("Incline pct must be a number.");
    expect(errorMessage(422, "value is required for verify/correct")).toMatch(/Choose Correct/);
    expect(errorMessage(500)).toMatch(/Could not save/);
  });
  it("defaults to Verify when the claim has a value, Correct when it has none", () => {
    expect(initialFormFor(3).action).toBe("verify");
    expect(initialFormFor(false).action).toBe("verify");
    expect(initialFormFor(null).action).toBe("correct");
    expect(initialFormFor(undefined).action).toBe("correct");
  });
  it("describes the current value", () => {
    expect(currentValueText(null)).toBe("no value recorded");
    expect(currentValueText(4.5)).toBe("4.5");
    expect(currentValueText(true)).toBe("Yes");
  });
});

describe("photo field copy", () => {
  it("tells staff metadata is removed", () =>
    expect(PHOTO_PRIVACY_NOTE).toBe(
      "Location and camera details are removed from the photo before it is stored.",
    ));
});
