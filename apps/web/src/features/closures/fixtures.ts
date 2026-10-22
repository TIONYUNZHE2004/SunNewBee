import type { ClosureImpact, MarathonResult } from "./closureSimModel";

/** A `POST /closures/simulate` response in the generated shape: road works on one road. One
 * detour name repeats, so the card must not key rows by name. */
export const SIM_RESULT: ClosureImpact = {
  at: "2026-10-27T01:00:00Z",
  event: {
    name: "Pipe repair",
    reason: "works",
    closures: [
      {
        road_names: ["Persiaran Garcinia"],
        segment_ids: ["seg-ab"],
        starts_at: "2026-10-27T01:00:00Z",
        ends_at: "2026-10-27T09:00:00Z",
      },
    ],
  },
  evidence_id: "ev-closure-1",
  per_profile: {},
  sample_limit_per_profile: 100,
  trips: [],
  trips_total: 63,
  trips_affected: 7,
  trips_no_route: 45,
  trips_no_route_before: 42,
  trips_newly_no_route: 3,
  trips_on_course: 4,
  extra_m_median: 82.5,
  extra_min_median: 0.2,
  places_cut_off: [{ id: "p-park", name: "Parking (unnamed, OSM)" }],
  detour_roads: [
    {
      name: "Persiaran Tamarind",
      segment_ids: ["seg-bc"],
      trips: 4,
      weighted_trips: 8,
      road_class: "residential",
      pressure: "high",
    },
    {
      name: "Jalan Dillenia",
      segment_ids: ["seg-cd"],
      trips: 1,
      weighted_trips: 1,
      road_class: "tertiary",
      pressure: "low",
    },
    {
      name: "Persiaran Tamarind",
      segment_ids: ["seg-de"],
      trips: 2,
      weighted_trips: 2,
      road_class: "residential",
      pressure: "medium",
    },
  ],
  suggestions: [
    {
      kind: "signpost",
      text: "Review signposting the detour via Jalan Dillenia instead of Persiaran Tamarind.",
      basis:
        "detour_roads[Persiaran Tamarind].weighted_trips=8; capacity[residential]=1; capacity[tertiary]=3",
    },
    {
      kind: "marshal",
      text: "Consider a marshal at Persiaran Tamarind: 4 sample trips reroute onto it.",
      basis: "detour_roads[Persiaran Tamarind].trips=4; weighted_trips=8",
    },
    {
      kind: "marshal",
      text: "Consider a marshal at Persiaran Tamarind: 4 sample trips reroute onto it.",
      basis: "detour_roads[Persiaran Tamarind].trips=4; weighted_trips=8",
    },
  ],
  weights_note: "Peak weights are an assumed travel pattern, not measured.",
  disclaimer:
    "Detour pressure, estimated from mapped road class and sample trips, not traffic counts.",
  timing_ms: 4200,
};

/** A `marathon.show` payload: a short proposed loop and its impact (the same numbers). */
export const MARATHON: MarathonResult = {
  course: {
    segment_ids: ["seg-ab", "seg-bc"],
    length_m: 5102.7,
    roads: [
      { name: "Persiaran Tamarind", length_m: 376.9, order: 1 },
      { name: "Persiaran Dillenia", length_m: 488.9, order: 2 },
    ],
    start: "p-park",
    finish: "p-park",
    start_node: "n1",
    finish_node: "n1",
    shape: "loop",
    warnings: [],
    disclaimer: "Proposed course on mapped roads, not an approved route.",
  },
  impact: {
    ...SIM_RESULT,
    event: {
      name: "Proposed marathon",
      reason: "event",
      closures: [
        {
          segment_ids: ["seg-ab", "seg-bc"],
          starts_at: "2026-10-25T22:00:00Z",
          ends_at: "2026-10-26T02:00:00Z",
        },
      ],
    },
  },
  animation: {
    label: "Simulation · illustrative",
    course_coordinates: [
      [101.5, 3.1],
      [101.51, 3.1],
    ],
    rerouted_trips: [],
  },
};
