import type { ResidentTrip } from "./floodStoryData";
import type { AffectedResult } from "./impactModel";

/** A detour tag needs an actual baseline edge reached by the +3 m scenario AND an after route
 * without that edge. Different route ids alone only encode the scenario; they prove no detour. */
export function floodRouteEvidence(trip: ResidentTrip, affected: AffectedResult) {
  const likely = new Set(affected.likely_edge_ids ?? []);
  const before = trip.baseline?.routes[0];
  const after = trip.route.routes.find((r) => r.id === trip.plan.route_id) ?? trip.route.routes[0];
  if (!after) return { kind: "gap" as const, edgeId: null };
  const reached = before?.segments.find((s) => likely.has(s.edge_id));
  const afterFlooded = after.segments.some((s) => likely.has(s.edge_id));
  if (reached && !afterFlooded) return { kind: "detour" as const, edgeId: reached.edge_id };
  const same =
    before &&
    before.segments.map((s) => s.edge_id).join("|") ===
      after.segments.map((s) => s.edge_id).join("|");
  return { kind: same ? ("unchanged" as const) : ("not_evidenced" as const), edgeId: null };
}
