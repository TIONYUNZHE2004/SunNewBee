import { describe, expect, it } from "vitest";
import { closureTitle, closureWindow, routeClosures } from "./routeClosures";

const c = {
  id: "c1",
  element_id: "seg-cd",
  element_name: "Jalan Detour",
  reason: "works" as const,
  event_name: "Pipe repair",
  starts_at: "2026-10-21T01:00:00Z", // 09:00 Malaysia
  ends_at: "2026-10-21T09:00:00Z", // 17:00 Malaysia
  active: true,
  label: "Closed: works until 21 Oct 2026",
  source_label: "Reported closure (staff)",
};

describe("route card closures (T-027)", () => {
  it("names the reason and the closure, and the window in Malaysia time", () => {
    expect(closureTitle(c)).toBe("Works (Pipe repair)");
    expect(closureTitle({ reason: "event", event_name: null })).toBe("Event");
    expect(closureWindow(c)).toBe("21 Oct, 09:00–17:00");
    expect(closureWindow({ ...c, ends_at: null })).toBe("from 21 Oct, until further notice");
  });

  it("keeps only active closures the route answer met", () => {
    const items = [
      { element_id: "seg-cd", attribute: "closure" },
      { element_id: "seg-zz", attribute: "incline_pct" },
    ];
    expect(routeClosures(items, [c, { ...c, id: "c2", element_id: "seg-zz" }])).toEqual([c]);
    expect(routeClosures(items, [{ ...c, active: false }])).toEqual([]);
  });
});
