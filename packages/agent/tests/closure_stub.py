"""Stand-in for the backend's `simulate_closure` (T-026 contract, tasks/T-026 on the board) until
it lands: the T-025 event engine plus the contract's pressure fields. Tests only."""

from townshiplens_spatial import events
from townshiplens_spatial.models import Evidence, ToolResult

CAPACITY = {"secondary": 4, "tertiary": 3, "unclassified": 2, "residential": 1, "service": 0.5}
DISCLAIMER = (
    "Detour pressure, estimated from mapped road class and sample trips, not traffic counts."
)
WEIGHTS_NOTE = "Peak weights are an assumed travel pattern, not measured."


def _band(pressure: float) -> str:
    return "low" if pressure < 1 else "medium" if pressure <= 3 else "high"


def simulate_closure(ctx, name, reason, closures, profiles=None, at=None) -> ToolResult:
    segs = [s for c in closures for s in c["segment_ids"]]
    spec = events.EventSpec(
        name=name,
        segment_ids=segs,
        starts_at=closures[0]["starts_at"],
        ends_at=closures[0]["ends_at"],
    )
    impact = events.simulate_event(
        ctx.world, spec, tuple(profiles) if profiles else events.DEFAULT_PROFILES
    )
    d = impact.model_dump(mode="json")
    for road in d["detour_roads"]:
        tags = ctx.world.edges[road["segment_ids"][0]].osm_tags if road["segment_ids"] else {}
        cls = (tags or {}).get("highway") or "unclassified"
        road.update(
            weighted_trips=float(road["trips"]),
            road_class=cls,
            pressure=_band(road["trips"] / CAPACITY.get(cls, 1)),
        )
    d["detour_roads"].sort(key=lambda r: -r["weighted_trips"])
    if top := next((r for r in d["detour_roads"] if r["pressure"] == "high"), None):
        d["suggestions"].insert(
            0,
            {
                "kind": "signpost",
                "text": f"Signpost the detour away from {top['name']}: "
                f"{top['trips']} sample trips reroute onto it.",
                "basis": f"detour_roads[{top['name']}].weighted_trips={top['weighted_trips']}",
            },
        )
    d.update(reason=reason, weights_note=WEIGHTS_NOTE, disclaimer=DISCLAIMER, timing_ms=0)
    ev_id = d["evidence_id"].replace("ev-event-", "ev-closure-")
    d["evidence_id"] = ev_id
    return ToolResult(
        ok=True,
        data=d,
        evidence=[
            Evidence(
                id=ev_id,
                element_id="closure",
                attribute="closure_simulation",
                value={"trips_total": d["trips_total"], "trips_affected": d["trips_affected"]},
                status="indicative",
                source_type="Mapped roads and sample journeys",
            )
        ],
        warnings=[DISCLAIMER, WEIGHTS_NOTE],
    )
