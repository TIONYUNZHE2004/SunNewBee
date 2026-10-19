import contextlib
import contextvars
import hashlib
import heapq
import itertools
import math
from datetime import date
from typing import Any

import networkx as nx

from .access import LEVELS, assess_access, urban_context
from .direction import CONDITIONAL_KEYS, allows_direction, direction_rule, direction_unknown
from .evaluate import SIDEWALK_PRESENT, _is_stale, evaluate_edge, evaluate_flood, rest_point_state
from .geo import haversine_m
from .maneuvers import build_maneuvers
from .models import Evidence, RoadSection, Route, RouteResult, RouteSegment, photo_url
from .scenario_meta import scenario_source, selection_error
from .world import World

CENTRE_PREFIX = "__centre__"
UNKNOWN_WEIGHT = 5.0
WALK_M_PER_MIN = 70.0
PLACEHOLDER_SOURCE = "team_survey_placeholder"  # demo values (see Route.demo_evidence)
# Place types that can be a rest point (OSM benches import as `seating`); whether one counts
# is tri-state from its own claims (evaluate.rest_point_state).
REST_TYPES = frozenset({"seating", "shelter"})
# Deterministic bound on the rest-constrained search (labels created, not wall-clock time).
MAX_REST_LABELS = 200_000
ROAD_TYPES = frozenset({"street", "major_road"})
# A preference within each strict/lenient search, never a change to passability or distance.
WALK_ROAD_MULTIPLIER = 1.25


def _pace_m_per_min(profile) -> float:
    return profile.speed_kmh * 1000 / 60 if profile.speed_kmh else WALK_M_PER_MIN


def _caveat(profile, status):
    """A profile with a standing warning (drive) can never be 'confirmed'."""
    return "partly_unverified" if profile.standing_warning and status == "confirmed" else status


SNAP_CAP_M = 150.0


def _target_pts(world: World, place_id: str) -> list[tuple[str, list[float]]]:
    """(graph node, coordinate) for each mapped way into a place or transient centre target."""
    p = world.places.get(place_id)
    if p is None and place_id.startswith(CENTRE_PREFIX):
        # Transient evacuation-centre target: resolved from world.centres, never stored in places.
        c = world.centres.get(place_id[len(CENTRE_PREFIX) :])
        return [(c.node_id, c.coord)] if c and c.node_id and c.node_id in world.graph else []
    if p is None:
        return []
    ents = [
        (world.places[e].node_id, world.places[e].coord)
        for e in p.entrance_ids
        if e in world.places and world.places[e].node_id
    ]
    return ents or ([(p.node_id, p.coord)] if p.node_id and p.node_id in world.graph else [])


def _road_nodes(world: World, profile) -> set[str]:
    allowed = set(profile.allowed_types or [])
    return {n for e in world.edges.values() if e.type in allowed for n in (e.from_node, e.to_node)}


def _snap_to_road(world: World, roads: set[str], node: str, coord) -> str | None:
    """Own node if it touches a road, else the nearest road node within SNAP_CAP_M (ties by id)."""
    if node in roads:
        return node
    best: tuple[float, str] | None = None
    for n in sorted(roads):
        xy = world.node_coords.get(n)
        if xy is None:
            continue
        d = haversine_m(coord, xy)
        if d <= SNAP_CAP_M and (best is None or d < best[0]):
            best = (d, n)
    return best[1] if best else None


def _components(world: World) -> dict[str, int]:
    """Component id per node of the unfiltered mapped graph (no profile rules, no flood).

    Cached on the graph. The key (node count, edge count) is sound only because the graph is
    built once from `world.edges` in `load_world` and never mutated afterwards (claims, closures,
    profiles, scenarios and `world.version` cannot change topology: a closure or FAIL gives
    `blocked`, never `no_data`). An edge swap that keeps both counts would go unnoticed."""
    g = world.graph
    # O(1): number_of_edges() walks every adjacency (~20 ms on the seed) and runs per centre
    key = (g.number_of_nodes(), len(world.edges))
    cached = g.graph.get("_components")
    if cached is None or cached[0] != key:
        comps = {n: i for i, c in enumerate(nx.connected_components(g)) for n in c}
        g.graph["_components"] = cached = (key, comps)
    return cached[1]


def _disconnected(world: World, profile, sources, targets) -> bool:
    """True when the mapped data has no path at all between the endpoints (for a vehicle
    profile: no road path). That is a data gap (no_data), never a known barrier (blocked)."""
    comps = _components(world)
    if not {comps.get(s) for s in sources} & {comps.get(t) for t in targets}:
        return True
    return profile.allowed_types is not None and _road_disconnected(
        _road_components(world, profile), sources, targets
    )


def _road_components(world: World, profile) -> dict[str, int]:
    """Component id per node of the static road graph (allowed edge types only, no flood)."""
    g = nx.Graph()
    allowed = set(profile.allowed_types or [])
    g.add_edges_from((e.from_node, e.to_node) for e in world.edges.values() if e.type in allowed)
    return {n: i for i, comp in enumerate(nx.connected_components(g)) for n in comp}


def _road_disconnected(comps: dict[str, int], sources, targets) -> bool:
    """True when no source shares a mapped-road component with any target."""
    return not {comps.get(s) for s in sources} & {comps.get(t) for t in targets}


def _targets(world: World, place_id: str, profile=None) -> list[str]:
    pts = _target_pts(world, place_id)
    if profile is None or profile.allowed_types is None:
        return [n for n, _ in pts]
    roads = _road_nodes(world, profile)
    snapped = (_snap_to_road(world, roads, n, xy) for n, xy in pts)
    return sorted({n for n in snapped if n})


def _snap_warning(world: World, place_id: str, profile) -> str | None:
    """Vehicle profiles route from the nearest mapped road node, so distance and time leave out
    the stretch between the place and that node (up to SNAP_CAP_M). Say so (Task 26 Minor 1)."""
    roads = _road_nodes(world, profile)
    best: float | None = None
    for node, xy in _target_pts(world, place_id):
        if node in roads:
            return None  # a mapped way in is on a road: nothing left out
        snapped = _snap_to_road(world, roads, node, xy)
        if snapped is not None and snapped in world.node_coords:
            d = haversine_m(xy, world.node_coords[snapped])
            best = d if best is None else min(best, d)
    if best is None:
        return None
    name = world.places[place_id].name if place_id in world.places else place_id
    return (
        f"{name} is about {max(10, round(best, -1)):.0f} m from the nearest mapped road; "
        "distance and time stop at the road"
    )


def _no_road_warning(world: World, place_id: str, profile) -> str | None:
    """Set when a vehicle profile could not snap a mapped place/centre to a road."""
    if (
        profile.allowed_types is not None
        and _target_pts(world, place_id)
        and not _targets(world, place_id, profile)
    ):
        name = place_id.removeprefix(CENTRE_PREFIX)
        return f"no mapped road within {SNAP_CAP_M:.0f} m of {name}"
    return None


def _flood_class(world: World, scenario_id: str | None, edge_id: str):
    return world.flood.edge_classes.get(scenario_id or "", {}).get(edge_id) if scenario_id else None


def endpoint_id(world: World, place_id: str) -> str:
    """Resolve a transient centre target to the place assessed by the flood builder."""
    if place_id.startswith(CENTRE_PREFIX):
        c = world.centres.get(place_id[len(CENTRE_PREFIX) :])
        if c is not None:
            return c.place_id or c.id
    return place_id


def endpoint_flood(world: World, place_id: str, profile, scenario_id: str | None):
    eid = endpoint_id(world, place_id)
    return evaluate_flood(
        eid,
        profile,
        world.flood.place_classes.get(scenario_id or "", {}).get(eid),
        world.flood.coverage_for(scenario_id, eid),
    )


def endpoint_flood_warnings(world: World, place_id: str, profile, scenario_id: str | None):
    """Name the assessed endpoint, including when its flood FAIL leaves no route geometry."""
    eid = endpoint_id(world, place_id)
    place = world.places.get(eid)
    centre = world.centres.get(place_id.removeprefix(CENTRE_PREFIX))
    name = place.name if place else centre.name if centre else eid
    _, reasons = endpoint_flood(world, place_id, profile, scenario_id)
    return [f"{name}: {reason['why']}" for reason in reasons]


def origin_flood(world: World, place_id: str, profile, scenario_id: str | None):
    """Origin flood classes are caveats: evacuation starts where the resident is.

    Explicitly unassessed raster coverage still prevents a confirmed scenario result.
    """
    eid = endpoint_id(world, place_id)
    return evaluate_flood(eid, profile, None, world.flood.coverage_for(scenario_id, eid))


def flood_evidence(world: World, element_id: str, scenario_id: str | None) -> list[Evidence]:
    """Keep coverage evidence distinct from a modelled flood class."""
    if scenario_id is None:
        return []
    eid = endpoint_id(world, element_id)
    cls = world.flood.edge_classes.get(scenario_id, {}).get(eid)
    cls = cls or world.flood.place_classes.get(scenario_id, {}).get(eid)
    out = []
    if cls:
        out.append(
            Evidence(
                id=f"ev-scn-{scenario_id}.{eid}",
                element_id=eid,
                attribute="flood",
                value=cls,
                status="indicative",
                source_type=scenario_source(world, scenario_id),
            )
        )
    if coverage := world.flood.coverage_for(scenario_id, eid):
        out.append(
            Evidence(
                id=f"ev-scn-{scenario_id}.{eid}.coverage",
                element_id=eid,
                attribute="flood_coverage",
                value=coverage,
                status="unknown",
                source_type="flood raster coverage",
            )
        )
    return out


# Batch memo of edge evaluations (twm rollouts route hundreds of journeys over one state).
# Keyed by the Edge object itself: an imagined world (twm.apply) copies only the edges its
# actions touch, so every untouched edge is the same object in the real and the imagined world
# and its evaluation is shared, while a touched edge is a new object and is evaluated afresh.
# Only set inside `eval_memo()`; a single plan_route call is unchanged.
_EVAL_MEMO: contextvars.ContextVar[dict | None] = contextvars.ContextVar("eval_memo", default=None)


@contextlib.contextmanager
def eval_memo():
    """Within this block, each (edge object, profile, scenario) is evaluated once. Re-entrant:
    an inner block shares the outer memo (e.g. many what-ifs inside one fix-it search)."""
    if _EVAL_MEMO.get() is not None:
        yield
        return
    token = _EVAL_MEMO.set({})
    try:
        yield
    finally:
        _EVAL_MEMO.reset(token)


def _evaluate(world, profile, scenario_id, key):
    edge = world.edges[key]
    memo = _EVAL_MEMO.get()
    if memo is None:
        return evaluate_edge(
            edge,
            profile,
            _flood_class(world, scenario_id, key),
            flood_coverage=world.flood.coverage_for(scenario_id, key),
        )
    # The memo holds the edge, so its id() cannot be reused by another object meanwhile. The key
    # leaves out the world: imagined worlds (twm.apply) share the real world's flood classes
    # and profiles, and a scenario's flood class is part of the key through `scenario_id`.
    # Blocks are short (one batch): World.refresh_claim / set_closures mutate edges in place.
    k = (id(edge), profile.id, scenario_id)
    hit = memo.get(k)
    if hit is None:
        hit = memo[k] = (
            edge,
            evaluate_edge(
                edge,
                profile,
                _flood_class(world, scenario_id, key),
                flood_coverage=world.flood.coverage_for(scenario_id, key),
            ),
        )
    return hit[1]


def _edge_cost(world, profile, scenario_id, allow_unknown, key, evals=None) -> float | None:
    """Search cost of one edge for this profile, or None when the search must not use it."""
    e = world.edges[key]
    res, why = _evaluate(world, profile, scenario_id, key)
    if evals is not None:
        evals[key] = (res, why)
    assessment = _assessment(world, profile, scenario_id, key, (res, why))
    unknown = assessment.level == "unknown" and (res == "UNKNOWN" or bool(e.osm_tags))
    if res == "FAIL" or (unknown and not allow_unknown):
        return None
    w = e.length_m * (
        UNKNOWN_WEIGHT if unknown else 1.4 if assessment.level == "likely_ok" else 1.0
    )
    if e.type == "steps":
        w *= profile.soft.get("steps_multiplier", 1.0)
    if profile.allowed_types is None and e.type in ROAD_TYPES:
        w *= WALK_ROAD_MULTIPLIER
    return w


def _assessment(world, profile, scenario_id, key, factual=None):
    edge = world.edges[key]
    memo = _EVAL_MEMO.get()
    cache_key = ("access", id(edge), profile.id, scenario_id)
    if memo is not None and cache_key in memo:
        return memo[cache_key]
    value = assess_access(
        edge,
        profile,
        _flood_class(world, scenario_id, key),
        flood_coverage=world.flood.coverage_for(scenario_id, key),
        urban=urban_context(world, edge),
        factual=factual or _evaluate(world, profile, scenario_id, key),
    )
    if memo is not None:
        memo[cache_key] = value
    return value


def path_status(world, nodes, profile, scenario_id):
    """Status of a strict Dijkstra path, including estimates for non-materialised centres."""
    estimated = False
    keys = []
    for u, v in zip(nodes, nodes[1:], strict=False):
        candidates = [
            (cost, key)
            for key in world.graph[u][v]
            if allows_direction(world.edges[key], profile.id, u)
            if (cost := _edge_cost(world, profile, scenario_id, False, key)) is not None
        ]
        key = min(candidates)[1]
        keys.append(key)
        estimated |= _assessment(world, profile, scenario_id, key).level == "likely_ok"
    if profile.max_rest_free_run_m is not None:
        rests = {n for n in nodes if _rest_node_state(world, n) == "PASS"}
        if _max_rest_gap(world, nodes, keys, rests) > profile.max_rest_free_run_m:
            return "partly_unverified"
    return "likely_ok" if estimated else _caveat(profile, "confirmed")


def make_weight(world, profile, scenario_id, allow_unknown, evals=None, chosen=None):
    """Edge-cost function shared by route search and flood reachability (single rule set).

    `evals` / `chosen`, when given, record each edge evaluation and the edge key costed per node
    pair. Returns None for edges the profile cannot use (hidden from the search).
    """

    def weight(u, v, data):
        best = None
        for key in data:  # MultiGraph: data = {edge_id: attrs}
            if not allows_direction(world.edges[key], profile.id, u):
                if evals is not None:
                    evals[("direction", u, v, key)] = (
                        "FAIL",
                        [
                            {
                                "element_id": key,
                                "attribute": "oneway",
                                "why": "mapped one-way direction forbids this traversal",
                            }
                        ],
                    )
                continue
            w = _edge_cost(world, profile, scenario_id, allow_unknown, key, evals)
            if w is None:
                continue
            if best is None or w < best:
                best = w
                if chosen is not None:
                    chosen[(u, v)] = key
        return best

    return weight


def _search(world, sources, targets, profile, scenario_id, allow_unknown):
    """Cheapest path from any source to any target: Dijkstra straight over `world.graph`.

    Same result as `nx.dijkstra_path` between a temporary super-source and super-target (equal
    costs resolve by insertion order, the first source/target reached wins), without copying the
    whole graph for those two nodes on every call (about half of a seed route's time)."""
    evals: dict[str, tuple] = {}
    chosen: dict[tuple[str, str], str] = {}  # ordered node pair -> chosen edge key
    weight = make_weight(world, profile, scenario_id, allow_unknown, evals, chosen)
    g, goal = world.graph, set(targets)
    seen: dict[str, float] = {}
    done: set[str] = set()
    pred: dict[str, str] = {}
    tick = itertools.count()
    heap: list[tuple[float, int, str]] = []
    for s in dict.fromkeys(sources):
        seen[s] = 0.0
        heapq.heappush(heap, (0.0, next(tick), s))
    while heap:
        dist, _, v = heapq.heappop(heap)
        if v in done:
            continue
        done.add(v)
        if v in goal:
            nodes = [v]
            while nodes[-1] in pred:
                nodes.append(pred[nodes[-1]])
            nodes.reverse()
            keys = [chosen[(u, w)] for u, w in zip(nodes, nodes[1:], strict=False)]
            return nodes, keys, evals
        for u, data in g[v].items():
            cost = weight(v, u, data)
            if cost is None or u in done:
                continue
            if u not in seen or dist + cost < seen[u]:
                seen[u] = dist + cost
                pred[u] = v
                heapq.heappush(heap, (seen[u], next(tick), u))
    return None, [], evals


def _rest_places(world: World, node: str) -> list[tuple[str, object]]:
    """(state, place) for each rest place at a node that may count: PASS or UNKNOWN, never FAIL."""
    out = []
    for p in world.places_at(node):
        st = rest_point_state(p) if p.type in REST_TYPES else None
        if st in ("PASS", "UNKNOWN"):
            out.append((st, p))
    return out


def _rest_node_state(world: World, node: str) -> str | None:
    """PASS if a verified rest point is here, UNKNOWN if only unverified ones, else None."""
    states = {st for st, _ in _rest_places(world, node)}
    return "PASS" if "PASS" in states else "UNKNOWN" if states else None


def _rest_search(world, sources, targets, profile, scenario_id, allow_unknown, limit):
    """Cheapest path whose every stretch between rest points is <= `limit` metres.

    Label-setting search over (node, metres since the last rest point) with the same edge costs
    as `_search`. A label is pruned when another label at its node is no costlier and no further
    from a rest point; a step that would run past the limit is never taken. Arriving at a rest
    node resets the counter (same rule as `_max_rest_gap`): the strict pass counts verified rest
    points only, the lenient pass unverified ones too. Returns (nodes, keys, evals,
    truncated); `truncated` is True when MAX_REST_LABELS stopped the search before it finished.
    """
    evals: dict[str, tuple] = {}
    costs: dict[str, float | None] = {}
    rest: dict[str, bool] = {}
    goal = set(targets)
    labels: list[tuple[float, float, str, int, str | None]] = []  # cost, gap, node, parent, key
    alive: list[bool] = []
    front: dict[str, list[int]] = {}  # node -> non-dominated label ids
    heap: list[tuple[float, float, int]] = []

    def push(cost, gap, node, parent, key):
        ids = front.setdefault(node, [])
        for i in ids:
            if labels[i][0] <= cost and labels[i][1] <= gap:
                return
        keep = []
        for i in ids:
            if cost <= labels[i][0] and gap <= labels[i][1]:
                alive[i] = False
            else:
                keep.append(i)
        keep.append(len(labels))
        front[node] = keep
        labels.append((cost, gap, node, parent, key))
        alive.append(True)
        heapq.heappush(heap, (cost, gap, len(labels) - 1))

    for s in sorted(set(sources)):
        push(0.0, 0.0, s, -1, None)
    g = world.graph
    while heap:
        cost, gap, idx = heapq.heappop(heap)
        if not alive[idx]:
            continue
        node = labels[idx][2]
        if node in goal:
            nodes, keys = [], []
            while idx >= 0:
                _, _, n, parent, key = labels[idx]
                nodes.append(n)
                if key is not None:
                    keys.append(key)
                idx = parent
            return nodes[::-1], keys[::-1], evals, False
        for nbr, data in g[node].items():
            for key in data:
                if not allows_direction(world.edges[key], profile.id, node):
                    continue
                if key not in costs:
                    costs[key] = _edge_cost(world, profile, scenario_id, allow_unknown, key, evals)
                w = costs[key]
                if w is None:
                    continue
                run = gap + world.edges[key].length_m
                if run > limit:
                    continue
                if nbr not in rest:
                    st = _rest_node_state(world, nbr)
                    rest[nbr] = st == "PASS" or (allow_unknown and st == "UNKNOWN")
                if len(labels) >= MAX_REST_LABELS:
                    return None, [], evals, True
                push(cost + w, 0.0 if rest[nbr] else run, nbr, idx, key)
    return None, [], evals, False


def _route_from_nodes(world, nodes, keys, from_id, to_id, profile, scenario_id, evals) -> Route:
    segs, coords, unknowns, dist = [], [], [], 0.0
    metres = dict.fromkeys(LEVELS, 0.0)
    estimated, uncovered = False, False
    for u, k in zip(nodes, keys, strict=False):
        e = world.edges[k]
        res, why = evals[k]
        access = _assessment(world, profile, scenario_id, k, (res, why))
        estimated |= access.level == "likely_ok"
        uncovered |= access.level == "unknown" and (res == "UNKNOWN" or bool(e.osm_tags))
        metres[access.level] += e.length_m
        segs.append(
            RouteSegment(
                edge_id=k,
                eval=res,
                flood_class=_flood_class(world, scenario_id, k),
                access_level=access.level,
                rule_id=access.rule_id,
                tags_used=access.tags_used,
            )
        )
        pts = e.coords if e.from_node == u else list(reversed(e.coords))
        coords.extend(pts if not coords else pts[1:])
        dist += e.length_m
        if res == "UNKNOWN":
            unknowns.extend(why)
    if not keys:
        # Keep the LineString contract without inventing any off-graph connection.
        point = world.node_coords[nodes[-1]]
        coords = [list(point), list(point)]
    # A detour out and back along a spur repeats edges: list each unknown once (review M-1).
    unknowns = list({(u["element_id"], u["attribute"]): u for u in unknowns}.values())
    status = (
        "partly_unverified"
        if uncovered
        else "likely_ok"
        if estimated
        else _caveat(profile, "confirmed" if not unknowns else "partly_unverified")
    )
    rid = (
        "rt-"
        + hashlib.sha1(
            f"{from_id}|{to_id}|{profile.id}|{scenario_id}|{nodes}|{keys}".encode()
        ).hexdigest()[:8]
    )
    rest, seen = [], set()
    for n in nodes:
        for st, p in _rest_places(world, n):
            if p.id not in seen:
                seen.add(p.id)
                status_word = "verified" if st == "PASS" else "unverified"
                rest.append({"place_id": p.id, "node_id": n, "name": p.name, "status": status_word})
    route = Route(
        id=rid,
        status=status,
        from_place=from_id,
        to_place=to_id,
        target_node=nodes[-1],
        profile=profile.id,
        scenario_id=scenario_id,
        distance_m=round(dist, 1),
        est_minutes=round(dist / _pace_m_per_min(profile), 1),
        segments=segs,
        maneuvers=build_maneuvers(world, nodes, segs),
        access_metres={level: round(length, 1) for level, length in metres.items()},
        unknowns=unknowns,
        rest_points=rest,
        geometry={"type": "LineString", "coordinates": coords},
    )
    route.max_gap_between_rest_m = _max_rest_gap(world, nodes, keys, {r["node_id"] for r in rest})
    route.crossings = route_crossings(world, segs)
    route.sidewalk_m = round(
        sum(world.edges[k].length_m for k in keys if world.edges[k].type == "sidewalk"), 1
    )
    route.road_sections = route_road_sections(world, keys)
    route.road_m = round(sum(s.length_m for s in route.road_sections), 1)
    route.road_without_mapped_sidewalk_m = round(
        sum(
            s.length_m
            for s in route.road_sections
            if s.sidewalk not in SIDEWALK_PRESENT
            or s.sidewalk_status not in ("reported", "verified")
        ),
        1,
    )
    ev_list = evidence_for_route(world, route)
    route.evidence_ids = list(dict.fromkeys(ev.id for ev in ev_list))
    route.demo_evidence = any(ev.source_type == PLACEHOLDER_SOURCE for ev in ev_list)
    limit = profile.max_rest_free_run_m
    if limit is not None:
        verified = {r["node_id"] for r in rest if r["status"] == "verified"}
        route.rest_limit_m = limit
        route.rest_limit_met = route.max_gap_between_rest_m <= limit
        if route.rest_limit_met and _max_rest_gap(world, nodes, keys, verified) > limit:
            # Within the limit only by counting unverified rest points: name them, and the
            # route is at most partly_unverified (R30).
            route.rest_points_unverified = [
                r["place_id"] for r in rest if r["status"] == "unverified"
            ]
        if route.status in ("confirmed", "likely_ok") and (
            not route.rest_limit_met or route.rest_points_unverified
        ):
            route.status = "partly_unverified"
    return route


def route_road_sections(world: World, keys: list[str]) -> list[RoadSection]:
    sections = []
    for key in keys:
        edge = world.edges[key]
        if edge.type not in ROAD_TYPES:
            continue
        claim = edge.claims.get("sidewalk")
        status = claim.status if claim else "unknown"
        if claim and _is_stale(claim, "sidewalk", date.today()):
            status = "stale"
        sections.append(
            RoadSection(
                element_id=key,
                name=edge.name,
                length_m=edge.length_m,
                sidewalk=claim.value if claim else None,
                sidewalk_status=status,
            )
        )
    return sections


def _max_rest_gap(world, nodes, keys, rest_nodes) -> float:
    gap = best = 0.0
    for v, k in zip(nodes[1:], keys, strict=True):
        gap += world.edges[k].length_m
        if v in rest_nodes:
            best, gap = max(best, gap), 0.0
    return round(max(best, gap), 1)


def evidence_for_route(world: World, route: Route) -> list[Evidence]:
    out = [
        ev
        for pid in dict.fromkeys((route.from_place, route.to_place))
        for ev in flood_evidence(world, pid, route.scenario_id)
    ]
    for s in route.segments:
        e = world.edges[s.edge_id]
        for attr, c in e.claims.items():
            out.append(
                Evidence(
                    id=f"ev-{e.id}.{attr}",
                    element_id=e.id,
                    attribute=attr,
                    value=c.value,
                    status=c.status,
                    verified_at=c.verified_at,
                    source_type=c.evidence_type,
                    photo_url=photo_url(c),
                )
            )
        out.extend(flood_evidence(world, e.id, route.scenario_id))
    out.append(
        Evidence(
            id=f"ev-{route.id}.walkways",
            element_id=route.id,
            attribute="route_walkways",
            value={
                "sidewalk_m": route.sidewalk_m,
                "road_m": route.road_m,
                "road_without_mapped_sidewalk_m": route.road_without_mapped_sidewalk_m,
                "road_sections": [s.model_dump(mode="json") for s in route.road_sections],
            },
            status="reported",
            source_type="mapped walk graph (not a sidewalk survey)",
        )
    )
    estimated = [s for s in route.segments if s.access_level == "likely_ok"]
    if estimated:
        out.append(
            Evidence(
                id=f"ev-{route.id}.access_estimate",
                element_id=route.id,
                attribute="route_access_estimate",
                status="reported",
                source_type="map-derived estimate (not checked on site)",
                value={
                    "access_metres": route.access_metres,
                    "segments": [
                        {"edge_id": s.edge_id, "rule_id": s.rule_id, "tags_used": s.tags_used}
                        for s in estimated
                    ],
                },
            )
        )
    return out


def direction_evidence(world: World, edge_ids) -> list[Evidence]:
    out = []
    for key in dict.fromkeys(edge_ids):
        edge = world.edges.get(key)
        if edge is None:
            continue
        _, tag, value = direction_rule(edge)
        if tag is None:
            tag = next((k for k in CONDITIONAL_KEYS if k in edge.osm_tags), None)
            value = edge.osm_tags.get(tag) if tag else None
        if tag is not None:
            out.append(
                Evidence(
                    id=f"ev-{edge.id}.oneway",
                    element_id=edge.id,
                    attribute="oneway",
                    value={"tag": tag, "value": value},
                    status="reported",
                    source_type="osm_import",
                )
            )
    return out


def plan_route(
    world: World, from_id: str, to_id: str, profile_id: str, scenario_id: str | None = None
) -> RouteResult:
    if error := selection_error(world, profile_id, scenario_id):
        return RouteResult(status="no_data", routes=[], warnings=[error])
    profile = world.profiles[profile_id]
    result = _plan(world, from_id, to_id, profile, scenario_id)
    endpoint_unknowns = [
        why
        for pid in dict.fromkeys((from_id, to_id))
        for state, reasons in [
            endpoint_flood(world, pid, profile, scenario_id)
            if pid == to_id
            else origin_flood(world, pid, profile, scenario_id)
        ]
        if state == "UNKNOWN"
        for why in reasons
    ]
    for route in result.routes:
        if endpoint_unknowns:
            route.unknowns.extend(endpoint_unknowns)
            route.status = "partly_unverified"
    if result.routes:
        result.status = result.routes[0].status
        route = result.routes[0]
        if route.access_metres.get("likely_ok", 0):
            result.warnings.append(
                "Likely OK sections are estimated from map data, not checked on site"
            )
        if profile.allowed_types is None and route.road_without_mapped_sidewalk_m:
            result.warnings.append(
                f"About {route.road_without_mapped_sidewalk_m:.0f} m follows road centre lines "
                "without a mapped sidewalk; sidewalk access is not verified"
            )
        if profile.id == "drive" and any(
            direction_unknown(world.edges[s.edge_id]) for s in route.segments
        ):
            result.warnings.append(
                "This route includes conditional or changing one-way directions "
                "that are not interpreted"
            )
    result.warnings.extend(
        note
        for pid in dict.fromkeys((from_id, to_id))
        for note in endpoint_flood_warnings(world, pid, profile, scenario_id)
    )
    if profile.allowed_types is not None and result.routes:
        for pid in (from_id, to_id):
            if note := _snap_warning(world, pid, profile):
                result.warnings.append(note)
    if profile.standing_warning and result.status != "no_data":
        result.warnings.append(profile.standing_warning)
    return result


def _plan(world, from_id, to_id, profile, scenario_id) -> RouteResult:
    sources, targets = _targets(world, from_id, profile), _targets(world, to_id, profile)
    if not sources or not targets:
        warnings = []
        for pid, found in ((from_id, sources), (to_id, targets)):
            if not found:
                warnings.append(
                    _no_road_warning(world, pid, profile)
                    or (
                        f"place not mapped: {pid}"
                        if pid in world.places
                        else f"no such place: {pid}"
                    )
                )
        return RouteResult(status="no_data", routes=[], warnings=warnings)
    endpoint_failures = [
        why
        for state, reasons in [endpoint_flood(world, to_id, profile, scenario_id)]
        if state == "FAIL"
        for why in reasons
    ]
    if endpoint_failures and not _disconnected(world, profile, sources, targets):
        return RouteResult(status="blocked", routes=[], blocked_reasons=endpoint_failures)
    limit = profile.max_rest_free_run_m
    truncated = False
    if limit is not None:
        # Rest-point-aware pass first: a route that keeps every stretch between rest points
        # within the limit beats any route that does not, verified or not.
        found, evals, truncated = _passes(
            _rest_search, world, sources, targets, profile, scenario_id, limit
        )
        routes = _pick(world, *found, evals, from_id, to_id, profile, scenario_id)
        if routes:
            result = RouteResult(
                status=routes[0].status, routes=routes, demo_evidence=routes[0].demo_evidence
            )
            return _with_rest(result, limit, truncated)
    found, evals, _ = _passes(_search, world, sources, targets, profile, scenario_id)
    routes = _pick(world, *found, evals, from_id, to_id, profile, scenario_id)
    if routes:
        result = RouteResult(
            status=routes[0].status, routes=routes, demo_evidence=routes[0].demo_evidence
        )
        return _with_rest(result, limit, truncated) if limit is not None else result
    if _disconnected(world, profile, sources, targets):
        # Not "blocked": the mapped data does not join these two places, so no known barrier
        # or flood class is responsible.
        what = "roads" if profile.allowed_types is not None else "paths"
        return RouteResult(
            status="no_data",
            routes=[],
            warnings=[
                f"mapped {what} do not connect {from_id} and {to_id}; "
                f"the {what[:-1]} data may be incomplete here"
            ],
        )
    blocked = [w for res, why in evals.values() if res == "FAIL" for w in why][:5]
    return RouteResult(status="blocked", routes=[], blocked_reasons=blocked)


def _passes(search, world, sources, targets, profile, scenario_id, *limit):
    """Strict (PASS only) and lenient (PASS + UNKNOWN) runs of one search function."""
    out = [search(world, sources, targets, profile, scenario_id, False, *limit)]
    out.append(search(world, sources, targets, profile, scenario_id, True, *limit))
    (strict, skeys, ev1, *t1), (lenient, lkeys, ev2, *t2) = out
    return ((strict, skeys), (lenient, lkeys)), {**ev2, **ev1}, any(t1 + t2)


def _pick(world, strict_found, lenient_found, evals, from_id, to_id, profile, scenario_id):
    """routes[0] from the strict pass (else the lenient one); a much shorter lenient alternative
    is offered next to a strict route."""
    (strict, skeys), (lenient, lkeys) = strict_found, lenient_found
    if strict:
        routes = [
            _route_from_nodes(world, strict, skeys, from_id, to_id, profile, scenario_id, evals)
        ]
        if lenient and lkeys != skeys:
            alt = _route_from_nodes(
                world, lenient, lkeys, from_id, to_id, profile, scenario_id, evals
            )
            if alt.distance_m < 0.8 * routes[0].distance_m:
                routes.append(alt)
        return routes
    if lenient:
        return [
            _route_from_nodes(world, lenient, lkeys, from_id, to_id, profile, scenario_id, evals)
        ]
    return []


def _with_rest(result: RouteResult, limit: float, truncated: bool = False) -> RouteResult:
    """Result-level rest fields and warnings for routes[0] (routes are marked when built)."""
    r0 = result.routes[0]
    result.status = r0.status
    result.rest_limit_m = limit
    result.max_rest_gap_m = r0.max_gap_between_rest_m
    result.rest_search_truncated = truncated
    if not r0.rest_limit_met:
        result.warnings.append(rest_gap_text(r0.max_gap_between_rest_m or 0.0, limit))
    elif r0.rest_points_unverified:
        names = [r["name"] for r in r0.rest_points if r["place_id"] in r0.rest_points_unverified]
        result.warnings.append(
            f"rest {'point' if len(names) == 1 else 'points'} not checked yet: "
            f"{', '.join(names)}; this route needs "
            f"{'it' if len(names) == 1 else 'them'} to keep every stretch within {limit:g} m"
        )
    if truncated:
        result.warnings.append(
            "rest-point search stopped early; a route with closer rest points may exist"
        )
    return result


def route_crossings(world: World, segs: list) -> list[dict[str, Any]]:
    """The crossing segments a route uses, with their recorded crossing type (None if unknown)."""
    out = []
    for s in segs:
        e = world.edges[s.edge_id]
        if e.type != "crossing":
            continue
        c = e.claims.get("crossing")
        out.append(
            {
                "element_id": e.id,
                "name": e.name,
                "crossing": c.value if c is not None else None,
                "status": c.status if c is not None else "unknown",
            }
        )
    return out


def rest_gap_text(gap: float, limit: float) -> str:
    """The resident-facing rest-gap line (lower case; callers capitalise)."""
    about = _about_m(gap, limit)
    return f"longest stretch without a rest point is about {about} m (limit {limit:g} m)"


def _about_m(gap: float, limit: float) -> int:
    """`gap` rounded to 10 m, but never down to the limit or below it (103 m must not read as
    "about 100 m (limit 100 m)")."""
    about = math.floor(gap / 10 + 0.5) * 10
    return about if about > limit else math.floor(limit / 10) * 10 + 10
