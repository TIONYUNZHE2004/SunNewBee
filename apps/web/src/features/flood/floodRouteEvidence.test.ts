import { describe, expect, it } from "vitest";
import { floodRouteEvidence } from "./floodRouteEvidence";
import type { ResidentTrip } from "./floodStoryData";
import type { AffectedResult } from "./impactModel";

const affected = { likely_edge_ids: ["flooded"] } as AffectedResult;
const route = (id: string, edges: string[]) => ({
  id,
  segments: edges.map((edge_id) => ({ edge_id })),
});
const trip = (before: string[], after: string[]) =>
  ({
    plan: { route_id: "after" },
    baseline: { routes: [route("before", before)] },
    route: { routes: [route("after", after)] },
  }) as ResidentTrip;

describe("flood detour evidence", () => {
  it("requires a flooded baseline edge and an after route around it", () => {
    expect(floodRouteEvidence(trip(["flooded"], ["around"]), affected)).toEqual({
      kind: "detour",
      edgeId: "flooded",
    });
    expect(floodRouteEvidence(trip(["flooded"], ["flooded"]), affected).kind).not.toBe("detour");
  });
  it("does not invent a detour when only the scenario-specific route id changes", () => {
    expect(floodRouteEvidence(trip(["a", "b"], ["a", "b"]), affected).kind).toBe("unchanged");
    expect(floodRouteEvidence(trip(["a"], ["b"]), affected).kind).toBe("not_evidenced");
  });
});
