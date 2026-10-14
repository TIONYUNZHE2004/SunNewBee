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

WALK_HIGHWAYS = (
    "footway|path|pedestrian|steps|crossing|living_street|residential|service|unclassified|"
    "tertiary|secondary_link|tertiary_link|track"
)
STREET_TYPES = {
    "residential",
    "service",
    "unclassified",
    "tertiary",
    "secondary_link",
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


def _claims(tags: dict, seg_type: str) -> dict:
    claims: dict = {}
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
    if "width" in tags:
        v = _parse_float(tags["width"])
        if v is not None:
            claims["width_m"] = _claim(v)
    if "surface" in tags:
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
    if hw == "crossing":
        return "crossing"
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


def _fetch_places() -> list[dict]:
    seen: dict[tuple, dict] = {}
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
        for el in overpass.query(ql).get("elements", []):
            seen[(el["type"], el["id"])] = el
    return list(seen.values())


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


def build_places(elements: list[dict]) -> list[dict]:
    places = []
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
    return places


def assign_nodes(places: list[dict], segs: list[dict], max_m: float = 60.0) -> None:
    from shapely.geometry import Point
    from shapely.strtree import STRtree

    lat0 = (ENVELOPE[0] + ENVELOPE[2]) / 2
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 111320.0

    def proj(lon, lat):
        return Point(lon * kx, lat * ky)

    nodes: dict[str, Point] = {}
    for s in segs:
        nodes[s["from"]] = proj(*s["coords"][0])
        nodes[s["to"]] = proj(*s["coords"][-1])
    ids = list(nodes)
    tree = STRtree([nodes[i] for i in ids])
    for p in places:
        pt = proj(*p["lonlat"])
        idx = tree.nearest(pt)
        if idx is not None and pt.distance(nodes[ids[idx]]) <= max_m:
            p["node_id"] = ids[idx]


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
    props = {k: v for k, v in p.items() if k != "lonlat"}
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


def site_json(today: str) -> dict:
    return {
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


def main() -> None:
    ways = _fetch_ways()
    segs = split_ways(ways)
    places = build_places(_fetch_places())
    assign_nodes(places, segs)
    hydro = hydrology_features(_fetch_hydrology())
    write_geojson(OUT / "base" / "walk.geojson", [seg_feature(s) for s in segs])
    write_geojson(OUT / "base" / "places.geojson", [place_feature(p) for p in places])
    write_geojson(OUT / "base" / "hydrology.geojson", hydro)
    (OUT / "site.json").write_text(
        json.dumps(site_json(date.today().isoformat()), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"ways: {len(ways)}  segments: {len(segs)}  places: {len(places)}  hydrology features: {len(hydro)}"
    )
    print(f"places with node_id: {sum(1 for p in places if p['node_id'])}")
    print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")


if __name__ == "__main__":
    main()
