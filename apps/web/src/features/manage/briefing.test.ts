import { describe, expect, it } from "vitest";
import { summariseBriefing } from "./FloodBriefing";

describe("summariseBriefing", () => {
  it("counts", () => {
    const b = {
      affected: { likely: [{}, {}], possible: [{}], isolated_components: [{}] },
      centres: [{ reachable: true }, { reachable: false }],
    };
    expect(summariseBriefing(b as never)).toEqual({
      likely: 2,
      possible: 1,
      islands: 1,
      reachable: 1,
    });
  });
});
