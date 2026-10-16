import { describe, expect, it } from "vitest";
import { impactLines } from "./impactModel";

const base = { profile: "stroller", sampled: 4, note: "A planning estimate." };

describe("impactLines", () => {
  it("open ticket: would, never changed; own journey and demo caveat", () => {
    const l = impactLines({
      ...base,
      mode: "would",
      became_confirmed: 1,
      lost_route: 0,
      own: {
        from_name: "Car Park B",
        to_name: "Park kiosk",
        statuses: { now: "partly_unverified", pass: "confirmed", fail: "blocked" },
        demo_values: true,
      },
    });
    expect(l?.title).toBe("What this check would change");
    expect(l?.headline).toContain("would become confirmed");
    expect(l?.headline).not.toContain("changed");
    expect(l?.own).toContain("if it passes confirmed");
    expect(l?.own).toContain("demo values, not yet surveyed");
    expect(l?.sample).toContain("4 everyday stroller journeys");
  });

  it("resolved: says what changed, including routes lost", () => {
    const l = impactLines({ ...base, mode: "did", changed: 2, became_confirmed: 0, lost_route: 2 });
    expect(l?.title).toBe("What this check changed");
    expect(l?.headline).toContain("2 lost their route");
  });

  it("assumed profile is said; none mode shows nothing", () => {
    expect(impactLines({ ...base, mode: "would", profile_assumed: true })?.sample).toContain(
      "profile assumed",
    );
    expect(impactLines({ ...base, mode: "none" })).toBeNull();
  });
});
