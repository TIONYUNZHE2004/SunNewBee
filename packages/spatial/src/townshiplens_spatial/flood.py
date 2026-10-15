"""Flood analytics over the world model (indicative river-stage scenarios (REM by default;
see ADR 0010), never forecasts).

Definitions:
- passable graph: the walk graph for a profile + scenario keeping every edge whose evaluation is
  not FAIL (UNKNOWN and "possible" flood edges stay passable; "likely_flooded" edges are FAIL).
- island (ruling R5): a connected component of the passable graph with more than one node (or a
  mapped place) that contains NO evacuation-centre node. Components holding a centre are not
  islands; whether a specific origin can reach a specific centre is answered separately by
  `centres_reachability`.
"""

from __future__ import annotations

import networkx as nx

from .evaluate import evaluate_edge
from .models import AffectedResult, CentreReachability, Scenario
from .routing import (
    CENTRE_PREFIX,
    _caveat,
    _disconnected,
    _targets,
    make_weight,
    plan_route,
)
from .world import World

TOP_ROUTES = 3


def scenario(world: World, scenario_id: str) -> Scenario | None:
    return next((s for s in world.flood.scenarios if s.id == scenario_id), None)


def _passable_graph(world: World, scenario_id: str, profile_id: str) -> nx.Graph:
    prof = world.profiles.get(profile_id) or world.profiles["default"]
    g = nx.Graph()
    g.add_nodes_from(world.graph.nodes)
    classes = world.flood.edge_classes.get(scenario_id, {})
    for eid, e in world.edges.items():
        res, _ = evaluate_edge(e, prof, classes.get(eid))
        if res != "FAIL":
            g.add_edge(e.from_node, e.to_node)
    return g


LIST_CAP = 20
ISLAND_CAP = 10
_KIND = {"all": None, "facility": "place", "place": "place", "path": "path", "road": "path"}


def _items(world, ids_places, ids_edges, kind):
    """Briefing list: places individually, paths grouped by name (unnamed -> one item)."""
    out: list[dict] = []
    if kind in (None, "place"):
        out += [{"id": p, "name": world.places[p].name, "kind": "place"} for p in ids_places]
    if kind in (None, "path"):
        groups: dict[str | None, int] = {}
        for eid in ids_edges:
            groups[world.edges[eid].name or None] = groups.get(world.edges[eid].name or None, 0) + 1
        named = sorted((n, c) for n, c in groups.items() if n)
        out += [{"kind": "path", "name": n, "count": c} for n, c in named]
        if None in groups:
            out.append({"kind": "path", "name": "Unnamed paths", "count": groups[None]})
    return out[:LIST_CAP]


def _centre_connected(g: nx.Graph, centre_nodes: set[str]) -> set[str]:
    out: set[str] = set()
    for comp in nx.connected_components(g):
        if comp & centre_nodes:
            out |= comp
    return out


def affected(
    world: World, scenario_id: str, profile_id: str = "default", kind: str = "all"
) -> AffectedResult:
    s = scenario(world, scenario_id)
    disclaimer = s.disclaimer if s else "Unknown scenario."
    warnings: list[str] = []
    if profile_id not in world.profiles:
        warnings.append(f"unknown profile {profile_id}; used default")
        profile_id = "default"
    want = _KIND.get(kind)
    pc = world.flood.place_classes.get(scenario_id, {})
    ec = world.flood.edge_classes.get(scenario_id, {})

    def ids(cls: str) -> tuple[list[str], list[str]]:
        pl = sorted(p for p, c in pc.items() if c == cls and p in world.places)
        ed = sorted(e for e, c in ec.items() if c == cls and e in world.edges)
        return (pl if want in (None, "place") else []), (ed if want in (None, "path") else [])

    lp, le = ids("likely_flooded")
    pp, pe = ids("possible")

    centre_nodes = {c.node_id for c in world.centres.values() if c.node_id}
    g = _passable_graph(world, scenario_id, profile_id)
    base_ok = _centre_connected(_passable_graph(world, "", profile_id), centre_nodes)
    cands = []
    for comp in nx.connected_components(g):
        if comp & centre_nodes or not (comp & base_ok):
            continue  # holds a centre, or never had centre access: not a flood island
        place_ids = sorted(
            p.id for n in comp for p in world.places_at(n) if not p.id.startswith("__")
        )
        if place_ids:
            cands.append((len(place_ids), len(comp), sorted(comp), place_ids))
    cands.sort(key=lambda t: (-t[0], -t[1], t[2][0]))
    islands = [
        {
            "id": f"island-{i}",
            "node_count": n,
            "place_count": np_,
            "sample_node_ids": nodes[:5],
            "sample_place_ids": pids[:5],
        }
        for i, (np_, n, nodes, pids) in enumerate(cands[:ISLAND_CAP])
    ]
    return AffectedResult(
        scenario_id=scenario_id,
        likely=_items(world, lp, le, want),
        possible=_items(world, pp, pe, want),
        isolated_components=islands,
        isolated_total=len(cands),
        disclaimer=disclaimer,
        likely_total=len(lp) + len(le),
        possible_total=len(pp) + len(pe),
        likely_place_ids=lp,
        possible_place_ids=pp,
        likely_edge_ids=le,
        possible_edge_ids=pe,
        warnings=warnings,
    )


def centres_reachability(
    world: World,
    scenario_id: str | None,
    profile_id: str,
    near_place: str | None,
    top_routes: int = TOP_ROUTES,
) -> list[CentreReachability]:
    """One strict and one lenient multi-source Dijkstra from the origin, costed by the same
    edge rules as routing. Full Route objects are built only for the nearest TOP_ROUTES centres."""
    profile = world.profiles.get(profile_id)
    sources = _targets(world, near_place, profile) if near_place and profile else []
    no_data = [
        CentreReachability(centre=c, reachable=False, route_status="no_data")
        for c in world.centres.values()
    ]
    if not sources:
        return no_data
    strict = nx.multi_source_dijkstra_path_length(
        world.graph, sources, weight=make_weight(world, profile, scenario_id, False)
    )
    lenient = nx.multi_source_dijkstra_path_length(
        world.graph, sources, weight=make_weight(world, profile, scenario_id, True)
    )
    rows = []
    for c in world.centres.values():
        ts = _targets(world, f"{CENTRE_PREFIX}{c.id}", profile)
        inf = float("inf")
        n = min(
            ts, key=lambda t: (t not in strict, strict.get(t, lenient.get(t, inf)), t), default=None
        )
        if n is None:
            rows.append(
                (2, 0.0, CentreReachability(centre=c, reachable=False, route_status="no_data"))
            )
        elif n in strict:
            rows.append(
                (
                    0,
                    strict[n],
                    CentreReachability(
                        centre=c, reachable=True, route_status=_caveat(profile, "confirmed")
                    ),
                )
            )
        elif n in lenient:
            rows.append(
                (
                    0,
                    lenient[n],
                    CentreReachability(centre=c, reachable=True, route_status="partly_unverified"),
                )
            )
        elif _disconnected(world, profile, sources, ts):
            rows.append(
                (2, 0.0, CentreReachability(centre=c, reachable=False, route_status="no_data"))
            )
        else:
            rows.append(
                (1, 0.0, CentreReachability(centre=c, reachable=False, route_status="blocked"))
            )
    rows.sort(key=lambda t: (t[0], t[1], t[2].centre.id))
    out = [r for _, _, r in rows]
    for r in [r for r in out if r.reachable][:top_routes]:
        rr = plan_route(world, near_place, f"{CENTRE_PREFIX}{r.centre.id}", profile_id, scenario_id)
        if rr.routes:
            r.route_id = rr.routes[0].id
            r.distance_m = rr.routes[0].distance_m
            r.route_status = rr.routes[0].status
    return out
