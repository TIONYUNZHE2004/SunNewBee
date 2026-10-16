from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import networkx as nx

from .models import Claim, Closure, Edge, EvacCentre, FloodBundle, Place, Profile, Site, WastePoint
from .profiles import load_profiles


def _fc(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["features"] if path.exists() else []


@dataclass
class World:
    site: Site
    edges: dict[str, Edge]
    places: dict[str, Place]
    node_coords: dict[str, list[float]]
    graph: nx.MultiGraph
    flood: FloodBundle
    water: dict[str, dict]
    centres: dict[str, EvacCentre]
    waste: dict[str, WastePoint]
    profiles: dict[str, Profile]
    version: int = 0
    _place_by_node: dict[str, list[str]] = field(default_factory=dict)
    closures: list[Closure] = field(default_factory=list)  # every loaded closure (flat index)
    data_dir: Path | None = None  # where load_world read it (e.g. for belief_prior.json)

    def refresh_claim(self, element_id: str, attribute: str, claim: Claim) -> None:
        target = self.edges.get(element_id) or self.places.get(element_id)
        if target is None:
            raise KeyError(element_id)
        target.claims = {**target.claims, attribute: claim}  # copy-on-write for readers
        self.version += 1

    def set_closures(self, closures: list[Closure]) -> None:
        """Replace every element's closures (whole-list assignment, so a reader sees the old or
        the new list, never a mix) and bump the version so layer ETags change. Unknown elements
        are dropped. Callers hold `world_lock`."""
        by_el: dict[str, list[Closure]] = {}
        for c in closures:
            if c.element_id in self.edges or c.element_id in self.places:
                by_el.setdefault(c.element_id, []).append(c)
        for el in (*self.edges.values(), *self.places.values()):
            want = by_el.get(el.id, [])
            if el.closures != want:
                el.closures = want
        self.closures = [c for cs in by_el.values() for c in cs]
        self.version += 1

    def active_closures(self, now: datetime | None = None) -> list[Closure]:
        return sorted(
            (c for c in self.closures if c.is_active(now)), key=lambda c: (c.starts_at, c.id)
        )

    def places_at(self, node_id: str) -> list[Place]:
        return [self.places[p] for p in self._place_by_node.get(node_id, [])]


def _edge(f: dict) -> Edge:
    p = f["properties"]
    return Edge(
        id=p["id"],
        type=p.get("type", "footway"),
        from_node=p["from"],
        to_node=p["to"],
        coords=f["geometry"]["coordinates"],
        length_m=p["length_m"],
        name=p.get("name"),
        claims=p.get("claims") or {},
    )


def _place(f: dict) -> Place:
    p = f["properties"]
    return Place(
        id=p["id"],
        kind=p.get("kind", "place"),
        type=p["type"],
        name=p["name"],
        aliases=p.get("aliases", []),
        coord=f["geometry"]["coordinates"],
        node_id=p.get("node_id"),
        node_inferred=bool(p.get("node_inferred", False)),
        entrance_ids=p.get("entrance_ids", []),
        claims=p.get("claims") or {},
    )


def load_world(data_dir: Path, config_dir: Path | None = None) -> World:
    site = Site.model_validate_json((data_dir / "site.json").read_text(encoding="utf-8"))
    edges = {e.id: e for e in map(_edge, _fc(data_dir / "base/walk.geojson"))}
    places = {p.id: p for p in map(_place, _fc(data_dir / "base/places.geojson"))}
    for f in _fc(data_dir / "access/overlay.geojson"):
        if f["geometry"]["type"] == "LineString":
            e = _edge(f)
            edges[e.id] = e
        else:
            p = _place(f)
            places[p.id] = p
    g = nx.MultiGraph()
    coords: dict[str, list[float]] = {}
    for e in edges.values():
        coords[e.from_node] = e.coords[0]
        coords[e.to_node] = e.coords[-1]
        g.add_edge(e.from_node, e.to_node, key=e.id, edge_id=e.id)
    flood_path = data_dir / "flood/scenarios.json"
    flood = (
        FloodBundle.model_validate_json(flood_path.read_text(encoding="utf-8"))
        if flood_path.exists()
        else FloodBundle(scenarios=[])
    )
    water = {
        s.id: json.loads(p.read_text(encoding="utf-8"))
        for s in flood.scenarios
        if (p := data_dir / f"flood/{s.id}.geojson").exists()
    }
    centres = {}
    for f in _fc(data_dir / "flood/evac_centres.geojson"):
        props = f["properties"]
        centres[props["id"]] = EvacCentre(coord=f["geometry"]["coordinates"], **props)
    waste = {}
    for f in _fc(data_dir / "waste/points.geojson"):
        props = f["properties"]
        waste[props["id"]] = WastePoint(coord=f["geometry"]["coordinates"], **props)
    by_node: dict[str, list[str]] = {}
    for p in places.values():
        if p.node_id:
            by_node.setdefault(p.node_id, []).append(p.id)
    return World(
        site,
        edges,
        places,
        coords,
        g,
        flood,
        water,
        centres,
        waste,
        load_profiles(config_dir),
        0,
        by_node,
        data_dir=data_dir,
    )
