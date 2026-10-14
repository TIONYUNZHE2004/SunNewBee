from pathlib import Path

TINY = Path(__file__).parent / "fixtures" / "tiny"


def add_roads(world):
    """Road spur n-x -street- n-y -track- n-z north of the footway network (~55 m off it).

    Every original node is footway-only: park-b (n-a) is ~55 m from n-x, the playground (n-d)
    ~78 m from n-z, the hall centre (n-c) ~55 m from n-y; island-hut (n-h) is > 150 m from any
    road. park-c is a car park sitting on the road node n-z.
    """
    from townshiplens_spatial.models import Edge, Place

    nodes = {"n-x": [101.509, 3.1815], "n-y": [101.510, 3.1815], "n-z": [101.5105, 3.1815]}
    world.node_coords.update(nodes)
    spec = [("rd-1", "street", "n-x", "n-y", 110.0), ("rd-2", "track", "n-y", "n-z", 55.0)]
    for eid, typ, a, b, ln in spec:
        e = Edge(
            id=eid,
            type=typ,
            from_node=a,
            to_node=b,
            coords=[nodes[a], nodes[b]],
            length_m=ln,
        )
        world.edges[eid] = e
        world.graph.add_edge(a, b, key=eid, edge_id=eid)
    p = Place(id="park-c", type="parking", name="Car Park C", coord=nodes["n-z"], node_id="n-z")
    world.places["park-c"] = p
    world._place_by_node.setdefault("n-z", []).append("park-c")
