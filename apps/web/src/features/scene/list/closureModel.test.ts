import { describe, expect, it } from "vitest";
import {
  buildCreateBody,
  type Closure,
  closureDate,
  closureLine,
  closureState,
  EMPTY_FIELDS,
} from "./closureModel";

const NOW = new Date("2026-10-15T12:00:00Z");
const f = (p: Partial<typeof EMPTY_FIELDS>) => ({ ...EMPTY_FIELDS, elementId: "seg-ab", ...p });

describe("buildCreateBody", () => {
  it("needs an element", () => {
    expect(buildCreateBody(EMPTY_FIELDS, NOW)).toEqual({
      error: "Pick a place or enter an element id",
    });
  });
  it("omits empty start, end and note", () => {
    expect(buildCreateBody(f({ elementId: " seg-ab " }), NOW)).toEqual({
      body: { element_id: "seg-ab", reason: "works" },
    });
  });
  it("sends ISO instants and a trimmed note", () => {
    const r = buildCreateBody(
      f({
        startsAt: "2026-10-16T08:00",
        endsAt: "2026-10-17T08:00",
        note: " paving ",
        reason: "event",
      }),
      NOW,
    );
    if (!("body" in r)) throw new Error("expected a body");
    expect(r.body.reason).toBe("event");
    expect(r.body.note).toBe("paving");
    expect(new Date(r.body.starts_at as string).getTime()).toBe(
      new Date("2026-10-16T08:00:00+08:00").getTime(),
    );
    expect(r.body.ends_at).toMatch(/Z$/);
  });
  it("rejects an end before the start, or before now when there is no start", () => {
    expect(
      buildCreateBody(f({ startsAt: "2026-10-17T08:00", endsAt: "2026-10-16T08:00" }), NOW),
    ).toEqual({
      error: "End must be after the start",
    });
    expect(buildCreateBody(f({ endsAt: "2026-10-01T08:00" }), NOW)).toEqual({
      error: "End must be after the start",
    });
  });
});

describe("closure text and state", () => {
  const c = {
    id: "cl-1",
    element_id: "seg-ab",
    reason: "works",
    starts_at: "2026-10-15T00:00:00Z",
    ends_at: "20 Oct 2026T00:00:00Z",
    label: "Closed: works until 20 Oct 2026",
    source_label: "Reported closure (staff)",
    active: true,
  } as Closure;
  it("always names the staff source and the date, and never says safe", () => {
    const line = closureLine(c);
    expect(line).toBe(
      "Reported closure (staff): Closed: works until 20 Oct 2026 (reported from 15 Oct 2026)",
    );
    expect(line.toLowerCase()).not.toContain("safe");
  });
  it("classifies active, scheduled and ended", () => {
    expect(closureState(c)).toBe("active");
    expect(closureState({ ...c, active: false, ends_at: "2999-01-01T00:00:00Z" })).toBe(
      "scheduled",
    );
    expect(closureState({ ...c, active: false, ends_at: "2020-01-01T00:00:00Z" })).toBe("ended");
  });
});

describe("site time zone (Malaysia)", () => {
  it("reads 06:00 KL on the 20th as 22:00 UTC on the 19th, whatever the browser zone", () => {
    const r = buildCreateBody(f({ endsAt: "2026-10-20T06:00" }), new Date("2026-10-15T00:00:00Z"));
    if (!("body" in r)) throw new Error("expected a body");
    expect(r.body.ends_at).toBe("2026-10-19T22:00:00.000Z");
  });
  it("shows the KL calendar day, not the UTC day", () => {
    expect(closureDate("2026-10-19T22:00:00Z")).toBe("20 Oct 2026");
    expect(closureDate("2026-10-19T22:00:00+00:00", "UTC")).toBe("19 Oct 2026");
    expect(closureDate("2026-09-02T00:00:00+08:00")).toBe("2 Sep 2026");
    expect(closureDate("nope")).toBe("");
  });
});
