import type { ClosureImpact } from "./closureSimModel";

/** A typed T-026 contract response (mocked until the backend lands): road works on one road. */
export const SIM_RESULT: ClosureImpact = {
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
  ],
  suggestions: [
    {
      kind: "signpost",
      text: "Signpost the detour via Jalan Dillenia instead of Persiaran Tamarind.",
      basis: "detour_roads[Persiaran Tamarind].weighted_trips=8",
    },
  ],
  closures: [{ segment_ids: ["seg-ab"] }],
  weights_note: "Peak weights are an assumed travel pattern, not measured.",
  disclaimer:
    "Detour pressure, estimated from mapped road class and sample trips, not traffic counts.",
  timing_ms: 4200,
};
