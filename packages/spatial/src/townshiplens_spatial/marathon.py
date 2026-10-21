"""Bounded deterministic course proposals, followed by the normal closure engine.

This is a road-closure planning aid, not a running-access or event-approval assessment.
Candidate selection does not change any routing/profile evaluation rules.
"""

from __future__ import annotations

import threading
from collections import Counter, OrderedDict, deque
from datetime import UTC, datetime
from math import isfinite
from typing import Literal

import networkx as nx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import closure_roads, events, flood, place_search
from .models import active_closures
from .routing import CENTRE_PREFIX, _targets, make_weight, route_batch
from .world import World

PROPOSAL = "Proposed course on mapped roads, not an approved route."
_COURSES: OrderedDict = OrderedDict()
_COURSE_LOCK = threading.Lock()


class CourseRoad(BaseModel):
    name: str
    length_m: float
    order: int


class Course(BaseModel):
    segment_ids: list[str]
    length_m: float
    roads: list[CourseRoad]
    start: str
    finish: str
    start_node: str
    finish_node: str
    shape: Literal["loop", "point_to_point"]
    warnings: list[str]
    disclaimer: str = PROPOSAL


class MarathonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: str = Field(min_length=1, max_length=200)
    distance_km: float = Field(gt=0, le=50, allow_inf_nan=False)
    shape: Literal["loop", "point_to_point"] = "loop"
    finish: str | None = Field(default=None, min_length=1, max_length=200)
    avoid_roads: list[str] = Field(default_factory=list, max_length=40)
    prefer_roads: list[str] = Field(default_factory=list, max_length=40)
    starts_at: datetime
    ends_at: datetime
    profiles: list[str] = Field(
        default_factory=lambda: list(events.DEFAULT_PROFILES), min_length=1, max_length=5
    )

    _utc = field_validator("starts_at", "ends_at")(events.EventSpec._utc.__func__)

    @model_validator(mode="after")
    def _window(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class MarathonImpact(events.ClosureImpact):
    event: events.CourseScenario


class AnimatedTrip(BaseModel):
    from_id: str
    to_id: str
    profile: str
    before_coordinates: list[list[float]]
    after_coordinates: list[list[float]]


class MarathonAnimation(BaseModel):
    label: str = "Simulation · illustrative"
    course_coordinates: list[list[float]]
    rerouted_trips: list[AnimatedTrip] = Field(default_factory=list, max_length=5)


class MarathonResult(BaseModel):
    course: Course
    impact: MarathonImpact
    animation: MarathonAnimation


def _place(world, query):
    if query in world.places:
        return world.places[query]
    matches = [
        p
        for p in world.places.values()
        if place_search.match(query, [p.name, *p.aliases]) == place_search.EXACT
    ]
    if len(matches) != 1:
        raise ValueError(f"Use a mapped place id or an unambiguous full place name for {query!r}.")
    return matches[0]


def _graph(world, avoid, prefer):
    names = {}
    for e in world.edges.values():
        if e.name:
            names.setdefault(e.name, []).append(e.id)
    avoided = {closure_roads._name(names, q) for q in avoid}
    preferred = {closure_roads._name(names, q) for q in prefer}
    if avoided & preferred:
        raise ValueError("A road cannot be both avoided and preferred.")
    graph = nx.Graph()
    for edge in sorted(world.edges.values(), key=lambda e: e.id):
        if edge.name in avoided or edge.type == "steps" or active_closures(edge.closures):
            continue
        if edge.type == "major_road" and edge.name not in preferred:
            continue
        cost = edge.length_m * (0.65 if edge.name in preferred else 1 if edge.name else 1.6)
        a, b = edge.from_node, edge.to_node
        if not graph.has_edge(a, b) or (cost, edge.id) < (
            graph[a][b]["weight"],
            graph[a][b]["eid"],
        ):
            graph.add_edge(a, b, eid=edge.id, weight=cost)
    return graph, preferred


def _ids(graph, nodes):
    return tuple(graph[a][b]["eid"] for a, b in zip(nodes, nodes[1:], strict=False))


def _ranking_context(world):
    """Use the existing default profile weights; preserve direction and parallel edges."""
    prof = world.profiles["default"]
    weight = make_weight(world, prof, None, True)
    reverse = {}
    for a, b, eid in world.graph.edges(keys=True):
        data = {eid: world.graph[a][b][eid]}
        if weight(a, b, data) is not None:
            reverse.setdefault(b, []).append((a, eid))
        if weight(b, a, data) is not None:
            reverse.setdefault(a, []).append((b, eid))
    centres = {
        n
        for c in world.centres.values()
        if flood.centre_closure(world, c) is None
        for n in _targets(world, f"{CENTRE_PREFIX}{c.id}", prof)
    }
    places = {p.id: set(_targets(world, p.id, prof)) for p in world.places.values()}
    return reverse, centres, places


def _connected(reverse, centres, closed):
    reached = set(centres)
    queue = deque(sorted(centres))
    while queue:
        for node, eid in reverse.get(queue.popleft(), ()):
            if eid not in closed and node not in reached:
                reached.add(node)
                queue.append(node)
    return reached


def plan_course(
    world: World,
    start: str,
    distance_km: float,
    shape: Literal["loop", "point_to_point"] = "loop",
    finish: str | None = None,
    avoid_roads: list[str] | None = None,
    prefer_roads: list[str] | None = None,
) -> Course:
    # Snapshots retain the static graph; version/date/active closure set invalidate
    # proposals. Values retain that graph so ids cannot be reused after world reload.
    closed = tuple(
        sorted((e.id, c.id) for e in world.edges.values() for c in active_closures(e.closures))
    )
    key = (
        id(world.graph),
        world.version,
        datetime.now(UTC).date(),
        closed,
        start,
        distance_km,
        shape,
        finish,
        tuple(avoid_roads or []),
        tuple(prefer_roads or []),
    )
    with _COURSE_LOCK:
        if key in _COURSES:
            _COURSES.move_to_end(key)
            return _COURSES[key][1].model_copy(deep=True)
    result = _plan_course(world, start, distance_km, shape, finish, avoid_roads, prefer_roads)
    with _COURSE_LOCK:
        _COURSES[key] = world.graph, result.model_copy(deep=True)
        while len(_COURSES) > 12:
            _COURSES.popitem(last=False)
    return result


def _plan_course(world, start, distance_km, shape, finish, avoid_roads, prefer_roads):
    if not isfinite(distance_km) or not 0 < distance_km <= 50:
        raise ValueError("distance_km must be greater than zero and at most 50")
    if shape not in ("loop", "point_to_point"):
        raise ValueError("shape must be loop or point_to_point")
    if shape == "point_to_point" and not finish:
        raise ValueError("point_to_point needs a mapped finish place")
    if (
        shape == "loop"
        and finish is not None
        and _place(world, finish).id != _place(world, start).id
    ):
        raise ValueError("A loop must finish at its start; use point_to_point for another finish.")
    origin = _place(world, start)
    destination = _place(world, finish) if shape == "point_to_point" else origin
    graph, preferred = _graph(world, avoid_roads or [], prefer_roads or [])
    starts = sorted(n for n in _targets(world, origin.id) if n in graph)
    finishes = sorted(n for n in _targets(world, destination.id) if n in graph)
    if not starts or not finishes:
        raise ValueError(
            "No mapped course connection at the start or finish after the road exclusions. "
            "Entrance data may be missing."
        )
    root = starts[0]
    _, from_start = nx.single_source_dijkstra(graph, root)
    goals = [n for n in finishes if n in from_start]
    if not goals:
        raise ValueError(
            "No mapped connection between start and finish (data gap or excluded roads)."
        )
    goal = (
        root
        if shape == "loop"
        else min(
            goals,
            key=lambda n: (sum(world.edges[e].length_m for e in _ids(graph, from_start[n])), n),
        )
    )
    to_finish = from_start if goal == root else nx.single_source_dijkstra(graph, goal)[1]
    target = distance_km * 1000
    candidates = {}

    def add(nodes):
        ids = _ids(graph, nodes)
        if not ids or len(ids) > events.MAX_COURSE_SEGMENTS:
            return
        length = sum(world.edges[e].length_m for e in ids)
        if length <= 0:
            return
        # Do not call an out-and-back a loop when a simple cycle is available.
        repeated = len(ids) - len(set(ids))
        unnamed = sum(world.edges[e].length_m for e in ids if not world.edges[e].name)
        pref = sum(world.edges[e].length_m for e in ids if world.edges[e].name in preferred)
        candidates[ids] = (length, repeated, unnamed, -pref)

    if goal != root:
        add(from_start[goal])
    for a, b in sorted(graph.edges):
        if a not in from_start or b not in to_finish:
            continue
        for u, v in ((a, b), (b, a)):
            nodes = from_start[u] + list(reversed(to_finish[v]))
            add(nodes)
    if not candidates:
        raise ValueError("No course fits the 400-segment bound on these mapped connections.")

    # A bounded heuristic, not a claim of a globally optimal event layout. Compare
    # the best 24 distance/repetition/name candidates using mapped centre access.
    def preliminary(ids):
        length, repeats, unnamed, pref = candidates[ids]
        return (
            abs(length - target) > target * 0.1,
            repeats,
            unnamed / length,
            pref,
            abs(length - target),
            ids,
        )

    within = [ids for ids in candidates if abs(candidates[ids][0] - target) <= target * 0.1]
    pool = sorted(within or candidates, key=preliminary)[:24]
    with route_batch():
        arcs, centres, places = _ranking_context(world)
        before = _connected(arcs, centres, set())
        baseline_places = {pid for pid, nodes in places.items() if nodes & before}

        def rank(ids):
            connected = _connected(arcs, centres, set(ids))
            lost = sum(not places[pid] & connected for pid in baseline_places)
            return (lost, *preliminary(ids))

        chosen = min(pool, key=rank)
    length, repeats, unnamed, _ = candidates[chosen]
    warnings = [
        "Bounded proposal search: compares up to 24 candidates for newly lost mapped centre "
        "access (default profile); not a global optimum.",
        "Course access, road direction, crossings and event approval need review; "
        "this proposal is not a profile access assessment.",
    ]
    if abs(length - target) > target * 0.1:
        warnings.append(
            f"Requested {target:g} m; proposed {length:.1f} m. No candidate within ±10% "
            "was found on the mapped connections after road exclusions and the "
            "400-segment bound."
        )
    if repeats:
        warnings.append(
            "Some segments repeat to connect the start/finish to the available course; "
            "review the repeated stretches."
        )
    roads = []
    unnamed_labels = events._unnamed_stretches(world)
    for eid in chosen:
        edge = world.edges[eid]
        name = edge.name or unnamed_labels[eid]
        if roads and roads[-1].name == name:
            roads[-1].length_m += edge.length_m
        else:
            roads.append(CourseRoad(name=name, length_m=edge.length_m, order=len(roads) + 1))
    if any(count > 1 for count in Counter(r.name for r in roads).values()):
        warnings.append(
            "Some roads are revisited to meet the mapped start/finish and distance constraints."
        )
    for road in roads:
        road.length_m = round(road.length_m, 1)
    if any(world.edges[eid].type == "major_road" for eid in chosen):
        warnings.append(
            "Includes an explicitly preferred major road; event use and crossings are not approved."
        )
    if preferred - {r.name for r in roads}:
        warnings.append(
            "Some preferred roads could not be included in the bounded distance proposal."
        )
    return Course(
        segment_ids=list(chosen),
        length_m=round(length, 1),
        roads=roads,
        start=origin.id,
        finish=destination.id,
        start_node=root,
        finish_node=goal,
        shape=shape,
        warnings=warnings,
    )


def simulate_marathon(world: World, request: MarathonRequest) -> MarathonResult:
    baseline, _ = events._frozen_baseline(world, request.starts_at)
    course = plan_course(
        baseline, **request.model_dump(exclude={"starts_at", "ends_at", "profiles"})
    )
    spec = events.CourseScenario(
        name="Proposed marathon",
        reason="event",
        closures=[
            events.CourseWindow(
                segment_ids=list(dict.fromkeys(course.segment_ids)),
                starts_at=request.starts_at,
                ends_at=request.ends_at,
            )
        ],
    )
    impact = events._simulate(
        baseline,
        spec,
        tuple(request.profiles),
        request.starts_at,
        legacy=None,
        max_segments=events.MAX_COURSE_SEGMENTS,
    )
    return MarathonResult(
        course=course,
        impact=MarathonImpact.model_validate(impact.model_dump()),
        animation=_animation(baseline, course, impact),
    )


def _coordinates(world, ids, node):
    coordinates = []
    for eid in ids:
        edge = world.edges[eid]
        if node == edge.from_node:
            points, node = edge.coords, edge.to_node
        elif node == edge.to_node:
            points, node = list(reversed(edge.coords)), edge.from_node
        else:
            return []  # Never draw a fabricated connector across a mapping gap.
        coordinates.extend(points if not coordinates else points[1:])
    return coordinates


def _trip_coordinates(world, ids, place_id, profile):
    if not ids:
        return []
    edge = world.edges[ids[0]]
    targets = _targets(world, place_id, world.profiles[profile])
    for node in (edge.from_node, edge.to_node):
        if node in targets and (line := _coordinates(world, ids, node)):
            return line
    return []


def _animation(world, course, impact):
    baseline, digest = events._frozen_baseline(world, impact.at)
    examples = []
    with route_batch():
        for profile in impact.per_profile:
            journeys = events._journeys(baseline, profile, impact.sample_limit_per_profile, True)
            states, _ = events._baseline(baseline, digest, profile, journeys)
            before = {
                (j.from_id, j.to_id): state for j, state in zip(journeys, states, strict=True)
            }
            for trip in impact.trips:
                if trip.profile != profile or not trip.affected or trip.extra_m is None:
                    continue
                old = before[(trip.from_id, trip.to_id)]
                a = _trip_coordinates(baseline, old.segment_ids, trip.from_id, profile)
                b = _trip_coordinates(baseline, trip.segment_ids, trip.from_id, profile)
                if a and b:
                    examples.append(
                        AnimatedTrip(
                            from_id=trip.from_id,
                            to_id=trip.to_id,
                            profile=profile,
                            before_coordinates=a,
                            after_coordinates=b,
                        )
                    )
                if len(examples) == 5:
                    break
            if len(examples) == 5:
                break
    return MarathonAnimation(
        course_coordinates=_coordinates(world, course.segment_ids, course.start_node),
        rerouted_trips=examples,
    )
