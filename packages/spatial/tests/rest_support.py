"""Tiny-fixture helpers for the rest-point routing tests (Task 41).

A uniquely named module: `tests_support` exists in both the spatial and agent test folders, and
whichever is imported first wins in sys.modules.
"""


def add_edge(world, eid, a, b, length, like="seg-cd"):
    """A verified, step-free footway like `like`, between a and b (b may be a new node)."""
    world.node_coords.setdefault(b, list(world.node_coords[a]))
    e = world.edges[like].model_copy(
        deep=True,
        update={
            "id": eid,
            "from_node": a,
            "to_node": b,
            "length_m": length,
            "coords": [world.node_coords[a], world.node_coords[b]],
        },
    )
    world.edges[eid] = e
    world.graph.add_edge(a, b, key=eid, edge_id=eid)
    return e


VERIFIED = "verified"


def rest_claim(typ="seating", present=True, status=VERIFIED, verified_at=None):
    """The place's own rest claim: `seating` (bool) for seating, `shelter` (enum) for shelters."""
    from datetime import date

    from townshiplens_spatial.models import Claim

    if typ == "shelter":
        attr, value = "shelter", ("covered" if present else "none")
    else:
        attr, value = "seating", present
    if status == "unknown":
        value = None
    when = verified_at or (date.today().isoformat() if status == VERIFIED else None)
    return {attr: Claim(value=value, status=status, verified_at=when, evidence_type="test")}


def add_rest(world, pid, node, typ="seating", claims=VERIFIED):
    """A rest place at `node`. claims=VERIFIED: verified present today; None: OSM-only (no
    claims); a dict: those claims."""
    from townshiplens_spatial.models import Place

    if claims == VERIFIED:
        claims = rest_claim(typ)
    world.places[pid] = Place(
        id=pid,
        kind="amenity",
        type=typ,
        name=f"Rest {pid}",
        coord=world.node_coords[node],
        node_id=node,
        claims=claims or {},
    )
    world._place_by_node.setdefault(node, []).append(pid)


def rest_detour(world, typ="seating", claims=VERIFIED):
    """Tiny + a bench at n-b and a detour n-c -> n-r -> n-d (55 + 60 m) with a rest point at n-r.

    Shortest park-b -> playground is a-b-c-d (222.4 m); its last stretch c->d is 111.2 m without
    a rest point. The detour a-b-c-r-d is 226.2 m and never runs more than 60 m between rests.
    """
    add_rest(world, "bench-b", "n-b")
    add_edge(world, "seg-cr", "n-c", "n-r", 55.0)
    add_edge(world, "seg-rd", "n-r", "n-d", 60.0)
    add_rest(world, "rest-r", "n-r", typ, claims)


def detour_spur(world, spur_unknown=True):
    """Tiny with seg-cd split at n-m and a 5 m spur n-m -> n-r to a verified bench (review M-1).

    The only way to keep 100 m between rests is out and back along the spur:
    a-b-c-m-r-m-d (bench-b at n-b, bench-1 at n-c, rest-r at n-r).
    """
    from townshiplens_spatial.models import Claim

    world.graph.remove_edge("n-c", "n-d", key="seg-cd")
    del world.edges["seg-cd"]
    add_rest(world, "bench-b", "n-b")
    add_edge(world, "seg-cm", "n-c", "n-m", 55.6, like="seg-bc")
    add_edge(world, "seg-md", "n-m", "n-d", 55.6, like="seg-bc")
    add_edge(world, "seg-mr", "n-m", "n-r", 5.0, like="seg-bc")
    if spur_unknown:
        world.edges["seg-mr"].claims["incline_pct"] = Claim()
    add_rest(world, "rest-r", "n-r")
