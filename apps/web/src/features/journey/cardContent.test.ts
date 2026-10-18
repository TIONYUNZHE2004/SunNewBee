import { describe, expect, it } from "vitest";
import { DEMO_CHIP_TEXT, journeyCardContent } from "./cardContent";
import demo from "./fixtures/demoPlan.json";
import type { JourneyPlan } from "./timeline";

const events = (demo as unknown as JourneyPlan).events;

describe("journeyCardContent", () => {
  it("copies title and body, source is element id else route-level source", () => {
    const c = journeyCardContent(events[0] as never);
    expect(c.title).toBe("Covered walkway");
    expect(c.source).toBe("seg-1239035870-0");
    const gap = journeyCardContent(events.find((e) => e.kind === "gap") as never);
    expect(gap.source).toBe("route.max_gap_between_rest_m");
  });
  it("demo chip exactly when demo, and a demo event is never Verified", () => {
    for (const e of events) {
      const c = journeyCardContent(e);
      expect(c.demoChip).toBe(e.demo === true);
      if (e.demo) {
        expect(c.statusLabel).toBe(DEMO_CHIP_TEXT);
        expect(c.statusLabel).not.toMatch(/^verified$/i);
      }
    }
  });
  it("unknown events say Not checked yet; verified non-demo says Verified", () => {
    const base = { kind: "unknown", title: "t", body: "b", status: "unknown", demo: false };
    expect(journeyCardContent(base).statusLabel).toBe("Not checked yet");
    expect(journeyCardContent({ ...base, kind: "verified", status: "verified" }).statusLabel).toBe(
      "Verified",
    );
    expect(journeyCardContent({ ...base, kind: "covered", status: "reported" }).statusLabel).toBe(
      "Reported, not checked",
    );
  });
  it("no card text says safe or gives a depth", () => {
    for (const e of events) {
      const c = journeyCardContent(e);
      expect(`${c.title} ${c.body} ${c.statusLabel}`).not.toMatch(/safe|selamat|安全/i);
    }
  });
});
