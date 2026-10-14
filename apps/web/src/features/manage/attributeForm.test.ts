import { describe, expect, it } from "vitest";
import {
  type AttrForm,
  errorMessage,
  initialAttrForm,
  kindOf,
  parseValue,
  toPayload,
  validate,
} from "./attributeForm";

const base: AttrForm = {
  kind: "number",
  raw: "4",
  status: "verified",
  sourceType: "staff_site_visit",
  note: "",
};

describe("kindOf", () => {
  it("infers from the current value", () => {
    expect(kindOf(true)).toBe("boolean");
    expect(kindOf(3.5)).toBe("number");
    expect(kindOf("x")).toBe("text");
    expect(kindOf(null)).toBe("text");
  });
});

describe("parseValue", () => {
  it("parses numbers", () => {
    expect(parseValue("number", "4.5")).toBe(4.5);
    expect(parseValue("number", " 0 ")).toBe(0);
    expect(parseValue("number", "")).toBeNull();
    expect(parseValue("number", "abc")).toBeNull();
    expect(parseValue("number", "Infinity")).toBeNull();
  });
  it("parses booleans from yes/no/unknown", () => {
    expect(parseValue("boolean", "yes")).toBe(true);
    expect(parseValue("boolean", "no")).toBe(false);
    expect(parseValue("boolean", "unknown")).toBeNull();
    expect(parseValue("boolean", "")).toBeNull();
  });
  it("trims text and treats blank as null", () => {
    expect(parseValue("text", "  ramp ")).toBe("ramp");
    expect(parseValue("text", "  ")).toBeNull();
  });
});

describe("validate", () => {
  it("accepts a verified number", () => {
    expect(validate(base)).toBeNull();
  });
  it("requires a value for verified and reported", () => {
    expect(validate({ ...base, raw: "" })).toMatch(/value/i);
    expect(validate({ ...base, status: "reported", raw: "x" })).toMatch(/number/i);
  });
  it("accepts unknown without a value", () => {
    expect(validate({ ...base, status: "unknown", raw: "" })).toBeNull();
  });
  it("requires a source type", () => {
    expect(validate({ ...base, sourceType: "" })).toMatch(/source/i);
  });
  it("accepts boolean false as a value", () => {
    expect(validate({ ...base, kind: "boolean", raw: "no" })).toBeNull();
  });
});

describe("toPayload", () => {
  it("sends the parsed value, source and trimmed note", () => {
    expect(toPayload({ ...base, note: " measured " })).toEqual({
      value: 4,
      status: "verified",
      source_type: "staff_site_visit",
      note: "measured",
    });
  });
  it("forces null for unknown and omits a blank note", () => {
    expect(toPayload({ ...base, status: "unknown", raw: "9" })).toEqual({
      value: null,
      status: "unknown",
      source_type: "staff_site_visit",
    });
  });
  it("keeps boolean false", () => {
    expect(toPayload({ ...base, kind: "boolean", raw: "no" }).value).toBe(false);
  });
});

describe("initialAttrForm", () => {
  it("prefills from the claim", () => {
    expect(initialAttrForm(true, "verified").raw).toBe("yes");
    expect(initialAttrForm(2, "reported")).toMatchObject({
      kind: "number",
      raw: "2",
      status: "reported",
    });
  });
  it("falls back to reported for stale/contested/unknown with no value", () => {
    expect(initialAttrForm("a", "stale").status).toBe("reported");
    expect(initialAttrForm(null, "unknown")).toMatchObject({ status: "unknown", raw: "" });
  });
});

describe("errorMessage", () => {
  it("maps statuses to plain text", () => {
    expect(errorMessage(401)).toMatch(/token/i);
    expect(errorMessage(503)).toMatch(/not configured/i);
    expect(errorMessage(404)).toMatch(/not found/i);
    expect(errorMessage(422, "bad key")).toBe("bad key");
    expect(errorMessage(422)).toMatch(/rejected/i);
    expect(errorMessage(undefined)).toMatch(/try again/i);
  });
});
