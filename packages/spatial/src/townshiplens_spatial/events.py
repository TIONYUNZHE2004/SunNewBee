"""General closure impact and the backwards-compatible event simulation alias (T-026)."""

from __future__ import annotations

import hashlib
import threading
from collections import Counter, OrderedDict
from datetime import UTC, date, datetime
from math import atan2, degrees
from statistics import median
from time import perf_counter
from typing import Literal, Self

import networkx as nx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import closure_roads, flood, traffic, twm
from .direction import direction_rule
from .geo import haversine_m
from .models import ClosureReason
from .routing import _road_nodes, _targets, route_batch
from .sim import ORIGIN_TYPES, snapshot_world
from .world import World

DISCLAIMER = "Estimate from mapped roads and sample trips, not traffic counts."
PRESSURE_DISCLAIMER = (
    "Detour pressure, estimated from mapped road class and sample trips, not traffic counts."
)
MAX_SEGMENTS = 40
MAX_COURSE_SEGMENTS = 400
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


class ClosureWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    segment_ids: list[str] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    road_names: list[str] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    starts_at: datetime
    ends_at: datetime

    _utc = field_validator("starts_at", "ends_at")(EventSpec._utc.__func__)

    @model_validator(mode="after")
    def _window(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if not self.segment_ids and not self.road_names:
            raise ValueError("provide segment_ids or road_names")
        if any(not v.strip() or len(v) > 300 for v in self.segment_ids + self.road_names):
            raise ValueError("road names and segment ids must be nonempty, at most 300 characters")
        return self


class ClosureScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    reason: ClosureReason
    closures: list[ClosureWindow] = Field(min_length=1, max_length=MAX_SEGMENTS)

    _name = field_validator("name")(EventSpec._name.__func__)


class CourseWindow(ClosureWindow):
    segment_ids: list[str] = Field(min_length=1, max_length=MAX_COURSE_SEGMENTS)


class CourseScenario(ClosureScenario):
    closures: list[CourseWindow] = Field(min_length=1, max_length=1)


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
    on_closed_course: bool = False


class ProfileImpact(BaseModel):
    trips_total: int
    trips_affected: int
    trips_no_route: int
    trips_no_route_before: int
    trips_newly_no_route: int
    extra_m_median: float | None
    extra_min_median: float | None
    trips_on_course: int = 0


class EventPlace(BaseModel):
    id: str
    name: str


class DetourRoad(BaseModel):
    name: str
    segment_ids: list[str]
    trips: int
    weighted_trips: float
    road_class: str
    pressure: Literal["low", "medium", "high"]


class EventSuggestion(BaseModel):
    kind: Literal["signpost", "marshal", "crossing_point", "two_way", "split", "reschedule"]
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
    weights_note: str
    timing_ms: float
    warnings: list[str] = Field(default_factory=list)


class ClosureImpact(EventImpact):
    event: ClosureScenario
    at: datetime
    disclaimer: str = PRESSURE_DISCLAIMER


def validate_event(world: World, spec: EventSpec) -> None:
    if unknown := sorted(set(spec.segment_ids) - world.edges.keys()):
        raise ValueError(f"unknown segments: {', '.join(unknown)}")


def resolve_scenario(world: World, spec: ClosureScenario, limit=MAX_SEGMENTS) -> ClosureScenario:
    windows = [
        window.model_copy(
            update={
                "segment_ids": closure_roads.resolve(
                    world, window.road_names, window.segment_ids, limit
                )
            }
        )
        for window in spec.closures
    ]
    if sum(len(window.segment_ids) for window in windows) > limit:
        raise ValueError(f"at most {limit} segment/window pairs per scenario")
    return spec.model_copy(update={"closures": windows})


def _summary(trips: list[EventTrip]) -> ProfileImpact:
    ordinary = [t for t in trips if not t.on_closed_course]
    metres = [t.extra_m for t in ordinary if t.extra_m is not None]
    minutes = [t.extra_min for t in ordinary if t.extra_min is not None]
    return ProfileImpact(
        trips_total=len(trips),
        trips_affected=sum(t.affected for t in ordinary),
        trips_no_route=sum(t.no_route for t in ordinary),
        trips_no_route_before=sum(t.before_m is None for t in ordinary),
        trips_newly_no_route=sum(t.before_m is not None and t.no_route for t in ordinary),
        trips_on_course=sum(t.on_closed_course for t in trips),
        extra_m_median=round(median(metres), 1) if metres else None,
        extra_min_median=round(median(minutes), 1) if minutes else None,
    )


# Bounded across requests. Values retain the graph so object ids cannot be reused.
# world.version invalidates staff edits; date invalidates expiring checks; closure_hash
# invalidates clock-driven changes. Profiles and exact journey pairs are also in the key.
_BASELINES: OrderedDict = OrderedDict()
_BASELINE_LOCK = threading.Lock()


def _journeys(world, profile, limit, expanded):
    if not expanded:
        return twm.suite_journeys(world, profile)[:limit]
    types = {t for peak in traffic.config().peaks for t in peak.types} | {"facility", "toilet"}
    origins = sorted(p.id for p in world.places.values() if p.type in ORIGIN_TYPES)
    destinations = sorted(p.id for p in world.places.values() if p.type in types)
    # Rotate both sides of the bipartite sample, rather than filling it with the
    # first destination. Each complete round uses the smaller side exactly once.
    pairs = []
    small, large = sorted((origins, destinations), key=len)
    for offset in range(len(large)):
        for i, value in enumerate(small):
            other = large[(i + offset) % len(large)]
            o, d = (value, other) if small is origins else (other, value)
            if o != d:
                pairs.append(twm.Journey(from_id=o, to_id=d, profile=profile))
                if len(pairs) == limit:
                    return pairs
    return pairs


def _baseline(world, closure_hash, profile, journeys):
    key = (
        id(world.graph),
        world.version,
        date.today(),
        closure_hash,
        world.profiles[profile].model_dump_json(),
        tuple((j.from_id, j.to_id) for j in journeys),
    )
    with _BASELINE_LOCK:
        if key in _BASELINES:
            _BASELINES.move_to_end(key)
            return _BASELINES[key][1:]
    states = twm.rollout(world, None, journeys)
    cut_off = {p.id for p in flood.cut_off_places(world, profile)}
    with _BASELINE_LOCK:
        _BASELINES[key] = world.graph, states, cut_off
        while len(_BASELINES) > 12:
            _BASELINES.popitem(last=False)
    return states, cut_off


def _suggestions(world, detours, cut_off, summary, closed):
    suggestions = []
    capacities = traffic.config().capacity
    for road in detours:
        if road.pressure == "high" and road.road_class == "residential":
            nodes = closure_roads._nodes(world, road.segment_ids)
            candidates = [
                e
                for e in world.edges.values()
                if e.id not in closed
                and not any(c.is_active() for c in e.closures)
                and e.name
                and e.name != road.name
                and capacities.get(e.osm_tags.get("highway"), 1) > capacities["residential"]
                and nodes & {e.from_node, e.to_node}
            ]
            if candidates:
                via = min(
                    candidates, key=lambda e: (-capacities[e.osm_tags["highway"]], e.name, e.id)
                )
                suggestions.append(
                    EventSuggestion(
                        kind="signpost",
                        text=f"Review signposting the detour via {via.name} "
                        f"instead of {road.name}: "
                        f"{road.weighted_trips:g} weighted sample trips on a high-pressure "
                        "residential road. This alternative has not been simulated.",
                        basis=f"detour_roads[{road.name}].weighted_trips={road.weighted_trips:g}; "
                        f"capacity[residential]={capacities['residential']:g}; "
                        f"capacity[{via.osm_tags['highway']}]={capacities[via.osm_tags['highway']]:g}",
                    )
                )
        one_way = [
            eid for eid in road.segment_ids if direction_rule(world.edges[eid])[0] in (-1, 1)
        ]
        if one_way:
            suggestions.append(
                EventSuggestion(
                    kind="two_way",
                    text=f"Review temporary two-way operation on {road.name}: "
                    f"{len(one_way)} mapped one-way detour segments; staff approval is needed.",
                    basis=f"detour_roads[{road.name}].oneway_segments={len(one_way)}",
                )
            )
        if len([s for s in suggestions if s.kind == "marshal"]) < 3:
            suggestions.append(
                EventSuggestion(
                    kind="marshal",
                    text=f"Consider a marshal at {road.name}: {road.trips} sample trips reroute "
                    f"onto it ({road.weighted_trips:g} weighted trips).",
                    basis=f"detour_roads[{road.name}].trips={road.trips}; "
                    f"weighted_trips={road.weighted_trips:g}",
                )
            )
    if cut_off:
        boundaries = sorted(
            n
            for n in closure_roads._nodes(world, closed)
            if any(eid not in closed for data in world.graph[n].values() for eid in data)
        )
        if boundaries:
            node = boundaries[0]
            names = sorted(
                {
                    world.edges[eid].name
                    for data in world.graph[node].values()
                    for eid in data
                    if world.edges[eid].name
                }
            )
            junction = (
                f"the junction of {names[0]} and {names[1]}"
                if len(names) > 1
                else f"the mapped junction on {names[0]}"
                if names
                else "the mapped closure-boundary junction"
            )
            suggestions.append(
                EventSuggestion(
                    kind="crossing_point",
                    text=f"Review keeping one crossing point open at {junction}: "
                    f"{len(cut_off)} mapped places lose centre access. Access is not established "
                    "until the alternative is assessed.",
                    basis=f"places_cut_off count={len(cut_off)}; mapped_junction={node}",
                )
            )
    if summary.trips_affected and summary.trips_affected * 2 >= summary.trips_total:
        basis = f"trips_affected={summary.trips_affected}; trips_total={summary.trips_total}"
        if len(closed) > 1:
            suggestions.append(
                EventSuggestion(
                    kind="split",
                    text=f"Consider splitting the closure into stretches: {len(closed)} active "
                    f"segments affect {summary.trips_affected} of {summary.trips_total} sample "
                    "trips. Separate stretches have not been simulated.",
                    basis=f"{basis}; active_segments={len(closed)}",
                )
            )
        suggestions.append(
            EventSuggestion(
                kind="reschedule",
                text=f"Consider shifting the time: {summary.trips_affected} of "
                f"{summary.trips_total} sample trips are affected at this instant. "
                "Other times have not been simulated.",
                basis=basis,
            )
        )
    return suggestions


def _unnamed_stretches(world):
    """Connected unnamed areas, labelled by a mapped landmark, direction and length."""
    signature = tuple(
        (e.id, e.name, e.length_m, e.from_node, e.to_node) for e in world.edges.values()
    )
    cached = world.graph.graph.get("_closure_unnamed_stretches")
    if cached and cached[0] == signature:
        return cached[1]
    graph, named, anchors = nx.Graph(), {}, {}
    for edge in world.edges.values():
        if edge.name:
            for node in (edge.from_node, edge.to_node):
                named.setdefault(node, set()).add(edge.name)
            old = anchors.get(edge.name)
            if old is None or (edge.length_m, edge.id) > (old.length_m, old.id):
                anchors[edge.name] = edge
        else:
            graph.add_edge(edge.from_node, edge.to_node, length_m=edge.length_m)
    areas = []
    for nodes in sorted(nx.connected_components(graph), key=lambda ns: min(ns)):
        coords = [world.node_coords[n] for n in nodes]
        centre = [sum(x[k] for x in coords) / len(coords) for k in (0, 1)]
        adjacent = sorted({name for node in nodes for name in named.get(node, ())})
        if adjacent:
            near = adjacent[0]
        elif named:
            node = min(named, key=lambda n: (haversine_m(centre, world.node_coords[n]), n))
            near = min(named[node])
        else:
            near = None
        length = sum(data["length_m"] for _, _, data in graph.subgraph(nodes).edges(data=True))
        if near:
            edge = anchors[near]
            anchor = [(edge.coords[0][k] + edge.coords[-1][k]) / 2 for k in (0, 1)]
            bearing = (degrees(atan2(centre[0] - anchor[0], centre[1] - anchor[1])) + 360) % 360
            direction = (
                "north",
                "north-east",
                "east",
                "south-east",
                "south",
                "south-west",
                "west",
                "north-west",
            )[int((bearing + 22.5) // 45) % 8]
            label = f"unnamed path near {near} ({direction}, {length:.0f} m path)"
        else:
            label = f"unnamed path ({length:.0f} m path; no named road nearby)"
        areas.append((nodes, centre, label))
    counts = Counter(label for _, _, label in areas)
    labels = {}
    for nodes, centre, label in areas:
        if counts[label] > 1:
            # Coordinates identify the mapped location when direction/length coincide;
            # never expose an arbitrary traversal index as a road name.
            label += f" near {centre[1]:.7f}° N, {centre[0]:.7f}° E"
        for node in nodes:
            labels[node] = label
    result = {e.id: labels[e.from_node] for e in world.edges.values() if not e.name}
    world.graph.graph["_closure_unnamed_stretches"] = (signature, result)
    return result


def simulate_closure(
    world: World,
    spec: ClosureScenario,
    profiles: tuple[str, ...] = DEFAULT_PROFILES,
    at: datetime | None = None,
) -> ClosureImpact:
    return _simulate(world, spec, profiles, at, legacy=None)


def simulate_event(
    world: World, spec: EventSpec, profiles: tuple[str, ...] = DEFAULT_PROFILES
) -> EventImpact:
    """Legacy event shape and sample; uses the same closure engine and route caches."""
    validate_event(world, spec)
    scenario = ClosureScenario(
        name=spec.name,
        reason="event",
        closures=[ClosureWindow(**spec.model_dump(exclude={"name"}))],
    )
    return _simulate(world, scenario, profiles, spec.starts_at, legacy=spec)


def _frozen_baseline(world, at):
    baseline, closure_hash = snapshot_world(world, at)
    for element in (*baseline.edges.values(), *baseline.places.values()):
        element.closures = [
            c.model_copy(update={"starts_at": datetime(2000, 1, 1, tzinfo=UTC)})
            for c in element.closures
        ]
    return baseline, closure_hash


def warm_baselines(world: World, at: datetime | None = None) -> None:
    """Fill the normal closure sample cache without applying a proposed closure."""
    baseline, closure_hash = _frozen_baseline(world, at or datetime.now(UTC))
    profiles = [p for p in DEFAULT_PROFILES if p in world.profiles and not world.profiles[p].stub]
    with route_batch():
        for profile in profiles:
            journeys = _journeys(baseline, profile, twm.MAX_JOURNEYS // len(profiles), True)
            _baseline(baseline, closure_hash, profile, journeys)
    _unnamed_stretches(world)


def _simulate(world, spec, profiles, at, legacy, max_segments=MAX_SEGMENTS):
    started = perf_counter()
    spec = resolve_scenario(world, spec, max_segments)
    profiles = tuple(dict.fromkeys(profiles))
    if not profiles or len(profiles) > 5:
        raise ValueError("choose between one and five profiles")
    for profile in profiles:
        if profile not in world.profiles or world.profiles[profile].stub:
            raise ValueError(f"unknown or unavailable profile {profile}")
    at = EventSpec._utc(at or spec.closures[0].starts_at)
    baseline, closure_hash = _frozen_baseline(world, at)
    closed = {
        eid
        for window in spec.closures
        if window.starts_at <= at < window.ends_at
        for eid in window.segment_ids
    }
    course_nodes = closure_roads._nodes(baseline, closed)
    actions = [twm.ClosePath(element_id=eid) for eid in sorted(closed)]
    after = twm.apply(baseline, actions, max_actions=max_segments).world
    limit = twm.MAX_JOURNEYS // len(profiles)
    trips = []
    roads = {}
    unnamed = _unnamed_stretches(world)
    cut_off = {}
    demo = False
    with route_batch():
        for profile in profiles:
            journeys = _journeys(baseline, profile, limit, expanded=legacy is None)
            states, before_ids = _baseline(baseline, closure_hash, profile, journeys)
            prof = baseline.profiles[profile]
            road_nodes = _road_nodes(baseline, prof) if prof.allowed_types is not None else None
            on_course = {
                pid
                for pid in {pid for j in journeys for pid in (j.from_id, j.to_id)}
                if course_nodes.intersection(_targets(baseline, pid, prof, road_nodes=road_nodes))
            }
            for j, b in zip(journeys, states, strict=True):
                # Removing edges cannot improve an unavailable route. An existing best
                # route avoiding every removed edge is still optimal, so reuse it exactly.
                a = twm._state(after, j, None, True) if closed.intersection(b.segment_ids) else b
                rerouted = (
                    b.distance_m is not None
                    and a.distance_m is not None
                    and b.segment_ids != a.segment_ids
                )
                lost = b.distance_m is not None and a.distance_m is None
                endpoint_on_course = j.from_id in on_course or j.to_id in on_course
                demo |= b.demo_evidence or a.demo_evidence
                trips.append(
                    EventTrip(
                        **j.model_dump(),
                        before_status=b.status,
                        after_status=a.status,
                        affected=(rerouted or lost) and not endpoint_on_course,
                        on_closed_course=endpoint_on_course,
                        no_route=a.distance_m is None,
                        before_m=b.distance_m,
                        after_m=a.distance_m,
                        extra_m=round(a.distance_m - b.distance_m, 1) if rerouted else None,
                        extra_min=round(a.est_minutes - b.est_minutes, 1) if rerouted else None,
                        segment_ids=a.segment_ids,
                    )
                )
                if rerouted and not endpoint_on_course:
                    per_road = {}
                    for eid in set(a.segment_ids) - set(b.segment_ids):
                        edge = world.edges[eid]
                        per_road.setdefault(edge.name or unnamed[eid], set()).add(eid)
                    weight = traffic.trip_weight(
                        world.places[j.to_id].type, at, world.site.timezone
                    )
                    for key, ids in per_road.items():
                        old_ids, count, weighted = roads.get(key, (set(), 0, 0.0))
                        roads[key] = old_ids | ids, count + 1, weighted + weight
            if closed:
                for place in flood.cut_off_places(after, profile):
                    if place.id not in before_ids:
                        cut_off[place.id] = EventPlace(id=place.id, name=place.name)
    detours = sorted(
        [
            DetourRoad(
                name=name,
                segment_ids=sorted(ids),
                trips=count,
                weighted_trips=weighted,
                road_class=_detour_class(world, ids),
                pressure=traffic.pressure(weighted, _detour_class(world, ids)),
            )
            for name, (ids, count, weighted) in roads.items()
        ],
        key=lambda r: (-r.weighted_trips, r.name, r.road_class),
    )
    summary = _summary(trips)
    warnings = [
        "Sample trips are a deterministic bounded sample of everyday journeys, "
        "not measured demand.",
        "Closures are assessed only at at (default: first closure start); changes later in "
        "the window are not modelled.",
        "Extra minutes are travel-distance/pace estimates, not congestion or crowd predictions.",
    ]
    if summary.trips_on_course:
        warnings.append(
            f"{summary.trips_on_course} sample trips start or end on the course: access during "
            "the event needs a separate plan; excluded from detour and new route-loss counts."
        )
    for profile in profiles:
        sample = [t for t in trips if t.profile == profile]
        if sample and any(
            max(Counter(getattr(t, field) for t in sample).values()) * 10 > len(sample)
            for field in ("from_id", "to_id")
        ):
            warnings.append(
                f"{profile}: the available mapped endpoints cannot meet the 10% sample "
                "diversity target; this small sample is not representative."
            )
    if demo:
        warnings.append("Some routes use demo values, not yet surveyed.")
    warnings.extend(
        world.profiles[p].standing_warning for p in profiles if world.profiles[p].standing_warning
    )
    digest = hashlib.sha256(
        (
            spec.model_dump_json()
            + at.isoformat()
            + closure_hash
            + str(world.version)
            + str(profiles)
        ).encode()
    ).hexdigest()[:12]
    common = dict(
        **summary.model_dump(),
        per_profile={p: _summary([t for t in trips if t.profile == p]) for p in profiles},
        places_cut_off=sorted(cut_off.values(), key=lambda p: p.id),
        detour_roads=detours,
        suggestions=_suggestions(after, detours, cut_off, summary, closed),
        trips=trips,
        sample_limit_per_profile=limit,
        evidence_id=f"ev-event-{digest}" if legacy else f"ev-closure-{digest}",
        weights_note=traffic.config().weights_note,
        timing_ms=round((perf_counter() - started) * 1000, 2),
        warnings=list(dict.fromkeys(warnings)),
    )
    if legacy:
        return EventImpact(event=legacy, **common)
    return ClosureImpact(event=spec, at=at, **common)


def _detour_class(world, ids):
    """A mixed-class named road uses its most restrictive sampled segment capacity."""
    classes = {world.edges[eid].osm_tags.get("highway", "unknown") for eid in ids}
    capacity = traffic.config().capacity
    return min(classes, key=lambda cls: (capacity.get(cls, capacity["others"]), cls))
