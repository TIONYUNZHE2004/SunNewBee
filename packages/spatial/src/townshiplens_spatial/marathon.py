"""Bounded deterministic course proposals, followed by the normal closure engine.

This is a road-closure planning aid, not a running-access or event-approval assessment.
Candidate selection does not change any routing/profile evaluation rules.
"""

from __future__ import annotations

import threading
from collections import Counter, OrderedDict, deque
from datetime import UTC, datetime
from functools import cache
from math import atan2, isfinite
from typing import Literal

import networkx as nx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import closure_roads, events, flood, place_search
from .direction import allows_direction
from .models import active_closures
from .routing import CENTRE_PREFIX, _evaluate, _targets, route_batch
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
    if not matches:
        raise ValueError(
            f"No mapped place matches {query!r}. Choose a mapped place id or full name."
        )
    if len(matches) != 1:
        raise ValueError(f"Ambiguous mapped place {query!r}. Choose a specific mapped place id.")
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
        if (
            edge.name in avoided
            or edge.type == "steps"
            or (edge.closures and active_closures(edge.closures))
        ):
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


def _ranking_context(world, profile_id="default"):
    """Use the existing default profile weights; preserve direction and parallel edges."""
    prof = world.profiles[profile_id]
    reverse = {}
    for a, b, eid in world.graph.edges(keys=True):
        if _evaluate(world, prof, None, eid)[0] == "FAIL":
            continue
        if allows_direction(world.edges[eid], prof.id, a):
            reverse.setdefault(b, []).append((a, eid))
        if allows_direction(world.edges[eid], prof.id, b):
            reverse.setdefault(a, []).append((b, eid))
    centres = {
        n
        for c in world.centres.values()
        if flood.centre_closure(world, c) is None
        for n in _targets(world, f"{CENTRE_PREFIX}{c.id}", prof)
    }
    places = {
        p.id: set(_targets(world, p.id, prof))
        for p in world.places.values()
        if events.resident_destination(world, p.id)
    }
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


def _road_revisits(world, ids, loop):
    names = []
    for eid in ids:
        name = world.edges[eid].name
        if not names or names[-1] != name:
            names.append(name)
    if loop and len(names) > 1 and names[0] == names[-1]:
        names.pop()  # One road split by the start line is a continuous visit.
    return sum(n - 1 for name, n in Counter(names).items() if name is not None)


def _candidates(world, graph, from_start, to_finish, root, goal, target, preferred):
    candidates = {}

    def add(nodes):
        ids = _ids(graph, nodes)
        if not ids or len(ids) > events.MAX_COURSE_SEGMENTS:
            return
        length = sum(world.edges[e].length_m for e in ids)
        if length <= 0:
            return
        counts = Counter(ids)
        repeated = sum(world.edges[e].length_m * (n - 1) for e, n in counts.items())
        unnamed = sum(world.edges[e].length_m for e in ids if not world.edges[e].name)
        preferred_m = sum(world.edges[e].length_m for e in ids if world.edges[e].name in preferred)
        candidates[ids] = (length, repeated, unnamed, -preferred_m)

    def physical_lengths(paths):
        result = {}
        for node, path in sorted(paths.items(), key=lambda item: len(item[1])):
            result[node] = (
                0
                if len(path) == 1
                else result[path[-2]] + world.edges[graph[path[-2]][node]["eid"]].length_m
            )
        return result

    lengths = physical_lengths(from_start)
    remaining = lengths if root == goal else physical_lengths(to_finish)
    if root != goal:
        add(from_start[goal])
    candidates_nodes = [
        n
        for n in from_start
        if n in to_finish and n not in (root, goal) and 0 < lengths[n] < target * 0.95
    ]
    # Several radii avoid sampling only far dead ends or only one return-road layout.
    origin = world.node_coords[root]

    def sector(node):
        coord = world.node_coords[node]
        return (
            int(
                (atan2(coord[1] - origin[1], coord[0] - origin[0]) + 3.141592653589793)
                * 4
                / 3.141592653589793
            )
            % 8
        )

    points = []
    for fraction in (0.2, 0.35, 0.5):
        buckets = set()
        for node in sorted(
            candidates_nodes, key=lambda n: (abs(lengths[n] - target * fraction), n)
        ):
            direction = sector(node)
            if direction not in buckets and node not in points:
                buckets.add(direction)
                points.append(node)
    candidates_nodes.sort(key=lambda n: (abs(lengths[n] + remaining[n] - target), n))
    # Include preferred-road anchors even if their sector already supplied three points.
    for node in candidates_nodes:
        if len(points) >= 32:
            break
        if node not in points and any(
            world.edges[d["eid"]].name in preferred for d in graph[node].values()
        ):
            points.append(node)
    returns = []
    for node in points:
        outbound = from_start[node]
        if goal in outbound[:-1] and goal != root:
            continue
        used = set(_ids(graph, outbound))
        view = nx.subgraph_view(
            graph,
            filter_edge=lambda a, b, used=used: graph[a][b]["eid"] not in used,
        )
        try:
            # One shortest return per spatial anchor bounds work. Enumerating a
            # second simple path runs many spur searches for near-identical loops.
            back = nx.shortest_path(view, node, goal, weight="weight")
            add(outbound + back[1:])
            returns.append((node, outbound, view))
        except nx.NetworkXNoPath:
            pass
    if not any(target * 0.9 <= v[0] <= target * 1.1 and not v[1] for v in candidates.values()):
        # A second return is needed on small maps with a shortcut (e.g. a square
        # with a diagonal). Pay for spur enumeration only if first returns miss.
        for node, outbound, view in returns:
            paths = nx.shortest_simple_paths(view, node, goal, weight="weight")
            next(paths, None)
            back = next(paths, None)
            if back is not None:
                add(outbound + back[1:])
    # Retain bounded repeated-path fallbacks for maps without a suitable simple loop.
    alternatives = []
    for a, b, data in graph.edges(data=True):
        if a not in lengths or b not in remaining:
            continue
        for u, v in ((a, b), (b, a)):
            estimate = lengths[u] + world.edges[data["eid"]].length_m + remaining[v]
            alternatives.append((abs(estimate - target), u, v))
    for _, u, v in sorted(alternatives)[:96]:
        add(from_start[u] + list(reversed(to_finish[v])))
    if root == goal and not any(
        target * 0.9 <= value[0] <= target * 1.1 for value in candidates.values()
    ):
        # An explicit multi-lap proposal is preferable to silently missing a long
        # requested distance on a small mapped field. Every repeated metre is retained.
        for ids, (length, _, unnamed, pref) in list(candidates.items()):
            laps = round(target / length)
            for count in (laps - 1, laps, laps + 1):
                if count < 2 or len(ids) * count > events.MAX_COURSE_SEGMENTS:
                    continue
                actual = length * count
                if target * 0.9 <= actual <= target * 1.1:
                    unique = sum(world.edges[e].length_m for e in set(ids))
                    candidates[ids * count] = (
                        actual,
                        actual - unique,
                        unnamed * count,
                        pref * count,
                    )
    return candidates


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
    candidates = _candidates(world, graph, from_start, to_finish, root, goal, target, preferred)
    if root == goal and not any(target * 0.9 <= v[0] <= target * 1.1 for v in candidates.values()):
        for laps in range(2, 7):
            smaller = _candidates(
                world, graph, from_start, to_finish, root, goal, target / laps, preferred
            )
            for ids, (length, _, unnamed, pref) in smaller.items():
                actual = length * laps
                if (
                    len(ids) * laps <= events.MAX_COURSE_SEGMENTS
                    and target * 0.9 <= actual <= target * 1.1
                ):
                    unique = sum(world.edges[e].length_m for e in set(ids))
                    candidates[ids * laps] = actual, actual - unique, unnamed * laps, pref * laps
            if any(target * 0.9 <= v[0] <= target * 1.1 for v in candidates.values()):
                break
    if not candidates:
        raise ValueError("No course fits the 400-segment bound on these mapped connections.")

    @cache
    def preliminary(ids):
        length, repeats, unnamed, pref = candidates[ids]
        return (
            abs(length - target) > target * 0.1,
            bool(repeats),
            _road_revisits(world, ids, root == goal),
            pref,
            unnamed / length,
            abs(length - target),
            ids,
        )

    within = [ids for ids in candidates if abs(candidates[ids][0] - target) <= target * 0.1]
    pool = within or list(candidates)
    if not within:
        nearest_error = min(abs(candidates[ids][0] - target) for ids in pool)
        pool = [ids for ids in pool if abs(candidates[ids][0] - target) <= nearest_error + 0.01]
    # A repeat-free proposal wins over reusing a road merely to lower the cutoff score.
    best_repeat = min(preliminary(ids)[1] for ids in pool)
    pool = sorted((ids for ids in pool if preliminary(ids)[1] == best_repeat), key=preliminary)[:24]
    with route_batch():
        contexts = []
        for profile in events.DEFAULT_PROFILES:
            if profile not in world.profiles or world.profiles[profile].stub:
                continue
            arcs, centres, places = _ranking_context(world, profile)
            before = _connected(arcs, centres, set())
            baseline_places = {pid for pid, nodes in places.items() if nodes & before}
            contexts.append((arcs, centres, places, baseline_places))

        def rank(ids):
            lost = set()
            for arcs, centres, places, baseline_places in contexts:
                connected = _connected(arcs, centres, set(ids))
                lost.update(pid for pid in baseline_places if not places[pid] & connected)
            return (candidates[ids][3], len(lost), *preliminary(ids))

        chosen = min(pool, key=rank)
    length, repeats, unnamed, _ = candidates[chosen]
    warnings = [
        "Bounded proposal search: compares up to 24 candidates for newly lost mapped centre "
        "access (default, wheelchair and driving profiles); not a global optimum.",
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
            "The bounded search found no repeat-free candidate in the distance band; "
            "some segments repeat. Review the repeated stretches."
        )
    if repeats and root == goal:
        for laps in range(len(chosen), 1, -1):
            if len(chosen) % laps == 0 and chosen == chosen[: len(chosen) // laps] * laps:
                warnings.append(
                    f"Multi-lap proposal: {laps} repeats of the same mapped loop. "
                    "No single-loop candidate in the distance band was found."
                )
                break
    roads = []
    unnamed_labels = events._unnamed_stretches(world)
    for eid in chosen:
        edge = world.edges[eid]
        name = edge.name or unnamed_labels[eid]
        if roads and roads[-1].name == name:
            roads[-1].length_m += edge.length_m
        else:
            roads.append(CourseRoad(name=name, length_m=edge.length_m, order=len(roads) + 1))
    if _road_revisits(world, chosen, root == goal):
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
    with route_batch():
        return _simulate_marathon(world, request)


def _simulate_marathon(world, request):
    baseline, digest = events._frozen_baseline(world, request.starts_at)
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
        frozen_baseline=(baseline, digest),
    )
    return MarathonResult(
        course=course,
        impact=MarathonImpact.model_validate(impact.model_dump()),
        animation=_animation(baseline, course, impact, frozen_baseline=(baseline, digest)),
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


def _animation(world, course, impact, frozen_baseline=None):
    baseline, digest = frozen_baseline or events._frozen_baseline(world, impact.at)
    examples = []
    with route_batch():
        for profile in impact.per_profile:
            journeys = events._journeys(baseline, profile, impact.sample_limit_per_profile, True)
            states = events._baseline(baseline, digest, profile, journeys)
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
