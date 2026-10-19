import { describe, expect, it } from "vitest";
import { honestyViolations } from "../../test/honesty";
import {
  DEMO_CHIP,
  DEMO_CHIP_TEXT,
  journeyCardContent,
  NOT_CHECKED,
  SIMULATION_LABEL,
  VR_FILED,
  vrFiledFor,
  withVerificationRequest,
} from "./cardContent";
import demoPlan from "./fixtures/demoPlan.json";
import type { JourneyEvent, JourneyPlan } from "./timeline";

const plan = demoPlan as unknown as JourneyPlan;
const ev = (over: Partial<JourneyEvent>): JourneyEvent => ({
  kind: "verified",
  at_m: 10,
  element_id: "seg-1",
  source: null,
  attributes: [],
  status: "verified",
  demo: false,
  evidence_id: "ev-1",
  title: "T",
  body: "B",
  hold_s: 3,
  ...over,
});
const kinds: JourneyEvent["kind"][] = ["covered", "unknown", "gap", "verified", "rest", "arrive"];
const statuses: JourneyEvent["status"][] = [
  "unknown",
  "reported",
  "verified",
  "stale",
  "contested",
  "unverified",
  "route",
];
const texts = (c: ReturnType<typeof journeyCardContent>) => [
  c.title,
  c.body,
  c.source,
  c.statusLabel,
];

describe("shared names and VR matching", () => {
  it("fe4 aliases are the same strings", () => {
    expect(DEMO_CHIP_TEXT).toBe(DEMO_CHIP);
    expect(SIMULATION_LABEL).toBe("Simulation · indicative times, not a prediction");
  });

  it("a VR counts only for the event's element AND one of its attributes", () => {
    const e = ev({
      kind: "unknown",
      status: "unknown",
      element_id: "seg-9",
      attributes: ["incline_pct"],
    });
    expect(vrFiledFor(e, [])).toBe(false);
    expect(vrFiledFor(e, [{ element_id: "seg-9", attribute: "step_count" }])).toBe(false);
    expect(vrFiledFor(e, [{ element_id: "seg-8", attribute: "incline_pct" }])).toBe(false);
    expect(vrFiledFor(e, [{ element_id: "seg-9", attribute: "incline_pct" }])).toBe(true);
    expect(vrFiledFor(ev({ element_id: null }), [{ element_id: "", attribute: "x" }])).toBe(false);
  });
});

describe("journeyCardContent", () => {
  it("title and body come from the plan verbatim", () => {
    for (const e of plan.events) {
      const c = journeyCardContent(e);
      expect(c.title).toBe(e.title);
      expect(c.body).toBe(e.body);
    }
  });

  it("demo chip exactly when event.demo is true, for every kind and status", () => {
    for (const kind of kinds)
      for (const status of statuses)
        for (const demo of [true, false])
          expect(journeyCardContent(ev({ kind, status, demo })).demoChip).toBe(demo);
  });

  it("never says Verified on a demo event, nor on a claim that is not verified", () => {
    for (const kind of kinds)
      for (const status of statuses)
        for (const demo of [true, false]) {
          const c = journeyCardContent(ev({ kind, status, demo, title: "x", body: "y" }));
          const words = `${c.source} ${c.statusLabel}`;
          if (demo || status !== "verified") expect(words).not.toMatch(/verified/i);
        }
  });

  it("a verified, non-demo claim may say Verified", () => {
    const c = journeyCardContent(ev({ kind: "verified", status: "verified", demo: false }));
    expect(`${c.statusLabel} ${c.source}`).toMatch(/Verified/);
  });

  it("UNKNOWN cards say Not checked yet; the VR line only when a request was filed", () => {
    const e = ev({ kind: "unknown", status: "unknown" });
    const c = journeyCardContent(e);
    expect(c.statusLabel).toBe(NOT_CHECKED);
    expect(c.source).toContain(NOT_CHECKED);
    expect(c.source).not.toContain(VR_FILED);
    expect(withVerificationRequest(c, e, true).source).toBe(`${NOT_CHECKED} · ${VR_FILED}`);
    expect(withVerificationRequest(c, e, false)).toEqual(c);
  });

  it("the VR line is never added to a card that is not about an unchecked fact", () => {
    for (const kind of ["verified", "rest", "gap", "arrive"] as const) {
      const e = ev({ kind, status: kind === "gap" || kind === "arrive" ? "route" : "verified" });
      const c = journeyCardContent(e);
      expect(withVerificationRequest(c, e, true)).toEqual(c);
    }
  });

  it("the gap card names the gap as a gap, never blocked or unsafe", () => {
    const gap = plan.events.find((e) => e.kind === "gap") as JourneyEvent;
    const c = journeyCardContent(gap);
    expect(c.statusLabel).toBe("Data gap");
    expect(c.title).toBe("No mapped rest stop ahead");
    for (const t of texts(c)) expect(t).not.toMatch(/blocked|unsafe|not reachable/i);
  });

  it("a reported roof says reported and not checked yet", () => {
    const c = journeyCardContent(ev({ kind: "covered", status: "reported" }));
    expect(c.statusLabel).toMatch(/Reported/);
    expect(c.source).toMatch(/not checked yet/i);
  });

  it("the demo plan: one honest card per event, demo chip text is exact", () => {
    expect(DEMO_CHIP).toBe("Demo value · not surveyed");
    for (const e of plan.events) {
      const c = journeyCardContent(e);
      for (const t of texts(c)) expect(honestyViolations(t)).toEqual([]);
      if (e.demo) for (const t of texts(c)) expect(t).not.toMatch(/\bverified\b/i);
    }
    const step = journeyCardContent(plan.events.find((e) => e.kind === "verified") as JourneyEvent);
    expect(step.demoChip).toBe(true);
    expect(step.statusLabel).not.toMatch(/verified/i);
  });
});
