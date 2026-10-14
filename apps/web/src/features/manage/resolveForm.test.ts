import { describe, expect, it } from "vitest";
import { errorMessage, formReducer, initialForm, validateForm } from "./resolveForm";

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
});
