"""Deterministic before/after event estimates over the existing everyday trip sample."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from statistics import median
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import flood, twm
from .routing import eval_memo
from .sim import snapshot_world
from .world import World

DISCLAIMER = "Estimate from mapped roads and sample trips, not traffic counts."
MAX_SEGMENTS = 40
DEFAULT_PROFILES = ("default", "wheelchair", "drive")


class EventSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    segment_ids: list[str] = Field(min_length=1, max_length=MAX_SEGMENTS)
    starts_at: datetime
    ends_at: datetime

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("event name must not be blank")
        return value.strip()

    @field_validator("segment_ids")
    @classmethod
    def _segments(cls, values: list[str]) -> list[str]:
        if any(not v.strip() or len(v) > 120 for v in values):
            raise ValueError("segment ids must be nonempty and at most 120 characters")
        return list(dict.fromkeys(values))

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)

    @model_validator(mode="after")
    def _window(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class EventTrip(BaseModel):
    from_id: str
    to_id: str
    profile: str
    before_status: str
    after_status: str
    affected: bool
    no_route: bool
    before_m: float | None
    after_m: float | None
    extra_m: float | None
    extra_min: float | None
    segment_ids: list[str]


class ProfileImpact(BaseModel):
    trips_total: int
    trips_affected: int
    trips_no_route: int
    trips_no_route_before: int
    trips_newly_no_route: int
    extra_m_median: float | None
    extra_min_median: float | None


class EventPlace(BaseModel):
    id: str
    name: str


class DetourRoad(BaseModel):
    name: str
    segment_ids: list[str]
    trips: int


class EventSuggestion(BaseModel):
    kind: Literal["marshal", "crossing_point", "reschedule"]
    text: str
    basis: str


class EventImpact(ProfileImpact):
    event: EventSpec
    per_profile: dict[str, ProfileImpact]
    places_cut_off: list[EventPlace]
    detour_roads: list[DetourRoad]
    suggestions: list[EventSuggestion]
    trips: list[EventTrip]
    sample_limit_per_profile: int
    evidence_id: str
    disclaimer: str = DISCLAIMER
    warnings: list[str] = Field(default_factory=list)


def validate_event(world: World, spec: EventSpec) -> None:
    if unknown := sorted(set(spec.segment_ids) - world.edges.keys()):
        raise ValueError(f"unknown segments: {', '.join(unknown)}")


def _summary(trips: list[EventTrip]) -> ProfileImpact:
    metres = [t.extra_m for t in trips if t.extra_m is not None]
    minutes = [t.extra_min for t in trips if t.extra_min is not None]
    return ProfileImpact(
        trips_total=len(trips),
        trips_affected=sum(t.affected for t in trips),
        trips_no_route=sum(t.no_route for t in trips),
        trips_no_route_before=sum(t.before_m is None for t in trips),
        trips_newly_no_route=sum(t.before_m is not None and t.no_route for t in trips),
        extra_m_median=round(median(metres), 1) if metres else None,
        extra_min_median=round(median(minutes), 1) if minutes else None,
    )


def simulate_event(
    world: World, spec: EventSpec, profiles: tuple[str, ...] = DEFAULT_PROFILES
) -> EventImpact:
    """Compare the same sampled trips without/with course closures at the window's start.

    Other staff closures are frozen at starts_at. The supplied window is stored only by
    POST /events; this function never mutates live state. Trip statuses retain no_data for
    pre-existing disconnected data. Extra distance/time medians cover rerouted trips only;
    time is the router's distance/pace estimate, never congestion or waiting time.
    """
    validate_event(world, spec)
    profiles = tuple(dict.fromkeys(profiles))
    if not profiles or len(profiles) > 5:
        raise ValueError("choose between one and five profiles")
    for profile in profiles:
        if profile not in world.profiles or world.profiles[profile].stub:
            raise ValueError(f"unknown or unavailable profile {profile}")
    baseline, _ = snapshot_world(world, spec.starts_at)
    # snapshot_world keeps future starts; normalise the frozen active closures so the
    # wall clock cannot switch them off when simulating a future event.
    for element in (*baseline.edges.values(), *baseline.places.values()):
        element.closures = [
            c.model_copy(update={"starts_at": datetime(2000, 1, 1, tzinfo=UTC)})
            for c in element.closures
        ]
    actions = [twm.ClosePath(element_id=eid) for eid in spec.segment_ids]
    limit = twm.MAX_JOURNEYS // len(profiles)
    journeys = [j for p in profiles for j in twm.suite_journeys(baseline, p)[:limit]]
    result = twm.compare(baseline, actions, journeys, max_actions=MAX_SEGMENTS)
    after = twm.apply(baseline, actions, max_actions=MAX_SEGMENTS).world
    trips = []
    roads: dict[str, tuple[set[str], int]] = {}
    for outcome in result.journeys:
        b, a = outcome.before, outcome.after
        rerouted = (
            b.distance_m is not None and a.distance_m is not None and b.segment_ids != a.segment_ids
        )
        lost = b.distance_m is not None and a.distance_m is None
        trips.append(
            EventTrip(
                **outcome.journey.model_dump(),
                before_status=b.status,
                after_status=a.status,
                affected=rerouted or lost,
                no_route=a.distance_m is None,
                before_m=b.distance_m,
                after_m=a.distance_m,
                extra_m=round(a.distance_m - b.distance_m, 1) if rerouted else None,
                extra_min=round(a.est_minutes - b.est_minutes, 1) if rerouted else None,
                segment_ids=a.segment_ids,
            )
        )
        if rerouted:
            per_road: dict[str, set[str]] = {}
            for eid in set(a.segment_ids) - set(b.segment_ids):
                name = world.edges[eid].name or "Unnamed paths"
                per_road.setdefault(name, set()).add(eid)
            for name, ids in per_road.items():
                old_ids, count = roads.get(name, (set(), 0))
                roads[name] = (old_ids | ids, count + 1)
    detours = sorted(
        (
            DetourRoad(name=name, segment_ids=sorted(ids), trips=n)
            for name, (ids, n) in roads.items()
        ),
        key=lambda r: (-r.trips, r.name),
    )
    cut_off: dict[str, EventPlace] = {}
    with eval_memo():
        for profile in profiles:
            before_ids = {p.id for p in flood.cut_off_places(baseline, profile)}
            for p in flood.cut_off_places(after, profile):
                if p.id not in before_ids:
                    cut_off[p.id] = EventPlace(id=p.id, name=p.name)
    summary = _summary(trips)
    suggestions = [
        EventSuggestion(
            kind="marshal",
            text=(
                f"Consider marshals or signs on {road.name}: "
                f"{road.trips} sample trips reroute onto it."
            ),
            basis=f"detour_roads[{road.name}].trips={road.trips}",
        )
        for road in detours[:3]
    ]
    if cut_off:
        names = ", ".join(p.name for p in sorted(cut_off.values(), key=lambda p: p.id)[:3])
        suggestions.append(
            EventSuggestion(
                kind="crossing_point",
                text=(
                    f"Review a crossing point near {names}: "
                    f"{len(cut_off)} mapped places lose centre access."
                ),
                basis=f"places_cut_off count={len(cut_off)}",
            )
        )
    if summary.trips_affected and summary.trips_affected * 2 >= summary.trips_total:
        suggestions.append(
            EventSuggestion(
                kind="reschedule",
                text=(
                    "Consider shifting the start time or splitting the course: "
                    f"{summary.trips_affected} of {summary.trips_total} sample trips are affected. "
                    "Other times have not been simulated."
                ),
                basis=f"trips_affected={summary.trips_affected}; trips_total={summary.trips_total}",
            )
        )
    digest = hashlib.sha256((spec.model_dump_json() + result.evidence.id).encode()).hexdigest()[:12]
    warnings = [
        "Sample trips are a deterministic prefix of everyday journeys, not measured demand.",
        "Existing closures are assessed at starts_at; "
        "changes later in the window are not modelled.",
        "Extra minutes are travel-distance/pace estimates, not congestion or crowd predictions.",
    ]
    if any(o.before.demo_evidence or o.after.demo_evidence for o in result.journeys):
        warnings.append("Some routes use demo values, not yet surveyed.")
    warnings.extend(
        world.profiles[p].standing_warning for p in profiles if world.profiles[p].standing_warning
    )
    return EventImpact(
        **summary.model_dump(),
        event=spec,
        per_profile={p: _summary([t for t in trips if t.profile == p]) for p in profiles},
        places_cut_off=sorted(cut_off.values(), key=lambda p: p.id),
        detour_roads=detours,
        suggestions=suggestions,
        trips=trips,
        sample_limit_per_profile=limit,
        evidence_id=f"ev-event-{digest}",
        warnings=warnings,
    )
