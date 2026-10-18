# ruff: noqa: E501
"""Import the Elmina envelope from OSM (Overpass) into data/seed/elmina (walk, places, hydrology, site)."""

import contextlib
import json
import math
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import overpass  # noqa: E402

ENVELOPE = (3.150, 101.460, 3.240, 101.530)  # s, w, n, e
OUT = ROOT / "data" / "seed" / "elmina"

# Kept byte-identical: it is part of the cached Overpass query key (data/cache/<sha1>.json).
# secondary_link is fetched here too but typed major_road (see MAJOR_HIGHWAYS).
WALK_HIGHWAYS = (
    "footway|path|pedestrian|steps|crossing|living_street|residential|service|unclassified|"
    "tertiary|secondary_link|tertiary_link|track"
)
# Task 31 / ruling R22: the roads that join Elmina's neighbourhoods. Pedestrians use their
# sidewalks or verges, so they are walk edges of type `major_road`; motorways stay excluded.
MAJOR_HIGHWAYS = (
    "primary",
    "secondary",
    "trunk",
    "primary_link",
    "secondary_link",
    "trunk_link",
)
STREET_TYPES = {
    "residential",
    "service",
    "unclassified",
    "tertiary",
    "tertiary_link",
    "living_street",
}
AMENITIES = "toilets|bench|shelter|parking|school|community_centre|place_of_worship|townhall|clinic|recycling|waste_basket"
PLACE_TYPE_MAP = {"bench": "seating", "toilets": "toilet"}
OSM = "osm_import"


def haversine(a: dict, b: dict) -> float:
    r = 6371008.8
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dphi = p2 - p1
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _claim(value, evidence: str = OSM) -> dict:
    return {"value": value, "status": "reported", "evidence_type": evidence}


def _parse_float(text: str) -> float | None:
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)", text or "")
    return float(m.group(1).replace(",", ".")) if m else None


_SIDE_VALUES = {"yes": "yes", "no": "no", "none": "no", "separate": "separate"}
_SIDEWALK_SIDES = {
    "both": ("yes", "yes"),
    "left": ("yes", "no"),
    "right": ("no", "yes"),
    "no": ("no", "no"),
    "none": ("no", "no"),
    "separate": ("separate", "separate"),
}
SIDEWALK_KEYS = ("sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right")


def sidewalk_value(tags: dict) -> str | None:
    """OSM sidewalk tags -> both|one_side|none|separate, or None when the tags do not say.

    Side-specific tags refine the general ones. `sidewalk=yes` only says "at least one side",
    so it gives a value only when the other side is known to have none. Never guesses a side.
    """
    general = tags.get("sidewalk")
    left, right = _SIDEWALK_SIDES.get(general, (None, None))
    at_least_one = general == "yes"
    both = _SIDE_VALUES.get(tags.get("sidewalk:both", ""))
    if both:
        left = right = both
    left = _SIDE_VALUES.get(tags.get("sidewalk:left", ""), left)
    right = _SIDE_VALUES.get(tags.get("sidewalk:right", ""), right)
    if at_least_one and (left, right).count(None) == 1 and "no" in (left, right):
        left, right = (left or "yes"), (right or "yes")
    if left is None or right is None:
        return None
    sides = (left, right)
    if sides == ("yes", "yes"):
        return "both"
    if "yes" in sides:
        return "one_side"
    if "separate" in sides:
        return "separate"
    return "none"


def _sidewalk_claim(tags: dict) -> dict | None:
    value = sidewalk_value(tags)
    if value is None:
        return None
    raw = "; ".join(f"{k}={tags[k]}" for k in SIDEWALK_KEYS if k in tags)
    return {**_claim(value), "notes": f"OSM {raw}"}


# OSM crossing tags -> the catalogue's crossing type (traffic_signals|marked|unmarked|no).
_CROSSING = {
    "traffic_signals": "traffic_signals",
    "marked": "marked",
    "zebra": "marked",
    "uncontrolled": "marked",
    "unmarked": "unmarked",
    "informal": "unmarked",
    "no": "no",
}


def crossing_value(tags: dict) -> str | None:
    """The crossing type an OSM crossing way or node says, or None when its tags do not say.
    `crossing:signals=yes` means traffic lights whatever `crossing` says."""
    if tags.get("crossing:signals") == "yes" or tags.get("highway") == "traffic_signals":
        return "traffic_signals"
    if tags.get("crossing_ref") == "zebra":
        return "marked"
    return _CROSSING.get(tags.get("crossing", ""))


def _claims(tags: dict, seg_type: str) -> dict:
    claims: dict = {}
    if seg_type == "crossing" and (crossing := crossing_value(tags)):
        claims["crossing"] = _claim(crossing)
    if seg_type in ("street", "major_road"):
        sidewalk = _sidewalk_claim(tags)
        if sidewalk:
            claims["sidewalk"] = sidewalk
    if "step_count" in tags:
        with contextlib.suppress(ValueError):
            claims["step_count"] = _claim(int(float(tags["step_count"])))
    if "step_count" not in claims and seg_type == "steps":
        claims["step_count"] = _claim(1, "osm_highway_steps_default")
    inc = tags.get("incline", "")
    if inc.strip().endswith("%"):
        v = _parse_float(inc)
        if v is not None:
            claims["incline_pct"] = _claim(abs(v))
    # On a major road, `width` and `surface` describe the carriageway, not where people walk.
    carriageway = seg_type == "major_road"
    if "width" in tags and not carriageway:
        v = _parse_float(tags["width"])
        if v is not None:
            claims["width_m"] = _claim(v)
    if "surface" in tags and not carriageway:
        claims["surface"] = _claim(tags["surface"])
    if tags.get("wheelchair") in ("yes", "no", "limited"):
        claims["wheelchair"] = _claim(tags["wheelchair"])
    if "lit" in tags:
        claims["lit"] = _claim(tags["lit"])
    if "covered" in tags:
        claims["covered"] = _claim(tags["covered"])
    return claims


def _seg_type(tags: dict) -> str:
    hw = tags.get("highway", "")
    if hw == "steps":
        return "steps"
    if hw == "footway" and tags.get("footway") == "crossing":
        return "crossing"
    if hw == "footway" and tags.get("footway") == "sidewalk":
        return "sidewalk"
    if hw == "crossing":
        return "crossing"
    if hw in MAJOR_HIGHWAYS:
        return "major_road"
    if hw in STREET_TYPES:
        return "street"
    return hw


def _with_node_ids(w: dict) -> dict:
    """Overpass `out geom` omits the node-id list; derive a stable id from the 1e-7 degree coordinate.

    OSM stores coordinates at 1e-7 degrees, so equal coordinates identify the same node for routing purposes.
    """
    if "nodes" in w:
        return w
    nodes = [
        None if g is None else f"{round(g['lat'] * 1e7)}_{round(g['lon'] * 1e7)}"
        for g in w["geometry"]
    ]
    return {**w, "nodes": nodes}


def split_ways(ways: list[dict]) -> list[dict]:
    """Split ways at nodes shared with other ways (and at endpoints) into graph-edge segments."""
    ways = [_with_node_ids(w) for w in ways]
    usage: Counter = Counter()
    for w in ways:
        usage.update(w["nodes"])
    segs: list[dict] = []
    for w in ways:
        nodes, geom = w["nodes"], w["geometry"]
        if len(nodes) < 2 or len(geom) != len(nodes) or any(g is None for g in geom):
            continue
        tags = w.get("tags", {})
        stype = _seg_type(tags)
        claims = _claims(tags, stype)
        start, k = 0, 0
        for i in range(1, len(nodes)):
            if i == len(nodes) - 1 or usage[nodes[i]] > 1:
                pts = geom[start : i + 1]
                length = sum(haversine(pts[j], pts[j + 1]) for j in range(len(pts) - 1))
                seg = {
                    "id": f"seg-{w['id']}-{k}",
                    "kind": "segment",
                    "type": stype,
                    "from": f"n-{nodes[start]}",
                    "to": f"n-{nodes[i]}",
                    "length_m": round(length, 2),
                    "coords": [[round(p["lon"], 6), round(p["lat"], 6)] for p in pts],
                    "claims": json.loads(json.dumps(claims)),
                    # Preserve decision inputs, not inferred physical facts. Restrictions must
                    # survive import so mode rules cannot turn access=no into a usable edge.
                    "osm_tags": {
                        key: str(value)
                        for key, value in tags.items()
                        if key
                        in {
                            "highway",
                            "footway",
                            "service",
                            "access",
                            "foot",
                            "vehicle",
                            "motor_vehicle",
                            "motorcar",
                            "wheelchair",
                            "surface",
                            "smoothness",
                            "incline",
                            "width",
                            "step_count",
                            "sidewalk",
                            "sidewalk:both",
                            "sidewalk:left",
                            "sidewalk:right",
                            "lit",
                            "oneway",
                            "bridge",
                            "tunnel",
                            "layer",
                        }
                    },
                }
                if tags.get("name"):
                    seg["name"] = tags["name"]
                segs.append(seg)
                start, k = i, k + 1
    return segs


def _fetch_ways() -> list[dict]:
    seen: dict[int, dict] = {}
    for s, w, n, e in overpass.tiles(ENVELOPE, 3):
        ql = f'[out:json][timeout:180];way[highway~"^({WALK_HIGHWAYS})$"]({s},{w},{n},{e});out geom tags;'
        for el in overpass.query(ql).get("elements", []):
            if el["type"] == "way" and "geometry" in el:
                seen[el["id"]] = el
    return list(seen.values())


def major_tiles() -> list[tuple[float, float, float, float]]:
    """The 2 x 2 envelope tiles (ruling R22), with the NE tile split into its south half (R23)
    and the north half's west and east quarters (R24): the bigger NE queries kept timing out.
    Bboxes are cache keys: keep them stable."""
    *rest, (s, w, n, e) = overpass.tiles(ENVELOPE, 2)
    mid, mid_lon = (s + n) / 2, (w + e) / 2
    return [*rest, (s, w, mid, e), (mid, w, n, mid_lon), (mid, mid_lon, n, e)]


def _fetch_major_ways(allow_missing: bool = False) -> tuple[list[dict], list[tuple]]:
    """One sequential pass over major_tiles(). With allow_missing, a tile that cannot be fetched
    (request budget or Overpass failure) is skipped and returned in the missing list."""
    seen: dict[int, dict] = {}
    missing: list[tuple] = []
    hw = "|".join(MAJOR_HIGHWAYS)
    for s, w, n, e in major_tiles():
        ql = f'[out:json][timeout:180];way[highway~"^({hw})$"]({s},{w},{n},{e});out geom tags;'
        try:
            elements = overpass.query(ql).get("elements", [])
        except overpass.OverpassError:  # budget cap or Overpass failing every retry
            if not allow_missing:
                raise
            missing.append((s, w, n, e))
            continue
        for el in elements:
            if el["type"] == "way" and "geometry" in el:
                seen[el["id"]] = el
    return list(seen.values()), missing


def merge_ways(walk: list[dict], major: list[dict]) -> tuple[list[dict], int]:
    """Union by way id; major-road ways tagged foot=no are dropped. Returns (ways, skipped)."""
    seen = {w["id"]: w for w in [*walk, *major]}
    keep = [
        w
        for w in seen.values()
        if not (
            w.get("tags", {}).get("highway") in MAJOR_HIGHWAYS
            and w.get("tags", {}).get("foot") == "no"
        )
    ]
    return keep, len(seen) - len(keep)


def _place_tile_results() -> list[tuple[tuple, list[dict]]]:
    """(tile, elements) for the 2 x 2 place queries (`out center`, cached)."""
    out = []
    for s, w, n, e in overpass.tiles(ENVELOPE, 2):
        b = f"({s},{w},{n},{e})"
        parts = []
        for t in ("node", "way"):
            parts += [
                f'{t}[amenity~"^({AMENITIES})$"]{b};',
                f'{t}[leisure~"^(park|playground)$"]{b};',
                f"{t}[shop=mall]{b};",
                f'{t}[building][name~"Lakeside|Elmina"]{b};',
            ]
        ql = "[out:json][timeout:180];(" + "".join(parts) + ");out center tags;"
        out.append(((s, w, n, e), overpass.query(ql).get("elements", [])))
    return out


def _fetch_places(tile_results: list[tuple[tuple, list[dict]]] | None = None) -> list[dict]:
    seen: dict[tuple, dict] = {}
    for _, elements in tile_results if tile_results is not None else _place_tile_results():
        for el in elements:
            seen[(el["type"], el["id"])] = el
    return list(seen.values())


def fetch_area_geometry(tile_results: list[tuple[tuple, list[dict]]]) -> dict[int, list[dict]]:
    """Task 43: polygon geometry of the way places (the place query only has `out center`).

    One `way(id:...)` lookup for every way place in the cached place tiles, ids sorted so the
    cache key is stable. (A per-tile version met repeated HTTP 500s; an id lookup is light.)
    Returns {way id: [{lon, lat}, ...]}. The place query returns no relations.
    """
    ids = sorted({el["id"] for _, els in tile_results for el in els if el["type"] == "way"})
    if not ids:
        return {}
    ql = f"[out:json][timeout:180];way(id:{','.join(map(str, ids))});out geom;"
    geoms = {
        el["id"]: [g for g in el["geometry"] if g]
        for el in overpass.query(ql).get("elements", [])
        if el["type"] == "way" and el.get("geometry")
    }
    missing = [i for i in ids if i not in geoms]
    if missing:  # never silent: those places become inferred centre snaps with a warning
        print(
            f"WARNING: OSM outline not returned for {len(missing)} way place(s): "
            + ", ".join(map(str, missing))
        )
    return geoms


def _fetch_hydrology() -> list[dict]:
    s, w, n, e = ENVELOPE
    b = f"({s},{w},{n},{e})"
    ql = f"[out:json][timeout:180];(way[waterway]{b};way[natural=water]{b};way[landuse=basin]{b};);out geom;"
    return overpass.query(ql).get("elements", [])


def _title(s: str) -> str:
    return s.replace("_", " ").title()


def place_name(tags: dict, ptype: str) -> str:
    """Real OSM name, else a clearly generic label so searches prefer named places."""
    return tags.get("name") or f"{_title(ptype)} (unnamed, OSM)"


def build_places(
    elements: list[dict], area_geoms: dict[int, list[dict]] | None = None
) -> list[dict]:
    """OSM place elements -> place dicts. Way places with fetched geometry carry an internal
    `area` ([lon, lat] outline, not written out) used by assign_nodes."""
    places = []
    area_geoms = area_geoms or {}
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            lon, lat = el["lon"], el["lat"]
        elif "center" in el:
            lon, lat = el["center"]["lon"], el["center"]["lat"]
        else:
            continue
        if tags.get("amenity") in AMENITIES.split("|"):
            raw = tags["amenity"]
        elif tags.get("leisure") in ("park", "playground"):
            raw = tags["leisure"]
        elif tags.get("shop") == "mall":
            raw = "mall"
        else:
            raw = "building"
        ptype = PLACE_TYPE_MAP.get(raw, raw)
        aliases = [tags[k] for k in ("name:ms", "name:zh", "alt_name") if tags.get(k)]
        claims = {}
        if tags.get("wheelchair") in ("yes", "no", "limited"):
            claims["wheelchair"] = _claim(tags["wheelchair"])
        places.append(
            {
                "id": f"osm-{el['type']}-{el['id']}",
                "kind": "place",
                "type": ptype,
                "name": place_name(tags, ptype),
                "aliases": aliases,
                "node_id": None,
                "entrance_ids": [],
                "claims": claims,
                "lonlat": [round(lon, 6), round(lat, 6)],
            }
        )
        if el["type"] == "way":  # a way place is an area, with or without a fetched outline
            outline = area_geoms.get(el["id"])
            if outline and len(outline) >= 2:
                places[-1]["area"] = [[g["lon"], g["lat"]] for g in outline]
            else:
                places[-1]["outline_missing"] = True
    return places


AREA_SNAP_M = 40.0
AREA_SNAP_EVIDENCE = "osm_area_boundary_snap"  # node inside / within 40 m of the OSM outline
AREA_CENTRE_EVIDENCE = "osm_area_centre_snap"  # fallback: nearest node to the area centre
# A walk component smaller than this (and not the network's largest) is a disconnected
# fragment: snapping a place there would still route as no_data (review I3 / R28).
MIN_COMPONENT_NODES = 50
_FALLBACK_REASON = {
    "outline_missing": "OSM outline not returned for this way",
    "only_minor_component": (
        f"walk nodes near the OSM area are only in small disconnected path fragments "
        f"(< {MIN_COMPONENT_NODES} nodes)"
    ),
    "no_node_within_40m": f"no walk node within {AREA_SNAP_M:.0f} m of the OSM area",
}


def assign_nodes(
    places: list[dict], segs: list[dict], max_m: float = 60.0, area_max_m: float = AREA_SNAP_M
) -> None:
    """Point places: nearest walk node within max_m (unchanged).

    Area places (Task 43; every way place is one): among walk nodes inside the OSM polygon or
    within area_max_m of its outline that belong to the main network (the largest component,
    or one with at least MIN_COMPONENT_NODES nodes), pick the largest component, then the node
    nearest the place point. Otherwise (no outline, nothing within area_max_m, or only tiny
    fragments) fall back to the nearest main-network node within max_m of the centre (R26/R28)
    and set `snap_warning`; if there is none, the place stays without a node, with a warning.
    Any area snap is an inferred access point, not a mapped entrance: `node_inferred: true` and
    a reported `access_point` claim.
    """
    import networkx as nx
    from shapely import make_valid
    from shapely.geometry import LineString, Point, Polygon
    from shapely.strtree import STRtree

    lat0 = (ENVELOPE[0] + ENVELOPE[2]) / 2
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 111320.0

    def proj(lon, lat):
        return Point(lon * kx, lat * ky)

    nodes: dict[str, Point] = {}
    g = nx.Graph()
    for s in segs:
        nodes[s["from"]] = proj(*s["coords"][0])
        nodes[s["to"]] = proj(*s["coords"][-1])
        g.add_edge(s["from"], s["to"])
    comp_size: dict[str, int] = {}
    for comp in nx.connected_components(g):
        for n in comp:
            comp_size[n] = len(comp)
    largest = max(comp_size.values(), default=0)

    def main_network(n: str) -> bool:
        return comp_size.get(n, 0) >= min(largest, MIN_COMPONENT_NODES)

    ids = list(nodes)
    tree = STRtree([nodes[i] for i in ids])

    def snap(p: dict, nid: str, evidence: str, where: str, method: str | None = None) -> None:
        p["node_id"] = nid
        p["node_inferred"] = True
        claim = {
            **_claim(nid, evidence),
            "notes": f"nearest walk node {where}; the entrance is not mapped",
        }
        if method:
            claim["method"] = method
        p["claims"]["access_point"] = claim

    for p in places:
        pt = proj(*p["lonlat"])
        if not (p.get("area") or p.get("outline_missing")):
            idx = tree.nearest(pt)
            if idx is not None and pt.distance(nodes[ids[idx]]) <= max_m:
                p["node_id"] = ids[idx]
            continue
        reason = "outline_missing"
        if p.get("area"):
            xy = [(lon * kx, lat * ky) for lon, lat in p["area"]]
            closed = len(xy) >= 4 and xy[0] == xy[-1]
            shape = Polygon(xy) if closed else LineString(xy)
            if closed and not shape.is_valid:
                shape = make_valid(shape)  # keeps every lobe (buffer(0) dropped some)
            near = []
            for i in tree.query(shape.buffer(area_max_m)):
                d = shape.distance(nodes[ids[i]])
                if d <= area_max_m:  # NaN (empty shape) never qualifies
                    near.append((-comp_size.get(ids[i], 0), pt.distance(nodes[ids[i]]), ids[i], d))
            cands = [c for c in near if main_network(c[2])]
            if cands:
                _, _, nid, d = min(cands)
                if d == 0:
                    where = "inside the OSM area" if closed else "on the OSM area outline"
                else:
                    where = f"{d:.0f} m outside the OSM area boundary"
                snap(p, nid, AREA_SNAP_EVIDENCE, where)
                continue
            reason = "only_minor_component" if near else "no_node_within_40m"
        # Fallback: never silent. Nearest main-network node within max_m of the centre.
        ring = [
            (-comp_size.get(ids[i], 0), pt.distance(nodes[ids[i]]), ids[i])
            for i in tree.query(pt.buffer(max_m))
            if pt.distance(nodes[ids[i]]) <= max_m and main_network(ids[i])
        ]
        why = _FALLBACK_REASON[reason]
        if ring:
            _, dist, nid = min(ring)
            snap(
                p,
                nid,
                AREA_CENTRE_EVIDENCE,
                f"to the area centre ({dist:.0f} m from the area centre); {why}",
                reason,
            )
            p["snap_warning"] = (
                f"{why}; snapped to the nearest main-network walk node to its centre"
            )
        else:
            p["snap_warning"] = (
                f"{why}; not snapped (no main-network walk node within {max_m:.0f} m of its centre)"
            )


def _round(c):
    return [round(c[0], 6), round(c[1], 6)]


def write_geojson(path: Path, feats: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": feats},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def seg_feature(s: dict) -> dict:
    props = {k: v for k, v in s.items() if k != "coords"}
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "LineString", "coordinates": s["coords"]},
    }


def place_feature(p: dict) -> dict:
    props = {k: v for k, v in p.items() if k not in ("lonlat", "area", "outline_missing")}
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": p["lonlat"]},
    }


def hydrology_features(elements: list[dict]) -> list[dict]:
    feats = []
    for el in elements:
        geom = el.get("geometry")
        if el["type"] != "way" or not geom or len(geom) < 2:
            continue
        coords = [_round([g["lon"], g["lat"]]) for g in geom]
        tags = el.get("tags", {})
        closed = coords[0] == coords[-1] and len(coords) >= 4 and "waterway" not in tags
        feats.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"osm-way-{el['id']}",
                    "name": tags.get("name"),
                    **{k: tags[k] for k in ("waterway", "natural", "landuse") if k in tags},
                },
                "geometry": {"type": "Polygon", "coordinates": [coords]}
                if closed
                else {"type": "LineString", "coordinates": coords},
            }
        )
    return feats


def site_json(
    today: str, major_missing: list[tuple] | None = None, previous: dict | None = None
) -> dict:
    site = {
        "id": "elmina",
        "name": "City of Elmina",
        "township": "City of Elmina",
        "center": [101.5099, 3.1813],
        "bbox": [101.460, 3.150, 101.530, 3.240],
        "deep_spots": [
            {
                "id": "urban-park",
                "lens": "access",
                "name": "Elmina Urban Park + Lakeside Mall frontage",
                "bbox": [101.5055, 3.1775, 101.5135, 3.1835],
            },
            {
                "id": "subang-corridor",
                "lens": "flood",
                "name": "Sungai Subang corridor + downstream neighbours",
                "bbox": [101.495, 3.150, 101.560, 3.230],
            },
        ],
        "scene": {
            "hero": "cesium_google_photoreal",
            "fallback": "cesium_osm_buildings",
            "lite": "mapbox_standard",
            "datum_offset_m": 0.0,
            "home": {"lon": 101.5099, "lat": 3.1813, "range_m": 6000},
        },
        "attribution": ["© OpenStreetMap contributors (ODbL)"],
        "data_as_of": today,
    }
    if major_missing:
        # Coverage note: major roads (Task 31) not imported here; [w, s, e, n] like `bbox`.
        site["major_roads_missing_bbox"] = [[w, s, e, n] for s, w, n, e in major_missing]
    if previous:
        # A walk/places rebuild does not rebuild the display assets or their datum/licences.
        if "buildings" in previous:
            site["buildings"] = previous["buildings"]
        site["scene"].update(previous.get("scene", {}))
        site["attribution"] = list(
            dict.fromkeys([*site["attribution"], *previous.get("attribution", [])])
        )
    return site


def main(argv: list[str] | None = None) -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--max-requests",
        type=int,
        default=None,
        help="hard cap on real Overpass HTTP requests this run, retries included (cache hits are free)",
    )
    ap.add_argument(
        "--endpoint",
        action="append",
        help="Overpass endpoint(s) to use instead of the default mirror rotation; the next one "
        "is tried only after a connection-level failure (repeatable)",
    )
    ap.add_argument(
        "--allow-missing-major-tiles",
        action="store_true",
        help="build without major-road tiles that cannot be fetched; their bboxes go to "
        "site.json major_roads_missing_bbox",
    )
    args = ap.parse_args(argv)
    overpass.MAX_REQUESTS = args.max_requests
    overpass.ENDPOINTS = args.endpoint or None
    try:  # every fetch before any write, so a budget stop leaves the seed untouched
        walk_ways = _fetch_ways()
        major_ways, major_missing = _fetch_major_ways(args.allow_missing_major_tiles)
        place_tiles = _place_tile_results()
        place_els = _fetch_places(place_tiles)
        area_geoms = fetch_area_geometry(place_tiles)
        hydro_els = _fetch_hydrology()
    except overpass.OverpassError as exc:  # budget cap or Overpass failing every retry
        print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        raise SystemExit(2) from None
    ways, foot_no = merge_ways(walk_ways, major_ways)
    print(f"major-road ways fetched: {len(major_ways)}; skipped (foot=no): {foot_no}")
    for s, w, n, e in major_missing:
        print(f"WARNING: major roads NOT imported for tile s,w,n,e = {s}, {w}, {n}, {e}")
    segs = split_ways(ways)
    places = build_places(place_els, area_geoms)
    assign_nodes(places, segs)
    n_area = sum(1 for p in places if p.get("area"))
    n_inferred = sum(1 for p in places if p.get("node_inferred"))
    print(f"area places with geometry: {n_area}; snapped to an inferred access point: {n_inferred}")
    for p in places:
        if p.get("snap_warning"):
            print(f"WARNING: {p['id']} ({p['name']}): {p['snap_warning']}")
    hydro = hydrology_features(hydro_els)
    write_geojson(OUT / "base" / "walk.geojson", [seg_feature(s) for s in segs])
    write_geojson(OUT / "base" / "places.geojson", [place_feature(p) for p in places])
    write_geojson(OUT / "base" / "hydrology.geojson", hydro)
    site_path = OUT / "site.json"
    previous = json.loads(site_path.read_text(encoding="utf-8")) if site_path.exists() else None
    site_path.write_text(
        json.dumps(
            site_json(date.today().isoformat(), major_missing, previous),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"ways: {len(ways)}  segments: {len(segs)}  places: {len(places)}  hydrology features: {len(hydro)}"
    )
    print(f"places with node_id: {sum(1 for p in places if p['node_id'])}")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
