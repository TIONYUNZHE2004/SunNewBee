# ruff: noqa: E501
"""Build the deep-spot demo overlay (access/overlay.geojson + access/README.md).

All facts written here are PLACEHOLDERS (evidence_type "team_survey_placeholder") until the field visit.
"""

import argparse
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
# Fixed, not date.today(): a re-run must reproduce overlay.geojson byte for byte (AC-B14). It is
# the date the P1/P2 placeholders were first written; placeholders are not survey dates.
PLACEHOLDER_DATE = "2026-10-18"
TODAY = PLACEHOLDER_DATE

# ---- Demo corridor (demo polish B5, spec 5.2): navigation compare, fastest vs wheelchair.
# The only three real OSM highway=steps edges in the walk layer.
STEPS_EDGES = ("seg-1346147887-0", "seg-1323093125-0", "seg-430198556-0")
STEP_COUNT_N = 3  # a short flight; never steps where OSM has none
# OSM highway=footway (incl. footway=sidewalk / crossing), path, pedestrian.
FOOT_TYPES = frozenset({"footway", "sidewalk", "crossing", "path", "pedestrian", "ramp"})
UNCHECKED_MIN_M, UNCHECKED_MAX_M = 30.0, 60.0
UNCHECKED_FRACTION = (13.6 - 3) / 26  # spec 5.4: the "? Not checked yet" beat


def unchecked_run(world, route) -> dict | None:
    """The run of whole edges (30-60 m, no crossing/steps/major road, not the first or last
    edge) whose start is nearest UNCHECKED_FRACTION of the route. None when there is none."""
    edges = [world.edges[s.edge_id] for s in route.segments]
    starts, at = [], 0.0
    for e in edges:
        starts.append(at)
        at += e.length_m
    ok = [e.type not in ("crossing", "steps", "major_road") for e in edges]
    best = None
    for i in range(1, len(edges) - 1):
        total = 0.0
        for j in range(i, len(edges) - 1):
            if not ok[j] or edges[j].id in {x.id for x in edges[i:j]}:
                break
            total += edges[j].length_m
            if total > UNCHECKED_MAX_M:
                break
            if total >= UNCHECKED_MIN_M:
                key = (abs(starts[i] / at - UNCHECKED_FRACTION), i, j)
                if best is None or key < best[0]:
                    best = (key, i, j, total)
                break
    if best is None:
        return None
    _, i, j, total = best
    return {
        "edge_ids": [e.id for e in edges[i : j + 1]],
        "start_m": round(starts[i], 1),
        "length_m": round(total, 1),
        "fraction": round(starts[i] / at, 2),
    }


LAKESIDE_MALL = (101.50990, 3.18133)
PLAYGROUND = (101.51053, 3.18077)
CAR_PARK_B = (101.5090, 3.1820)
# The OSM parking the first build chose for park-b. That build removes it from base/places.geojson
# as a duplicate of park-b, so a re-run must still offer it, or park-b (and P1/P2) would move.
PARK_B_LL = (101.50879, 3.181345)


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
            # The existence/position of these demo places is not a field observation.
            # Keep it explicit even when a place has no accessibility attributes.
            "claims": {
                "existence": {"value": True, "status": "unknown", "evidence_type": PLACEHOLDER},
                **(claims or {}),
            },
        },
        "geometry": {"type": "Point", "coordinates": [round(lonlat[0], 6), round(lonlat[1], 6)]},
    }


def add_existence_provenance(features: list[dict]) -> int:
    """Metadata-only regeneration for an existing overlay; preserve surveyed replacements."""
    added = 0
    for feature in features:
        if feature["geometry"]["type"] != "Point":
            continue
        claims = feature["properties"].setdefault("claims", {})
        if "existence" not in claims:
            claims["existence"] = {"value": True, "status": "unknown", "evidence_type": PLACEHOLDER}
            added += 1
    return added


def regenerate_provenance() -> None:
    """No OSM/network/DEM rebuild: this operation never changes coordinates or graph claims."""
    path = SEED / "access" / "overlay.geojson"
    payload = json.loads(path.read_text(encoding="utf-8"))
    added = add_existence_provenance(payload["features"])
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Added placeholder existence provenance to {added} overlay places; geometry unchanged")


# ---------------------------------------------------------------- demo corridor (B5)
#
# Ruling (B5, see the be-nav report): the pair below came from data/scripts/pick_demo_corridor.py.
# Its fastest walk crosses the real OSM steps seg-1346147887-0, and the wheelchair route
# detours around them. All values are placeholders ("Demo value · not surveyed"). They are
# verified + dated like the P1/P2 placeholders, so the evaluator treats them as known (the
# compare reasons only count known facts), and a field survey can replace them with no code change.
DEMO_CORRIDOR = {
    "from": "lakeside-mall",  # Elmina Lakeside Mall
    "to": "osm-way-910487880",  # Surau Kiambang
    "profile": "wheelchair",
}
COVERED_FRACTION = (4.5 - 3) / 26  # spec 5.4 beat times -> fraction of the recommended route
INCLINE_FRACTION = (10.3 - 3) / 26
COVERED_RUN_M = 200.0  # a covered link-way leaving the mall
STEEPEST_INCLINE_PCT = 4.5  # within the wheelchair limit (8.3 %)
STEPS_WIDTH_M = 1.5
CROSSING_WIDTH_M = 3.0
STREET_WIDTH_M = 6.0  # a residential carriageway
SEATING_NEAR_M = 15.0  # same radius as compare.SEATING_NEAR_M
_INCLINES = (0.5, 1.0, 1.5, 2.0, 2.5)
_FOOT_WIDTHS = (1.2, 1.5, 1.5, 1.8, 2.0)


def _pick(edge_id: str, options: tuple):
    """Deterministic per-edge choice (sha1, never Python's salted hash)."""
    import hashlib

    return options[int(hashlib.sha1(edge_id.encode()).hexdigest()[:8], 16) % len(options)]


def _write_overlay(features: list[dict]) -> None:
    (SEED / "access" / "overlay.geojson").write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def _corridor_compare():
    from townshiplens_spatial.compare import compare
    from townshiplens_spatial.world import load_world

    world = load_world(SEED)
    c = DEMO_CORRIDOR
    return world, compare(world, c["from"], c["to"], c["profile"])


def _nearest_start(cands: list[tuple[float, str]], target_m: float) -> str | None:
    return min(cands, key=lambda c: (abs(c[0] - target_m), c[1]))[1] if cands else None


def build_corridor(by_id: dict, changed: dict) -> tuple[list[dict], dict]:
    """Placeholder claims for every edge of both demo routes. Returns (new edge features, info).

    The routes do not depend on these claims: compare() never weighs unknown facts (R20) and
    every value written here passes the wheelchair limits, except the steps (already a FAIL).
    Edges already in P1/P2 keep their claims; the corridor only adds attributes they lack."""
    world, r = _corridor_compare()
    if r.recommended is None or r.stop is None or r.stop.edge_id not in STEPS_EDGES:
        sys.exit(f"ERROR: demo corridor {DEMO_CORRIDOR} no longer crosses a steps edge")
    rec = r.recommended
    run = unchecked_run(world, rec)
    if run is None:
        sys.exit("ERROR: demo corridor has no 30-60 m stretch for the unchecked incline")
    unchecked = set(run["edge_ids"])
    starts, at = [], 0.0
    for s in rec.segments:
        starts.append((at, s.edge_id))
        at += world.edges[s.edge_id].length_m

    def plain_foot(eid):
        e = world.edges[eid]
        return e.type in FOOT_TYPES and e.type not in ("crossing", "ramp")

    covered: set[str] = set()
    first = _nearest_start(
        [(a, e) for a, e in starts if plain_foot(e)], COVERED_FRACTION * rec.distance_m
    )
    ids = [e for _, e in starts]
    if first is not None:
        run_m = 0.0
        for eid in ids[ids.index(first) :]:
            if not plain_foot(eid) or run_m >= COVERED_RUN_M:
                break
            covered.add(eid)
            run_m += world.edges[eid].length_m
    steepest = _nearest_start(
        [(a, e) for a, e in starts if plain_foot(e) and e not in unchecked],
        INCLINE_FRACTION * rec.distance_m,
    )

    out: list[dict] = []
    route_edges = list(dict.fromkeys(ids + [s.edge_id for s in r.fastest.segments]))
    for eid in route_edges:
        e = world.edges[eid]
        c: dict = {}
        if e.type == "steps":
            c["step_count"] = _claim(STEP_COUNT_N)
            c["width_m"] = _claim(STEPS_WIDTH_M)
        else:
            c["step_count"] = _claim(0)
            if eid in unchecked:
                c["incline_pct"] = {
                    "value": None,
                    "status": "unknown",
                    "evidence_type": PLACEHOLDER,
                }
            else:
                c["incline_pct"] = _claim(
                    STEEPEST_INCLINE_PCT if eid == steepest else _pick(eid, _INCLINES)
                )
            if e.type == "crossing":
                c["width_m"] = _claim(CROSSING_WIDTH_M)
                c["kerb"] = _claim("lowered")
            elif e.type == "major_road":
                pass  # Task 31: a major road's carriageway width is never a walking width
            elif e.type == "street":
                c["width_m"] = _claim(STREET_WIDTH_M)
            else:
                c["width_m"] = _claim(_pick(eid, _FOOT_WIDTHS))
        osm_covered = (old := e.claims.get("covered")) is not None and old.value in (True, "yes")
        c["covered"] = _claim(eid in covered or osm_covered)
        if eid in changed:
            pr = changed[eid]["properties"]
            pr["claims"] = {**c, **pr["claims"]}  # P1/P2 values win; only missing keys added
            continue
        f = json.loads(json.dumps(by_id[eid]))
        f["properties"]["claims"] = merge_claims(f["properties"].get("claims", {}), c)
        out.append(f)

    # Real OSM benches only (never invented): within SEATING_NEAR_M of the recommended route.
    seating = []
    from townshiplens_spatial.compare import _project

    near = _project(rec)
    for p in sorted(world.places.values(), key=lambda p: p.id):
        if p.type == "seating" and p.id.startswith("osm-") and near(p.coord)[0] <= SEATING_NEAR_M:
            seating.append(p.id)
    if seating:
        sys.exit(
            f"ERROR: OSM benches {seating} are on the corridor; add them as overlay places with a "
            "seating placeholder before using this pair"
        )
    info = {
        **DEMO_CORRIDOR,
        "steps_edge": r.stop.edge_id,
        "unchecked_edges": run["edge_ids"],
        "covered_edges": [e for e in ids if e in covered],
        "steepest_edge": steepest,
        "seating": seating,
        "edges": len(route_edges),
    }
    return out, info


def check_corridor(info: dict) -> None:
    """AC-B13 on the written overlay; fills the numbers into `info`, exits on a miss."""
    from townshiplens_spatial.compare import _known

    world, r = _corridor_compare()
    rec, fast = r.recommended, r.fastest
    prof = world.profiles[DEMO_CORRIDOR["profile"]]
    errors = []
    if r.same_path or r.stop is None or r.stop.edge_id != info["steps_edge"]:
        errors.append(f"stop is not the steps edge: {r.stop}")
    elif r.stop.attribute != "step_count" or r.stop.value != STEP_COUNT_N:
        errors.append(f"stop is not step_count={STEP_COUNT_N}: {r.stop}")
    if not (fast.distance_m < rec.distance_m and fast.est_minutes < rec.est_minutes):
        errors.append("fastest is not strictly shorter")
    if not 1.0 <= (r.extra_minutes or 0) <= 4.0:
        errors.append(f"extra minutes {r.extra_minutes} not in 1-4")
    if len(r.unchecked) != 1:
        errors.append(f"expected exactly one unchecked stretch, got {r.unchecked}")
    else:
        u = r.unchecked[0]
        if u.attribute != "incline_pct" or not UNCHECKED_MIN_M <= u.length_m <= UNCHECKED_MAX_M:
            errors.append(f"unchecked stretch is not a 30-60 m incline: {u}")
    edges = [world.edges[s.edge_id] for s in rec.segments]
    foot = sum(e.length_m for e in edges if e.type in FOOT_TYPES) / rec.distance_m
    if foot < 0.6:
        errors.append(f"footway share {foot:.2f} < 0.6")
    ev = {e.id: e for e in r.evidence}
    today = date.today()
    for e in edges:
        if e.id in info["unchecked_edges"]:
            continue
        for attr in ("step_count", "incline_pct", "width_m"):
            if _known(e, attr, prof, today, ev) is None:
                errors.append(f"{e.id}.{attr} not known")
    if errors:
        sys.exit("ERROR: demo corridor fails AC-B13:\n  " + "\n  ".join(errors))
    info.update(
        fast_m=fast.distance_m,
        fast_min=fast.est_minutes,
        rec_m=rec.distance_m,
        rec_min=rec.est_minutes,
        extra_min=r.extra_minutes,
        stop_edge=r.stop.edge_id,
        stop_at_m=r.stop.at_m,
        unchecked=r.unchecked[0].model_dump(),
        foot_share=round(foot, 2),
        pois=[(p.kind, p.at_m) for p in r.pois],
    )


def corridor_readme(info: dict) -> str:
    u = info["unchecked"]
    return (
        "## Demo corridor (navigation compare, demo polish B5)\n\n"
        f"Route `{info['from']}` -> `{info['to']}`, profile `{info['profile']}`. "
        f"Fastest walk {info['fast_m']:.0f} m / {info['fast_min']} min crosses the real OSM steps "
        f"`{info['steps_edge']}` (placeholder `step_count` {STEP_COUNT_N}) at {info['stop_at_m']:.0f} m. "
        f"Wheelchair route {info['rec_m']:.0f} m / {info['rec_min']} min (+{info['extra_min']} min), "
        f"{info['foot_share']:.0%} footway/path by length.\n\n"
        f"- {info['edges']} edges of both routes carry placeholder `step_count`, `incline_pct`, "
        "`width_m`, `covered` and (crossings) `kerb` claims; values are deterministic per edge.\n"
        f"- Unchecked on purpose: `incline_pct` on `{', '.join(info['unchecked_edges'])}` "
        f"({u['length_m']:.0f} m from {u['start_m']:.0f} m).\n"
        f"- Covered (placeholder): {', '.join(info['covered_edges']) or 'none'}. "
        f"Steepest incline ({STEEPEST_INCLINE_PCT} %): `{info['steepest_edge']}`.\n"
        f"- Seating: {', '.join(info['seating']) or 'no OSM bench within 15 m, so none is claimed'}.\n"
    )


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
    candidates = sorted(
        dict.fromkeys([*candidates, PARK_B_LL]), key=lambda ll: _dist(ll, CAR_PARK_B)
    )[:5]

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
    for eid in sorted(set(p1) | set(p2)):
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
    # Trailing newline as cleanup_places.py writes it, so a re-run leaves the file unchanged.
    (SEED / "base" / "places.geojson").write_text(write + "\n", encoding="utf-8", newline="\n")
    out = SEED / "access"
    out.mkdir(parents=True, exist_ok=True)
    # P1/P2 first: the corridor is planned on the world with exactly this overlay (never on a
    # previous run's corridor claims), then the whole overlay is written once more.
    _write_overlay(list(changed.values()) + places)
    corridor_edges, corridor_info = build_corridor(by_id, changed)
    _write_overlay(list(changed.values()) + corridor_edges + places)
    check_corridor(corridor_info)
    readme = out / "README.md"
    if readme.exists():
        for line in readme.read_text(encoding="utf-8").splitlines():
            if line.startswith("- Removed duplicate OSM places") and ": " in line:
                listed = line.split(": ", 1)[1]
                if listed != "none":
                    removed = sorted(set(removed) | set(listed.split(", ")))

    p1_len, p2_len = plen(p1_nodes), plen(p2_nodes)
    (out / "README.md").write_text(
        "# Access overlay (deep spot: Elmina Urban Park)\n\n"
        "Demo facts are placeholders until the field visit "
        f'(`evidence_type: "{PLACEHOLDER}"`, dated {TODAY}). '
        f"Unknown ramp: `{x_id}`. Confirmed path P2 length: `{p2_len:.0f}` m; shorter path via ramp: `{p1_len:.0f}` m.\n\n"
        f"- Route `park-b` -> `playground`: P1 ({len(p1)} edges) goes through `{x_id}` whose `incline_pct` is unknown.\n"
        f"- P2 ({len(p2)} edges) avoids it; every edge has verified placeholder claims (0 steps, 3 % incline, 1.5 m).\n"
        f"- Removed duplicate OSM places (same type within 25 m of an overlay place): {', '.join(removed) or 'none'}\n"
        f"- P1 edges: {', '.join(p1)}\n- P2 edges: {', '.join(p2)}\n\n"
        + corridor_readme(corridor_info),
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"P1 len {p1_len:.0f} m ({len(p1)} edges), P2 len {p2_len:.0f} m ({len(p2)} edges), unknown ramp {x_id}"
    )
    print(f"removed duplicate base places: {removed}")
    print(f"overlay features: {len(changed) + len(corridor_edges)} edges, {len(places)} places")
    print(
        "demo corridor {from} -> {to}: fastest {fast_m} m / {fast_min} min, wheelchair "
        "{rec_m} m / {rec_min} min (+{extra_min} min), stop {stop_edge} at {stop_at_m} m, "
        "unchecked {unchecked}".format(**corridor_info)
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--provenance-only",
        action="store_true",
        help="regenerate missing place-existence metadata without rebuilding geometry",
    )
    args = parser.parse_args()
    if args.provenance_only:
        regenerate_provenance()
    else:
        main()
