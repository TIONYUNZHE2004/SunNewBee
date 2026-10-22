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

from collections import deque

import networkx as nx

from .direction import allows_direction
from .models import AffectedResult, CentreReachability, FloodPlace, Scenario
from .routing import (
    CENTRE_PREFIX,
    _caveat,
    _disconnected,
    _evaluate,
    _road_nodes,
    _targets,
    _zero_edge_entrance_gaps,
    endpoint_flood,
    make_weight,
    origin_flood,
    path_status,
    plan_route,
)
from .scenario_meta import selection_error
from .world import World

TOP_ROUTES = 3


def scenario(world: World, scenario_id: str) -> Scenario | None:
    return next((s for s in world.flood.scenarios if s.id == scenario_id), None)


def _passable_graph(world: World, scenario_id: str, profile_id: str) -> nx.Graph:
    prof = world.profiles.get(profile_id) or world.profiles["default"]
    g = nx.Graph()
    g.add_nodes_from(world.graph.nodes)
    for eid, e in world.edges.items():
        res, _ = _evaluate(world, prof, scenario_id or None, eid)
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


def place_marker(place) -> FloodPlace:
    return FloodPlace(id=place.id, name=place.name, type=place.type, lonlat=place.coord)


def _expand_reachable(world, profile, scenario_id, connected, pending):
    while pending:
        node = pending.popleft()
        for previous, data in world.graph[node].items():
            if previous in connected:
                continue
            if any(
                allows_direction(world.edges[key], profile.id, previous)
                and _evaluate(world, profile, scenario_id, key)[0] != "FAIL"
                for key in data
            ):
                connected.add(previous)
                pending.append(previous)


def _centre_reachable(world, profile_id, scenario_id=None):
    profile = world.profiles[profile_id]
    roads = _road_nodes(world, profile) if profile.allowed_types is not None else None
    centres = {
        node
        for c in world.centres.values()
        if centre_closure(world, c) is None
        and endpoint_flood(world, f"{CENTRE_PREFIX}{c.id}", profile, scenario_id)[0] != "FAIL"
        for node in _targets(world, f"{CENTRE_PREFIX}{c.id}", profile, road_nodes=roads)
    }
    connected = set(centres)
    _expand_reachable(world, profile, scenario_id, connected, deque(sorted(centres)))
    return connected, profile, roads


def newly_cut_off_by_closure(before, after, profile_id, closed_ids):
    """Exact cutoff difference for edge-only closures with unchanged places/centres.

    One reverse traversal finds after access. Reopening the proposed edges then
    expands only the newly connected part, instead of traversing the whole map twice.
    """
    connected, profile, roads = _centre_reachable(after, profile_id)
    restored = set(connected)
    pending = deque()
    for eid in sorted(closed_ids):
        edge = before.edges[eid]
        for previous, node in ((edge.from_node, edge.to_node), (edge.to_node, edge.from_node)):
            if (
                node in restored
                and previous not in restored
                and allows_direction(edge, profile.id, previous)
                and _evaluate(before, profile, None, eid)[0] != "FAIL"
            ):
                restored.add(previous)
                pending.append(previous)
    _expand_reachable(before, profile, None, restored, pending)
    return [
        place_marker(p)
        for p in sorted(after.places.values(), key=lambda p: p.id)
        if not p.id.startswith("__")
        and (targets := _targets(after, p.id, profile, road_nodes=roads))
        and not any(n in connected for n in targets)
        and any(n in restored for n in targets)
    ]


def cut_off_places(
    world: World, profile_id: str, scenario_id: str | None = None
) -> list[FloodPlace]:
    """Mapped places with no non-FAIL way to any available centre; UNKNOWN stays usable.

    Reverse the routing weight, including vehicle direction, to find all origins in one
    search. Missing entrances/road snaps are data gaps, not proof of isolation. Unlike the
    older flood-island field this also includes mapped components isolated at baseline.
    """
    connected, profile, roads = _centre_reachable(world, profile_id, scenario_id)
    flooded = world.flood.place_classes.get(scenario_id, {})
    return [
        place_marker(p)
        for p in sorted(world.places.values(), key=lambda p: p.id)
        if not p.id.startswith("__")
        and flooded.get(p.id) != "likely_flooded"
        and (targets := _targets(world, p.id, profile, road_nodes=roads))
        and not any(node in connected for node in targets)
    ]


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

    prof = world.profiles[profile_id]
    roads = _road_nodes(world, prof) if prof.allowed_types is not None else None
    centre_targets = {
        c.id: set(_targets(world, f"{CENTRE_PREFIX}{c.id}", prof, road_nodes=roads))
        for c in world.centres.values()
    }
    base_centres = {node for targets in centre_targets.values() for node in targets}
    centre_nodes = {
        node
        for c in world.centres.values()
        if endpoint_flood(world, f"{CENTRE_PREFIX}{c.id}", prof, scenario_id)[0] != "FAIL"
        for node in centre_targets[c.id]
    }
    g = _passable_graph(world, scenario_id, profile_id)
    base_ok = _centre_connected(_passable_graph(world, "", profile_id), base_centres)
    connected = _centre_connected(g, centre_nodes)
    stranded_places = {
        p.id: targets
        for p in world.places.values()
        if not p.id.startswith("__")
        and (targets := set(_targets(world, p.id, prof, road_nodes=roads)))
        and not targets & connected
    }
    cands = []
    for comp in nx.connected_components(g):
        if comp & centre_nodes or not (comp & base_ok):
            continue  # holds a centre, or never had centre access: not a flood island
        place_ids = sorted(pid for pid, targets in stranded_places.items() if targets & comp)
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
        likely_place_count=len(lp),
        likely_path_count=len(le),
        possible_place_count=len(pp),
        possible_path_count=len(pe),
        likely_place_ids=lp,
        possible_place_ids=pp,
        likely_edge_ids=le,
        possible_edge_ids=pe,
        flooded_places=[
            place_marker(world.places[pid])
            for pid in sorted(pc)
            if pc[pid] == "likely_flooded" and pid in world.places
        ],
        cut_off_places=cut_off_places(world, profile_id, scenario_id),
        flooded_path_m=round(
            sum(
                world.edges[eid].length_m
                for eid in ec
                if ec[eid] == "likely_flooded" and eid in world.edges
            ),
            3,
        ),
        warnings=warnings,
    )


def centre_closure(world: World, centre) -> str | None:
    """The closure line ("Closed: flooding until further notice") when a staff-reported closure
    is in force on the centre's place, else None."""
    p = world.places.get(centre.place_id) if centre.place_id else None
    live = [c for c in (p.closures if p else []) if c.is_active()]
    return live[0].label(world.site.timezone) if live else None


def _closed_row(centre, closure: str) -> CentreReachability:
    return CentreReachability(
        centre=centre, reachable=False, route_status="closed", closure=closure
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
    if scenario_id is not None and selection_error(world, profile_id, scenario_id):
        return []
    profile = world.profiles.get(profile_id)
    sources = _targets(world, near_place, profile) if near_place and profile else []
    no_data = [
        _closed_row(c, line)
        if (line := centre_closure(world, c)) is not None
        else CentreReachability(centre=c, reachable=False, route_status="no_data")
        for c in world.centres.values()
    ]
    if not sources:
        return no_data
    origin_state = origin_flood(world, near_place, profile, scenario_id)[0]
    strict, strict_paths = nx.multi_source_dijkstra(
        world.graph, sources, weight=make_weight(world, profile, scenario_id, False)
    )
    lenient = nx.multi_source_dijkstra_path_length(
        world.graph, sources, weight=make_weight(world, profile, scenario_id, True)
    )
    rows = []
    for c in world.centres.values():
        closure = centre_closure(world, c)
        if closure is not None:  # closed: never reachable, never the "nearest reachable"
            rows.append((3, 0.0, _closed_row(c, closure)))
            continue
        ts = _targets(world, f"{CENTRE_PREFIX}{c.id}", profile)
        centre_state = endpoint_flood(world, f"{CENTRE_PREFIX}{c.id}", profile, scenario_id)[0]
        inf = float("inf")
        n = min(
            ts, key=lambda t: (t not in strict, strict.get(t, lenient.get(t, inf)), t), default=None
        )
        if n is None:
            rows.append(
                (2, 0.0, CentreReachability(centre=c, reachable=False, route_status="no_data"))
            )
        elif "FAIL" in (origin_state, centre_state):
            status = "no_data" if _disconnected(world, profile, sources, ts) else "blocked"
            rows.append(
                (
                    2 if status == "no_data" else 1,
                    0.0,
                    CentreReachability(centre=c, reachable=False, route_status=status),
                )
            )
        elif n in strict:
            rows.append(
                (
                    0,
                    strict[n],
                    CentreReachability(
                        centre=c,
                        reachable=True,
                        route_status=_caveat(
                            profile,
                            "partly_unverified"
                            if "UNKNOWN" in (origin_state, centre_state)
                            or (
                                len(strict_paths[n]) == 1
                                and _zero_edge_entrance_gaps(
                                    world, near_place, f"{CENTRE_PREFIX}{c.id}"
                                )
                            )
                            else path_status(world, strict_paths[n], profile, scenario_id),
                        ),
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
