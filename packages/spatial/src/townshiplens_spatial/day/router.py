"""Fast many-trip routing for Elmina Day (Cycle 10).

`routing.plan_route` answers one question at a time (about 20 ms on the seed). A simulated day
routes tens of thousands of legs, so this router builds, once per (world state, persona,
river stage), an array of edge costs with *the same rules* as `routing.make_weight` (the edge
evaluator, the UNKNOWN penalty, the steps multiplier). It then runs scipy's multi-source
Dijkstra once per destination: one "field" gives every resident's shortest path to that
destination (about 1.5 ms on the 11,752-node seed graph).

Lenient routing, as a resident would walk: unchecked (UNKNOWN) paths may be used, at the same
penalty as `plan_route`'s lenient pass, and every leg reports how many unchecked stretches it
crosses. A FAIL (steps for a wheelchair, a likely-flooded path, a staff closure) is never used.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from ..evaluate import evaluate_edge
from ..routing import UNKNOWN_WEIGHT, _flood_class
from ..world import World


@dataclass
class Leg:
    nodes: list[int]  # node indices into Router.nodes
    edge_ids: list[str]
    length_m: float
    unknown: int  # unchecked stretches crossed (UNKNOWN edges)
    edge_len: list[float]  # per edge, in order
    edge_unknown: list[bool]  # per edge, in order


class Graph:
    """Node indexing shared by every router built on one world (the topology never changes)."""

    def __init__(self, world: World):
        self.nodes: list[str] = list(world.graph.nodes)
        self.index = {n: i for i, n in enumerate(self.nodes)}
        self.coords = np.array([world.node_coords[n] for n in self.nodes], dtype=float)
        self.edges = list(world.edges.values())
        self.u = np.array([self.index[e.from_node] for e in self.edges])
        self.v = np.array([self.index[e.to_node] for e in self.edges])
        self.length = np.array([e.length_m for e in self.edges], dtype=float)


class Router:
    """Shortest paths for one persona in one world state (stage = river scenario id or None)."""

    def __init__(
        self,
        world: World,
        graph: Graph,
        profile_id: str,
        stage: str | None,
        now: datetime | None = None,
        fields: OrderedDict | None = None,
        max_fields: int = 400,
    ):
        self.world, self.graph, self.stage = world, graph, stage
        prof = world.profiles[profile_id]
        self.profile_id = profile_id
        g = graph
        n_e = len(g.edges)
        cost = np.full(n_e, np.inf)
        unknown = np.zeros(n_e, dtype=bool)
        # Edges are looked up in `world` (an imagined world from twm.apply has its own copies).
        for i, e0 in enumerate(g.edges):
            e = world.edges.get(e0.id, e0)
            # Staff closures are evaluated at the rehearsal's own moment, not the wall clock.
            res, _ = evaluate_edge(e, prof, _flood_class(world, stage, e.id), now=now)
            if res == "FAIL":
                continue
            c = e.length_m * (UNKNOWN_WEIGHT if res == "UNKNOWN" else 1.0)
            if e.type == "steps":
                c *= prof.soft.get("steps_multiplier", 1.0)
            cost[i] = c
            unknown[i] = res == "UNKNOWN"
        self.edge_cost, self.edge_unknown = cost, unknown
        ok = np.isfinite(cost)
        a = np.minimum(g.u, g.v)[ok]
        b = np.maximum(g.u, g.v)[ok]
        c = cost[ok]
        eid = np.flatnonzero(ok)
        order = np.lexsort((c, b, a))  # cheapest parallel edge per node pair first
        a, b, c, eid = a[order], b[order], c[order], eid[order]
        keep = np.ones(len(a), dtype=bool)
        keep[1:] = (a[1:] != a[:-1]) | (b[1:] != b[:-1])
        a, b, c, eid = a[keep], b[keep], c[keep], eid[keep]
        n = len(g.nodes)
        # scipy treats an explicit 0 as "no edge": a zero-length edge gets a tiny cost.
        cc = np.maximum(c, 1e-6)
        self.matrix = csr_matrix((np.r_[cc, cc], (np.r_[a, b], np.r_[b, a])), shape=(n, n))
        self.pair_edge = {(int(x), int(y)): int(k) for x, y, k in zip(a, b, eid, strict=True)}
        self.usable_nodes = np.zeros(n, dtype=bool)
        self.usable_nodes[a] = True
        self.usable_nodes[b] = True
        # Shortest-path fields, shared LRU across a day's routers (memory: ~8 bytes per node per
        # field as float32 + int32, so 400 fields on the seed are about 38 MB).
        self._fields = fields if fields is not None else OrderedDict()
        self._max_fields = max_fields
        self._key = (profile_id, stage, id(world))

    def field(self, targets: tuple[int, ...]) -> tuple[np.ndarray, np.ndarray]:
        """(cost to the nearest target, predecessor towards it) for every node."""
        key = (self._key, tuple(sorted(set(targets))))
        hit = self._fields.get(key)
        if hit is not None:
            self._fields.move_to_end(key)
            return hit
        d, pred, _ = dijkstra(
            self.matrix,
            directed=False,
            indices=list(key[1]),
            min_only=True,
            return_predecessors=True,
        )
        hit = self._fields[key] = (d.astype(np.float32), pred.astype(np.int32))
        while len(self._fields) > self._max_fields:
            self._fields.popitem(last=False)
        return hit

    def leg(self, src: int, targets: tuple[int, ...]) -> Leg | None:
        """The path from `src` to the nearest target, or None when every way is cut."""
        d, pred = self.field(targets)
        if not np.isfinite(d[src]):
            return None
        nodes = [src]
        tset = set(targets)
        while nodes[-1] not in tset:
            p = int(pred[nodes[-1]])
            if p < 0:
                return None
            nodes.append(p)
        eids, lens, unk = [], [], []
        for x, y in zip(nodes, nodes[1:], strict=False):
            k = self.pair_edge[(min(x, y), max(x, y))]
            e = self.graph.edges[k]
            eids.append(e.id)
            lens.append(e.length_m)
            unk.append(bool(self.edge_unknown[k]))
        return Leg(
            nodes=nodes,
            edge_ids=eids,
            length_m=float(sum(lens)),
            unknown=int(sum(unk)),
            edge_len=lens,
            edge_unknown=unk,
        )

    def passable(self, edge_ids: list[str]) -> bool:
        """Every edge of a planned leg is still usable in this state."""
        pos = self._pos()
        return all(np.isfinite(self.edge_cost[pos[e]]) for e in edge_ids)

    def _pos(self) -> dict[str, int]:
        if not hasattr(self, "_edge_pos"):
            self._edge_pos = {e.id: i for i, e in enumerate(self.graph.edges)}
        return self._edge_pos
