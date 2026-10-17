"""The city asset manifest (version 1) that the Three.js loader reads. Pure Python.

Only assets that were built (present in `infos`) are listed, in ASSETS order. Test assets
(calib) are never listed.
"""

from .geo import ring_centroid
from .glbinfo import GlbInfo
from .specs import ASSETS, PRECINCT_GROUPS, ROLES, palette_for

VERSION = 1


def _anchor(asset_id: str, landmarks_fc: dict) -> list[float] | None:
    """[lon, lat] ring centroid of the landmarks.geojson feature whose `model` is asset_id."""
    for f in landmarks_fc.get("features", []):
        if (f.get("properties") or {}).get("model") != asset_id:
            continue
        geom = f.get("geometry") or {}
        if geom.get("type") == "Polygon":
            ring = geom["coordinates"][0]
        elif geom.get("type") == "MultiPolygon":
            ring = max(geom["coordinates"], key=lambda poly: len(poly[0]))[0]
        else:
            continue
        lon, lat = ring_centroid(ring)
        return [round(lon, 7), round(lat, 7)]
    return None


def build_manifest(infos: dict[str, GlbInfo], as_of: str, landmarks_fc: dict) -> dict:
    """Manifest dict for the built glbs (`infos` by asset id), in a stable key order."""
    assets: dict[str, dict] = {}
    landmarks: dict[str, dict] = {}
    for asset_id, spec in ASSETS.items():
        info = infos.get(asset_id)
        if info is None:
            continue
        variants = {}
        for v in spec.variants:
            lods = []
            for n, max_m in enumerate(v.max_m):
                node = f"{asset_id}__{v.id}__LOD{n}"
                if node not in info.nodes:
                    raise ValueError(f"{spec.file}: missing node {node}")
                lods.append({"node": node, "tris": info.nodes[node].tris, "maxM": max_m})
            variants[v.id] = {"size": list(v.size), "lods": lods}
        assets[asset_id] = {
            "group": spec.group,
            "file": spec.file,
            "bytes": info.bytes,
            "repeat": spec.repeat,
            "frontage": spec.frontage,
            "fit": {"xz": list(spec.fit_xz), "y": list(spec.fit_y)},
            "decorative": spec.decorative,
            "placement": spec.placement,
            "jitter": dict(spec.jitter),
            "variantByGroup": dict(spec.variant_by_group),
            "palettes": {g: [list(e) for e in es] for g, es in palette_for(asset_id).items()},
            "variants": variants,
        }
        if spec.group == "landmark" and spec.placement == "anchor":
            anchor = _anchor(asset_id, landmarks_fc)
            if anchor is not None:
                landmarks[asset_id] = {"anchor": anchor}
    return {
        "version": VERSION,
        "as_of": as_of,
        "roles": list(ROLES),
        "precinctGroups": [list(g) for g in PRECINCT_GROUPS],
        "assets": assets,
        "landmarks": landmarks,
    }
