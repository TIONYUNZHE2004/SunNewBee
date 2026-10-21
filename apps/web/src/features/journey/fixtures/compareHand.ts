import type { CompareIntent, CompareRoute } from "../compareTypes";

/**
 * A hand-built `route.compare` payload for tests, laid out so every route-tied beat lands exactly
 * on the spec §5.4 baseline: recommended 520 m in 26 s = 20 m/s from t = 3 s, so a point at m
 * metres is reached at 3 + m / 20 s. Not Elmina data: the recorded fixture (B6) replaces it for
 * the corridor checks.
 */
export function handCompare(over: Partial<CompareIntent> = {}): CompareIntent {
  const line = (id: string, distance_m: number, est_minutes: number): CompareRoute => ({
    id,
    status: "confirmed",
    distance_m,
    est_minutes,
    segments: [
      { edge_id: `${id}-e1`, eval: "PASS" },
      { edge_id: `${id}-e2`, eval: "PASS" },
    ],
    coordinates: [
      [101.5, 3.18],
      [101.501, 3.181],
    ],
    demo_evidence: true,
  });
  return {
    kind: "route.compare",
    route_id: "rt-rec",
    from_place: { id: "pl-car-park-b", name: "Car Park B" },
    to_place: { id: "pl-playground", name: "Playground" },
    status: "partly_unverified",
    profile: "wheelchair",
    same_path: false,
    fastest: { ...line("rt-fast", 400, 5.7), status: "blocked" },
    recommended: { ...line("rt-rec", 520, 7.4), status: "partly_unverified" },
    // (16.7 - 3) * 20 = 274 m
    stop: {
      edge_id: "rt-fast-e2",
      at_m: 274,
      attribute: "step_count",
      value: 3,
      limit: 0,
      evidence_id: "ev-rt-fast-e2.step_count",
    },
    reasons: {
      fastest: {
        steps: 3,
        max_incline_pct: 6,
        min_width_m: 0.9,
        covered_share: 0.1,
        rest_stops: 0,
        distance_m: 400,
        minutes: 5.7,
      },
      recommended: {
        steps: 0,
        max_incline_pct: 4,
        min_width_m: 1.2,
        covered_share: 0.45,
        rest_stops: 1,
        distance_m: 520,
        minutes: 7.4,
      },
    },
    extra_minutes: 1.7,
    // unchecked tag at 13.6 s: (13.6 - 3) * 20 = 212 m; the ticket then flies at 17.6 s
    unchecked: [
      { edge_id: "rt-rec-e2", attribute: "incline_pct", start_m: 212, end_m: 252, length_m: 40 },
    ],
    pois: [
      { kind: "kerb", at_m: 0, value: "flush", evidence_ids: ["ev-k"], demo: true },
      { kind: "covered_start", at_m: 30, value: true, evidence_ids: ["ev-c"], demo: true },
      { kind: "incline", at_m: 146, value: 4, evidence_ids: ["ev-i"], demo: true },
      { kind: "unknown", at_m: 212, value: null, evidence_ids: [], demo: false },
      { kind: "seating", at_m: 330, value: "bench", evidence_ids: ["ev-s"], demo: true },
      { kind: "arrival", at_m: 520, value: null, evidence_ids: [], demo: false },
    ],
    vr: { id: "vr-1", created: true, target_id: "rt-rec-e2", attribute: "incline_pct" },
    confirm_n: 7,
    ...over,
  };
}
