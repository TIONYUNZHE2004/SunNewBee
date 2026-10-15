import { describe, expect, it } from "vitest";
import { tabFromParam } from "./ManagePage";

describe("tabFromParam", () => {
  it("maps known tabs and defaults to the queue", () => {
    expect(tabFromParam("briefing")).toBe("briefing");
    expect(tabFromParam("flood")).toBe("briefing");
    expect(tabFromParam("journeys")).toBe("journeys");
    expect(tabFromParam("closures")).toBe("closures");
    expect(tabFromParam("queue")).toBe("queue");
    expect(tabFromParam(null)).toBe("queue");
    expect(tabFromParam("zzz")).toBe("queue");
  });
});
