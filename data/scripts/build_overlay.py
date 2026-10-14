# ruff: noqa: E501
"""Build the deep-spot demo overlay (access/overlay.geojson + access/README.md).

All facts written here are PLACEHOLDERS (evidence_type "team_survey_placeholder") until the field visit.
"""

import json
import sys
from datetime import date
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts.import_osm import haversine  # noqa: E402

SEED = ROOT / "data" / "seed" / "elmina"
PLACEHOLDER = "team_survey_placeholder"
TODAY = date.today().isoformat()

LAKESIDE_MALL = (101.50990, 3.18133)
PLAYGROUND = (101.51053, 3.18077)
CAR_PARK_B = (101.5090, 3.1820)


def _load(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def _claim(value, status: str = "verified") -> dict:
    return {"value": value, "status": status, "evidence_type": PLACEHOLDER, "verified_at": TODAY}


def _dist(a, b) -> float:
    return haversine({"lon": a[0], "lat": a[1]}, {"lon": b[0], "lat": b[1]})


def drop_duplicates(base_places: list[dict], overlay_places: list[dict], radius_m: float = 25.0):
    """Remove base places of the same type within radius_m of an overlay place.

    Returns (kept_base_places, removed_ids).
    """
    removed = set()
    for o in overlay_places:
        for b in base_places:
            if (
                b["properties"]["type"] == o["properties"]["type"]
                and _dist(b["geometry"]["coordinates"], o["geometry"]["coordinates"]) <= radius_m
            ):
                removed.add(b["properties"]["id"])
    kept = [b for b in base_places if b["properties"]["id"] not in removed]
    return kept, sorted(removed)


def merge_claims(existing: dict, new: dict) -> dict:
    """Overlay claims win per key; other existing claims (surface, lit, ...) are kept."""
    return {**existing, **new}


def _place(pid, ptype, name, lonlat, node_id, claims=None, aliases=None) -> dict:
    return {
        "type": "Feature",
        "properties": {
            "id": pid,
            "kind": "place",
            "type": ptype,
            "name": name,
            "aliases": aliases or [],
            "node_id": node_id,
            "entrance_ids": [],
            "claims": claims or {},
        },
        "geometry": {"type": "Point", "coordinates": [round(lonlat[0], 6), round(lonlat[1], 6)]},
    }


def main() -> None:
    walk = _load(SEED / "base" / "walk.geojson")
    base_places = _load(SEED / "base" / "places.geojson")

    g = nx.Graph()
    pos: dict[str, tuple[float, float]] = {}
    for f in walk:
        p, c = f["properties"], f["geometry"]["coordinates"]
        pos[p["from"]], pos[p["to"]] = tuple(c[0]), tuple(c[-1])
        if g.has_edge(p["from"], p["to"]) and g[p["from"]][p["to"]]["length_m"] <= p["length_m"]:
            continue
        g.add_edge(p["from"], p["to"], length_m=p["length_m"], id=p["id"])
    by_id = {f["properties"]["id"]: f for f in walk}

    # Largest connected component only (the demo must be routable).
    comp = max(nx.connected_components(g), key=len)

    def nearest_node_cc(lonlat, max_m=80.0):
        cands = [n for n in comp]
        best = min(cands, key=lambda n: _dist(pos[n], lonlat))
        return best if _dist(pos[best], lonlat) <= max_m else None

    # park-b: the OSM parking nearest the research point, else a new point there.
    parkings = [f for f in base_places if f["properties"]["type"] == "parking"]
    parkings.sort(key=lambda f: _dist(f["geometry"]["coordinates"], CAR_PARK_B))
    candidates = [tuple(f["geometry"]["coordinates"]) for f in parkings[:5]] or [CAR_PARK_B]

    dest_node = nearest_node_cc(PLAYGROUND)
    if dest_node is None:
        sys.exit("ERROR: no walk node within 80 m of the playground; adjust coordinates")

    chosen = None
    for k, cand in enumerate(candidates):
        src = nearest_node_cc(cand)
        if src is None or src == dest_node:
            continue
        path = nx.shortest_path(g, src, dest_node, weight="length_m")
        if len(path) - 1 >= 3:
            chosen = (cand, src, path)
            if k:
                print(
                    f"WARNING: nearest parking gave a short route; using alternative parking #{k}"
                )
            break
    if chosen is None:
        sys.exit("ERROR: no park-b candidate gives a P1 of at least 3 edges; adjust coordinates")
    parkb_ll, src, p1_nodes = chosen

    def edges_of(nodes):
        return [g[a][b]["id"] for a, b in zip(nodes, nodes[1:], strict=False)]

    def plen(nodes):
        return sum(g[a][b]["length_m"] for a, b in zip(nodes, nodes[1:], strict=False))

    p1 = edges_of(p1_nodes)
    x_id = p1[len(p1) // 2]
    xa, xb = p1_nodes[len(p1) // 2], p1_nodes[len(p1) // 2 + 1]

    h = g.copy()
    h.remove_edge(xa, xb)
    try:
        p2_nodes = nx.shortest_path(h, src, dest_node, weight="length_m")
    except nx.NetworkXNoPath:
        sys.exit("ERROR: no detour P2 avoiding the middle edge; adjust coordinates")
    if plen(p2_nodes) > 3 * plen(p1_nodes):
        sys.exit("ERROR: detour P2 longer than 3x P1; adjust coordinates")
    p2 = edges_of(p2_nodes)

    # Overlay edges.
    changed: dict[str, dict] = {}
    for eid in set(p1) | set(p2):
        f = json.loads(json.dumps(by_id[eid]))
        pr = f["properties"]
        if pr["type"] == "steps":
            sys.exit(
                f"ERROR: {eid} is steps in OSM; route search must avoid steps. Adjust coordinates"
            )
        if eid == x_id:
            pr["type"] = "ramp"
            pr["claims"] = merge_claims(
                pr.get("claims", {}),
                {
                    "step_count": _claim(0),
                    "width_m": _claim(1.4),
                    "incline_pct": {
                        "value": None,
                        "status": "unknown",
                        "evidence_type": PLACEHOLDER,
                    },
                },
            )
        else:
            pr["claims"] = merge_claims(
                pr.get("claims", {}),
                {
                    "step_count": _claim(0),
                    "incline_pct": _claim(3),
                    "width_m": _claim(1.5),
                },
            )
        changed[eid] = f

    # Overlay places.
    mid_nodes = [n for n in p1_nodes[1:-1]] or p1_nodes
    pick = lambda frac: mid_nodes[min(len(mid_nodes) - 1, int(frac * len(mid_nodes)))]  # noqa: E731
    ph = lambda v: _claim(v)  # noqa: E731
    places = [
        _place(
            "park-b",
            "parking",
            "Lakeside Mall Car Park B",
            parkb_ll,
            src,
            aliases=["Car Park B", "Parking B"],
        ),
        _place(
            "lakeside-mall",
            "mall",
            "Elmina Lakeside Mall",
            LAKESIDE_MALL,
            nearest_node_cc(LAKESIDE_MALL),
            aliases=["Lakeside Mall"],
        ),
        _place(
            "playground",
            "playground",
            "Urban Park playground",
            PLAYGROUND,
            dest_node,
            aliases=["Elmina Urban Park playground"],
        ),
        _place(
            "toilet-urban-park",
            "toilet",
            "Urban Park toilet",
            pos[pick(0.9)],
            pick(0.9),
            claims={
                "wheelchair": {"value": None, "status": "unknown", "evidence_type": PLACEHOLDER}
            },
        ),
    ]
    for i, frac in enumerate((0.2, 0.5, 0.8), start=1):
        n = pick(frac)
        places.append(
            _place(
                f"bench-urban-{i}",
                "seating",
                f"Urban Park bench {i}",
                pos[n],
                n,
                claims={"seating": ph(True)},
            )
        )

    kept, removed = drop_duplicates(base_places, places)
    write = json.dumps(
        {"type": "FeatureCollection", "features": kept}, ensure_ascii=False, separators=(",", ":")
    )
    (SEED / "base" / "places.geojson").write_text(write, encoding="utf-8")
    features = list(changed.values()) + places
    out = SEED / "access"
    out.mkdir(parents=True, exist_ok=True)
    (out / "overlay.geojson").write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    p1_len, p2_len = plen(p1_nodes), plen(p2_nodes)
    (out / "README.md").write_text(
        "# Access overlay (deep spot: Elmina Urban Park)\n\n"
        "Demo facts are placeholders until the field visit "
        f'(`evidence_type: "{PLACEHOLDER}"`, dated {TODAY}). '
        f"Unknown ramp: `{x_id}`. Confirmed path P2 length: `{p2_len:.0f}` m; shorter path via ramp: `{p1_len:.0f}` m.\n\n"
        f"- Route `park-b` -> `playground`: P1 ({len(p1)} edges) goes through `{x_id}` whose `incline_pct` is unknown.\n"
        f"- P2 ({len(p2)} edges) avoids it; every edge has verified placeholder claims (0 steps, 3 % incline, 1.5 m).\n"
        f"- Removed duplicate OSM places (same type within 25 m of an overlay place): {', '.join(removed) or 'none'}\n"
        f"- P1 edges: {', '.join(p1)}\n- P2 edges: {', '.join(p2)}\n",
        encoding="utf-8",
    )
    print(
        f"P1 len {p1_len:.0f} m ({len(p1)} edges), P2 len {p2_len:.0f} m ({len(p2)} edges), unknown ramp {x_id}"
    )
    print(f"removed duplicate base places: {removed}")
    print(f"overlay features: {len(changed)} edges, {len(places)} places")


if __name__ == "__main__":
    main()
