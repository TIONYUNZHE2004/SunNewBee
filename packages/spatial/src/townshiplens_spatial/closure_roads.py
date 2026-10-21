"""Resolve a mapped road or a stretch between two mapped cross streets."""

import re
from collections import deque

from . import place_search

BETWEEN = re.compile(r"^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$", re.IGNORECASE)


def _name(names: dict[str, list[str]], query: str) -> str:
    hits = [n for n in names if place_search.normalise(n) == place_search.normalise(query)]
    if not hits:
        hits = [
            n
            for n in names
            if place_search.match(query, [n]) in (place_search.WORDS, place_search.TYPO)
        ]
    if not hits:
        raise ValueError(f"No mapped road is called {query!r}.")
    if len(hits) != 1:
        raise ValueError(f"Ambiguous road {query!r}: {', '.join(sorted(hits)[:5])}.")
    return hits[0]


def _nodes(world, ids):
    return {n for eid in ids for n in (world.edges[eid].from_node, world.edges[eid].to_node)}


def _stretch(world, names, road, a, b):
    starts = _nodes(world, names[road]) & _nodes(world, names[a])
    goals = _nodes(world, names[road]) & _nodes(world, names[b])
    if not starts or not goals:
        raise ValueError(f"{road} does not meet both {a} and {b} on the map.")
    links = {}
    for eid in names[road]:
        edge = world.edges[eid]
        links.setdefault(edge.from_node, []).append((edge.to_node, eid))
        links.setdefault(edge.to_node, []).append((edge.from_node, eid))
    queue = deque(sorted(starts))
    came = dict.fromkeys(queue)
    while queue:
        node = queue.popleft()
        if node in goals:
            path = []
            while came[node] is not None:
                node, eid = came[node]
                path.append(eid)
            if not path:
                raise ValueError("Cross streets must bound a nonempty mapped stretch.")
            return path[::-1]
        for nxt, eid in links.get(node, []):
            if nxt not in came:
                came[nxt] = node, eid
                queue.append(nxt)
    raise ValueError(f"No mapped stretch of {road} connects {a} and {b}.")


def resolve(world, road_names: list[str], segment_ids: list[str], limit: int) -> list[str]:
    if unknown := sorted(set(segment_ids) - world.edges.keys()):
        raise ValueError(f"unknown segments: {', '.join(unknown[:5])}")
    names = {}
    for edge in world.edges.values():
        if edge.name:
            names.setdefault(edge.name, []).append(edge.id)
    out = list(segment_ids)
    for query in road_names:
        if match := BETWEEN.match(query.strip()):
            road, a, b = (_name(names, part) for part in match.groups())
            out.extend(_stretch(world, names, road, a, b))
        else:
            out.extend(names[_name(names, query)])
    out = list(dict.fromkeys(out))
    if not out:
        raise ValueError("Name at least one mapped road or segment.")
    if len(out) > limit:
        raise ValueError(f"At most {limit} segments per scenario; name a shorter road stretch.")
    return out
