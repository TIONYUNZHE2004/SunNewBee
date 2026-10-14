import hashlib

import networkx as nx

from .evaluate import evaluate_edge
from .models import Evidence, Route, RouteResult, RouteSegment
from .world import World

UNKNOWN_WEIGHT = 5.0
WALK_M_PER_MIN = 70.0


def _targets(world: World, place_id: str) -> list[str]:
    p = world.places.get(place_id)
    if p is None:
        return []
    ents = [
        world.places[e].node_id
        for e in p.entrance_ids
        if e in world.places and world.places[e].node_id
    ]
    return ents or ([p.node_id] if p.node_id and p.node_id in world.graph else [])


def _flood_class(world: World, scenario_id: str | None, edge_id: str):
    return world.flood.edge_classes.get(scenario_id or "", {}).get(edge_id) if scenario_id else None


def _search(world, sources, targets, profile, scenario_id, allow_unknown):
    evals: dict[str, tuple] = {}

    def weight(u, v, data):
        best = None
        for key in data:  # MultiGraph: data = {edge_id: attrs}
            e = world.edges[key]
            res, why = evaluate_edge(e, profile, _flood_class(world, scenario_id, key))
            evals[key] = (res, why)
            if res == "FAIL" or (res == "UNKNOWN" and not allow_unknown):
                continue
            w = e.length_m * (UNKNOWN_WEIGHT if res == "UNKNOWN" else 1.0)
            if e.type == "steps":
                w *= profile.soft.get("steps_multiplier", 1.0)
            best = w if best is None else min(best, w)
        return best  # None hides the edge

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
        return None, evals
    return path[1:-1], evals


def _route_from_nodes(world, nodes, from_id, to_id, profile, scenario_id, evals) -> Route:
    segs, coords, unknowns, dist = [], [], [], 0.0
    for u, v in zip(nodes, nodes[1:], strict=False):
        cands = [k for k in world.graph[u][v] if evals.get(k, ("FAIL",))[0] != "FAIL"]
        k = min(cands, key=lambda k: world.edges[k].length_m)
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
    status = "confirmed" if not unknowns else "partly_unverified"
    rid = (
        "rt-"
        + hashlib.sha1(
            f"{from_id}|{to_id}|{profile.id}|{scenario_id}|{nodes}".encode()
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
        est_minutes=round(dist / WALK_M_PER_MIN, 1),
        segments=segs,
        unknowns=unknowns,
        rest_points=rest,
        geometry={"type": "LineString", "coordinates": coords},
    )
    route.max_gap_between_rest_m = _max_rest_gap(world, nodes, {r["node_id"] for r in rest})
    route.evidence_ids = [ev.id for ev in evidence_for_route(world, route)]
    return route


def _max_rest_gap(world, nodes, rest_nodes) -> float:
    gap = best = 0.0
    for u, v in zip(nodes, nodes[1:], strict=False):
        gap += min(world.edges[k].length_m for k in world.graph[u][v])
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
                    source_type="HAND scenario",
                )
            )
    return out


def plan_route(
    world: World, from_id: str, to_id: str, profile_id: str, scenario_id: str | None = None
) -> RouteResult:
    profile = world.profiles.get(profile_id)
    if profile is None:
        return RouteResult(status="no_data", routes=[], warnings=[f"unknown profile {profile_id}"])
    if profile.stub:
        return RouteResult(
            status="no_data", routes=[], warnings=["drive network not built yet (skeleton stub)"]
        )
    sources, targets = _targets(world, from_id), _targets(world, to_id)
    if not sources or not targets:
        missing = from_id if not sources else to_id
        return RouteResult(status="no_data", routes=[], warnings=[f"place not mapped: {missing}"])
    strict, ev1 = _search(world, sources, targets, profile, scenario_id, allow_unknown=False)
    lenient, ev2 = _search(world, sources, targets, profile, scenario_id, allow_unknown=True)
    evals = {**ev2, **ev1}
    routes: list[Route] = []
    if strict:
        routes.append(_route_from_nodes(world, strict, from_id, to_id, profile, scenario_id, evals))
        if lenient and lenient != strict:
            alt = _route_from_nodes(world, lenient, from_id, to_id, profile, scenario_id, evals)
            if alt.distance_m < 0.8 * routes[0].distance_m:
                routes.append(alt)
        return RouteResult(status="confirmed", routes=routes)
    if lenient:
        r = _route_from_nodes(world, lenient, from_id, to_id, profile, scenario_id, evals)
        return RouteResult(status="partly_unverified", routes=[r])
    blocked = [w for res, why in evals.values() if res == "FAIL" for w in why][:5]
    return RouteResult(status="blocked", routes=[], blocked_reasons=blocked)
