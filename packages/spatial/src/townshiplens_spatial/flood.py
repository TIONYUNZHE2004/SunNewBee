"""Flood analytics over the world model (indicative HAND scenarios, never forecasts).

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
from .models import AffectedResult, CentreReachability, Place, Scenario
from .routing import plan_route
from .world import World

TRANSIENT_PREFIX = "__centre__"


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


def affected(world: World, scenario_id: str, profile_id: str = "default") -> AffectedResult:
    s = scenario(world, scenario_id)
    disclaimer = s.disclaimer if s else "Unknown scenario."
    pc = world.flood.place_classes.get(scenario_id, {})
    ec = world.flood.edge_classes.get(scenario_id, {})

    def items(cls: str) -> list[dict[str, str]]:
        out = [
            {"id": pid, "name": world.places[pid].name, "kind": "place"}
            for pid, c in pc.items()
            if c == cls and pid in world.places
        ]
        out += [
            {"id": eid, "name": world.edges[eid].name or eid, "kind": "path"}
            for eid, c in ec.items()
            if c == cls and eid in world.edges
        ]
        return out

    g = _passable_graph(world, scenario_id, profile_id)
    centre_nodes = {c.node_id for c in world.centres.values() if c.node_id}
    islands = []
    comps = sorted((sorted(c) for c in nx.connected_components(g)), key=lambda c: c[0] if c else "")
    for i, comp in enumerate(comps):
        cs = set(comp)
        if cs & centre_nodes:
            continue
        place_ids = [p.id for n in comp for p in world.places_at(n) if not p.id.startswith("__")]
        if len(comp) > 1 or place_ids:
            islands.append(
                {
                    "id": f"island-{i}",
                    "node_count": len(comp),
                    "sample_node_ids": comp[:5],
                    "sample_place_ids": place_ids[:5],
                }
            )
    return AffectedResult(
        scenario_id=scenario_id,
        likely=items("likely_flooded"),
        possible=items("possible"),
        isolated_components=islands,
        disclaimer=disclaimer,
    )


def centres_reachability(
    world: World, scenario_id: str | None, profile_id: str, near_place: str | None
) -> list[CentreReachability]:
    out = []
    for c in world.centres.values():
        if near_place is None or (c.place_id is None and c.node_id is None):
            out.append(CentreReachability(centre=c, reachable=False, route_status="no_data"))
            continue
        target = c.place_id or f"{TRANSIENT_PREFIX}{c.id}"
        if c.place_id is None and target not in world.places:
            # Ruling R12: transient place so plan_route can target the centre node; find_place
            # skips ids starting with "__".
            world.places[target] = Place(
                id=target, type="evacuation_centre", name=c.name, coord=c.coord, node_id=c.node_id
            )
        rr = plan_route(world, near_place, target, profile_id, scenario_id)
        best = rr.routes[0] if rr.routes else None
        out.append(
            CentreReachability(
                centre=c,
                reachable=rr.status in ("confirmed", "partly_unverified"),
                route_status=rr.status,
                route_id=best.id if best else None,
                distance_m=best.distance_m if best else None,
            )
        )
    return sorted(out, key=lambda r: (not r.reachable, r.distance_m or 1e9, r.centre.id))
