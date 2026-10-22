import { describe, expect, it } from "vitest";
import { asCompareIntent, isPlayableCompare } from "../compareTypes";
import { handCompare } from "../fixtures/compareHand";
import {
  DEMO_VALUE,
  isStepFree,
  poiTag,
  reasonRows,
  reasonsTitle,
  reasonsUseDemo,
  recommendedPill,
  recommendedPillNote,
  stopIsDemo,
  stopTag,
} from "./copy";

const withRec = (over: Record<string, unknown>) => {
  const base = handCompare();
  const rec = base.reasons.recommended;
  return handCompare({
    reasons: { fastest: base.reasons.fastest, recommended: rec ? { ...rec, ...over } : null },
  });
};
const arrival = (c: ReturnType<typeof handCompare>) =>
  poiTag(
    c,
    c.pois.findIndex((p) => p.kind === "arrival"),
  );

describe("step-free (final review I-1, R44)", () => {
  it("a known 0 steps is step-free on the pill, the title and the Arrived tag", () => {
    const c = handCompare();
    expect(isStepFree(c)).toBe(true);
    expect(recommendedPill(c)).toBe("Recommended · step-free · 7.4 min");
    expect(reasonsTitle(c)).toBe("Recommended: the step-free route (+1.7 min)");
    expect(arrival(c)?.text).toBe("Playground · step-free");
  });

  it("null steps (a partly checked route) is never step-free and reads Not checked yet", () => {
    const c = withRec({ steps: null });
    expect(isStepFree(c)).toBe(false);
    expect(recommendedPill(c)).toBe("Recommended · 7.4 min");
    expect(reasonsTitle(c)).toBe("Recommended route (+1.7 min)");
    expect(arrival(c)?.text).toBe("Playground");
    expect(reasonRows(c)[0]).toMatchObject({ label: "Steps", recommended: "Not checked yet" });
    expect(recommendedPillNote(c)).toBeUndefined();
  });

  it("a missing steps value is not step-free either", () => {
    expect(isStepFree(withRec({ steps: undefined }))).toBe(false);
  });
});

describe("demo labels from the server's flags (final review I-2, R45)", () => {
  it("the stop note follows stop.demo only, not the POIs", () => {
    const base = handCompare();
    const surveyedStop = handCompare({ stop: base.stop ? { ...base.stop, demo: false } : null });
    expect(base.pois.some((p) => p.demo)).toBe(true);
    expect(stopIsDemo(surveyedStop)).toBe(false);
    expect(stopTag(surveyedStop)?.note).toBeUndefined();
    const demoStop = handCompare({
      pois: base.pois.map((p) => ({ ...p, demo: false })),
      stop: base.stop ? { ...base.stop, demo: true } : null,
    });
    expect(stopTag(demoStop)?.note).toBe(DEMO_VALUE);
  });

  it("each reasons cell is marked exactly when its field is flagged and shown", () => {
    const base = handCompare();
    const c = handCompare({
      reasons: {
        fastest: base.reasons.fastest ? { ...base.reasons.fastest, demo_fields: ["steps"] } : null,
        recommended: base.reasons.recommended
          ? { ...base.reasons.recommended, steps: null, demo_fields: ["steps", "min_width_m"] }
          : null,
      },
    });
    const rows = reasonRows(c);
    expect(rows.map((r) => [r.label, r.fastestDemo, r.recommendedDemo])).toEqual([
      ["Steps", true, false], // recommended steps is null: never marked
      ["Steepest slope", false, false],
      ["Narrowest point", false, true],
      ["Covered from sun and rain", false, false],
      ["Rest stop on the way", false, false],
    ]);
    expect(reasonsUseDemo(c)).toBe(true);
    const none = handCompare({
      reasons: {
        fastest: base.reasons.fastest ? { ...base.reasons.fastest, demo_fields: [] } : null,
        recommended: base.reasons.recommended
          ? { ...base.reasons.recommended, demo_fields: [] }
          : null,
      },
    });
    expect(reasonsUseDemo(none)).toBe(false);
    expect(recommendedPillNote(none)).toBeUndefined();
  });

  it("a step-free claim on demo step counts carries the note on the pill and the Arrived tag", () => {
    const c = handCompare();
    expect(recommendedPillNote(c)).toBe(DEMO_VALUE);
    expect(arrival(c)?.note).toBe(DEMO_VALUE);
    const surveyed = withRec({ demo_fields: [] });
    expect(recommendedPillNote(surveyed)).toBeUndefined();
    expect(arrival(surveyed)?.note).toBeUndefined();
  });

  it("asCompareIntent reads the flags loosely (absent = not demo)", () => {
    type Loose = { stop: { demo?: boolean }; reasons: { recommended: { demo_fields?: string[] } } };
    const raw = JSON.parse(JSON.stringify(handCompare())) as Loose;
    delete raw.stop.demo;
    delete raw.reasons.recommended.demo_fields;
    const c = asCompareIntent(raw);
    expect(c?.stop?.demo).toBe(false);
    expect(c?.reasons.recommended?.demo_fields).toEqual([]);
  });
});

describe("a flood stop never plays (R46)", () => {
  it("is not a playable compare", () => {
    const base = handCompare();
    expect(isPlayableCompare(base)).toBe(true);
    const flood = handCompare({
      stop: base.stop ? { ...base.stop, attribute: "flood", value: "likely_flooded" } : null,
    });
    expect(isPlayableCompare(flood)).toBe(false);
  });
});
