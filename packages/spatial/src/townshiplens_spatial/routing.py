import hashlib

import networkx as nx

from .evaluate import evaluate_edge
from .geo import haversine_m
from .models import Evidence, Route, RouteResult, RouteSegment, photo_url
from .scenario_meta import scenario_source
from .world import World

CENTRE_PREFIX = "__centre__"
UNKNOWN_WEIGHT = 5.0
WALK_M_PER_MIN = 70.0


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
    """Component id per node of the unfiltered mapped graph (no profile rules, no flood)."""
    g = world.graph
    key = (g.number_of_nodes(), g.number_of_edges())
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


def make_weight(world, profile, scenario_id, allow_unknown, evals=None, chosen=None):
    """Edge-cost function shared by route search and flood reachability (single rule set).

    `evals` / `chosen`, when given, record each edge evaluation and the edge key costed per node
    pair. Returns None for edges the profile cannot use (hidden from the search).
    """

    def weight(u, v, data):
        best = None
        for key in data:  # MultiGraph: data = {edge_id: attrs}
            e = world.edges[key]
            res, why = evaluate_edge(e, profile, _flood_class(world, scenario_id, key))
            if evals is not None:
                evals[key] = (res, why)
            if res == "FAIL" or (res == "UNKNOWN" and not allow_unknown):
                continue
            w = e.length_m * (UNKNOWN_WEIGHT if res == "UNKNOWN" else 1.0)
            if e.type == "steps":
                w *= profile.soft.get("steps_multiplier", 1.0)
            if best is None or w < best:
                best = w
                if chosen is not None:
                    chosen[frozenset((u, v))] = key
        return best

    return weight


def _search(world, sources, targets, profile, scenario_id, allow_unknown):
    evals: dict[str, tuple] = {}
    chosen: dict[frozenset, str] = {}  # node pair -> edge key the search actually costed
    weight = make_weight(world, profile, scenario_id, allow_unknown, evals, chosen)

    g = world.graph
    tmp_s, tmp_t = "__S__", "__T__"
    h = nx.MultiGraph(g)
    for s in sources:
        h.add_edge(tmp_s, s, key="__s__" + s)
    for t in targets:
        h.add_edge(t, tmp_t, key="__t__" + t)

    def w2(u, v, data):
        if any(str(k).startswith("__") for k in data):
            return 0.0
        return weight(u, v, data)

    try:
        path = nx.dijkstra_path(h, tmp_s, tmp_t, weight=w2)
    except nx.NetworkXNoPath:
        return None, [], evals
    nodes = path[1:-1]
    keys = [chosen[frozenset((u, v))] for u, v in zip(nodes, nodes[1:], strict=False)]
    return nodes, keys, evals


def _route_from_nodes(world, nodes, keys, from_id, to_id, profile, scenario_id, evals) -> Route:
    segs, coords, unknowns, dist = [], [], [], 0.0
    for u, k in zip(nodes, keys, strict=False):
        e = world.edges[k]
        res, why = evals[k]
        segs.append(
            RouteSegment(edge_id=k, eval=res, flood_class=_flood_class(world, scenario_id, k))
        )
        pts = e.coords if e.from_node == u else list(reversed(e.coords))
        coords.extend(pts if not coords else pts[1:])
        dist += e.length_m
        if res == "UNKNOWN":
            unknowns.extend(why)
    status = _caveat(profile, "confirmed" if not unknowns else "partly_unverified")
    rid = (
        "rt-"
        + hashlib.sha1(
            f"{from_id}|{to_id}|{profile.id}|{scenario_id}|{nodes}|{keys}".encode()
        ).hexdigest()[:8]
    )
    rest = [
        {"place_id": p.id, "node_id": n}
        for n in nodes
        for p in world.places_at(n)
        if p.type == "seating"
    ]
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
        unknowns=unknowns,
        rest_points=rest,
        geometry={"type": "LineString", "coordinates": coords},
    )
    route.max_gap_between_rest_m = _max_rest_gap(world, nodes, keys, {r["node_id"] for r in rest})
    route.evidence_ids = [ev.id for ev in evidence_for_route(world, route)]
    return route


def _max_rest_gap(world, nodes, keys, rest_nodes) -> float:
    gap = best = 0.0
    for v, k in zip(nodes[1:], keys, strict=True):
        gap += world.edges[k].length_m
        if v in rest_nodes:
            best, gap = max(best, gap), 0.0
    return round(max(best, gap), 1)


def evidence_for_route(world: World, route: Route) -> list[Evidence]:
    out = []
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
        if s.flood_class:
            out.append(
                Evidence(
                    id=f"ev-scn-{route.scenario_id}.{e.id}",
                    element_id=e.id,
                    attribute="flood",
                    value=s.flood_class,
                    status="indicative",
                    source_type=scenario_source(world, route.scenario_id),
                )
            )
    return out


def plan_route(
    world: World, from_id: str, to_id: str, profile_id: str, scenario_id: str | None = None
) -> RouteResult:
    profile = world.profiles.get(profile_id)
    if profile is None:
        return RouteResult(status="no_data", routes=[], warnings=[f"unknown profile {profile_id}"])
    result = _plan(world, from_id, to_id, profile, scenario_id)
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
    strict, skeys, ev1 = _search(world, sources, targets, profile, scenario_id, allow_unknown=False)
    lenient, lkeys, ev2 = _search(world, sources, targets, profile, scenario_id, allow_unknown=True)
    evals = {**ev2, **ev1}
    routes: list[Route] = []
    if strict:
        routes.append(
            _route_from_nodes(world, strict, skeys, from_id, to_id, profile, scenario_id, evals)
        )
        if lenient and lkeys != skeys:
            alt = _route_from_nodes(
                world, lenient, lkeys, from_id, to_id, profile, scenario_id, evals
            )
            if alt.distance_m < 0.8 * routes[0].distance_m:
                routes.append(alt)
        return RouteResult(status=routes[0].status, routes=routes)
    if lenient:
        r = _route_from_nodes(world, lenient, lkeys, from_id, to_id, profile, scenario_id, evals)
        return RouteResult(status=r.status, routes=[r])
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
