import { describe, expect, it } from "vitest";
import { buildVrQuery, DEFAULT_FILTERS, vrQueryKey } from "./queueFilters";

describe("buildVrQuery", () => {
  it("defaults to the open tab with no other filters", () => {
    expect(buildVrQuery(DEFAULT_FILTERS)).toBe("?status=open");
  });
  it("maps tabs to status, All to status=all", () => {
    expect(buildVrQuery({ ...DEFAULT_FILTERS, tab: "resolved" })).toBe("?status=resolved");
    expect(buildVrQuery({ ...DEFAULT_FILTERS, tab: "all" })).toBe("?status=all");
  });
  it("adds reason, attribute and trimmed element id; skips blanks", () => {
    const q = buildVrQuery({
      tab: "open",
      reason: "stale",
      attribute: "incline_pct",
      elementId: "  seg cf/1 ",
    });
    expect(q).toBe("?status=open&reason=stale&attribute=incline_pct&element_id=seg+cf%2F1");
    expect(buildVrQuery({ tab: "open", reason: "", attribute: "", elementId: "   " })).toBe(
      "?status=open",
    );
  });
  it("trims the attribute too", () => {
    expect(buildVrQuery({ ...DEFAULT_FILTERS, attribute: " x " })).toBe("?status=open&attribute=x");
  });
  it("query key changes with filters", () => {
    expect(vrQueryKey(DEFAULT_FILTERS)).not.toEqual(vrQueryKey({ ...DEFAULT_FILTERS, tab: "all" }));
    expect(vrQueryKey(DEFAULT_FILTERS).slice(0, 2)).toEqual(["manage", "vrs"]);
  });
});
