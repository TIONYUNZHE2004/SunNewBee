import { describe, expect, it } from "vitest";
import { groupTickets, timeAgo, toTicket } from "./ticketModel";

const NOW = new Date("2026-10-16T12:00:00Z");
const vr = (o: Record<string, unknown> = {}) =>
  ({
    id: "vr-1",
    element_id: "seg-1",
    attribute: "step_count",
    reason: "no_route_unverified_segment",
    status: "open",
    demand: 14,
    question_summary: "Stroller route from Car Park B to Playground",
    created_at: "2026-10-16T10:00:00Z",
    current_value: null,
    ...o,
  }) as never;

describe("ticketModel", () => {
  it("maps fields to structured ticket text only", () => {
    const t = toTicket(vr(), new Map([["seg-1", "Block C footway"]]), NOW);
    expect(t.fact).toBe("Step count");
    expect(t.place).toBe("Block C footway");
    expect(t.reasonLabel).toBe("No route: unverified segment");
    expect(t.asked).toBe(14);
    expect(t.ago).toBe("2 h ago");
    expect(t.hasCurrent).toBe(false);
    expect(t.isOpen).toBe(true);
  });
  it("falls back to the id when the element has no name", () => {
    expect(toTicket(vr(), new Map(), NOW).place).toBe("seg-1");
  });
  it("sorts To check by times asked, most first", () => {
    const g = groupTickets([
      toTicket(vr({ id: "a", demand: 2 }), new Map(), NOW),
      toTicket(vr({ id: "b", demand: 9 }), new Map(), NOW),
    ]);
    expect(g.toCheck.map((t) => t.id)).toEqual(["b", "a"]);
  });
  it("resolved and rejected tickets are Checked; rejected is flagged", () => {
    const r = toTicket(
      vr({
        status: "resolved",
        resolved_at: "2026-10-16T11:00:00Z",
        resolution: { action: "correct", value: "0 steps" },
      }),
      new Map(),
      NOW,
    );
    const x = toTicket(
      vr({
        status: "rejected",
        resolved_at: "2026-10-16T11:00:00Z",
        resolution: { action: "reject" },
      }),
      new Map(),
      NOW,
    );
    expect(r.isChecked).toBe(true);
    expect(r.resolution?.value).toBe("0 steps");
    expect(x.isRejected).toBe(true);
    expect(groupTickets([r, x]).checked).toHaveLength(2);
  });
  it("never exposes a resident's own words: only the structured question_summary", () => {
    const t = toTicket(vr({ question_summary: null }), new Map(), NOW);
    expect(t.kind).toBe("Resident question");
  });
  it("timeAgo", () => {
    expect(timeAgo("2026-10-16T11:59:40Z", NOW)).toBe("just now");
    expect(timeAgo("2026-10-16T11:30:00Z", NOW)).toBe("30 min ago");
    expect(timeAgo("2026-10-14T12:00:00Z", NOW)).toBe("2 d ago");
  });
});
