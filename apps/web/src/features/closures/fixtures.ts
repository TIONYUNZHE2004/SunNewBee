import type { ClosureImpact } from "./closureSimModel";

/** A `POST /closures/simulate` response in the generated shape: road works on one road. One
 * detour name repeats (the engine returns a row per stretch), as on the Elmina seed. */
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
