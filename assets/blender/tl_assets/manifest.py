"""The city asset manifest (version 1) that the Three.js loader reads. Pure Python.

Only assets that were built (present in `infos`) are listed, in ASSETS order. Test assets
(calib) are never listed.
"""

import logging

from .geo import outline_ring, ring_centroid
from .glbinfo import GlbInfo
from .specs import ASSETS, PRECINCT_GROUPS, ROLES, palette_for

VERSION = 1
log = logging.getLogger(__name__)


def _anchor(asset_id: str, landmarks_fc: dict) -> list[float] | None:
    """[lon, lat] ring centroid of the landmarks.geojson feature whose `model` is asset_id."""
    ring = outline_ring(landmarks_fc, asset_id)
    if ring is None:
        return None
    lon, lat = ring_centroid(ring)
    return [round(lon, 7), round(lat, 7)]


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
            # The drawn top of LOD0 (glb world bounds): the web fit scales height by it, so a
            # placed model's top lands on the building's display height even when the model rises
            # above its nominal `size` (domes, minarets, parapets; B-T2 fix round 1).
            top = round(info.nodes[f"{asset_id}__{v.id}__LOD0"].bounds[1][1], 3)
            variants[v.id] = {"size": list(v.size), "top": top, "lods": lods}
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
        if spec.design_storeys is not None:
            assets[asset_id]["designStoreys"] = spec.design_storeys
            assets[asset_id]["heightBasis"] = spec.height_basis
        if spec.group == "landmark" and spec.placement == "anchor":
            anchor = _anchor(asset_id, landmarks_fc)
            if anchor is None:
                log.warning(
                    "landmark %s unplaced: no landmarks.geojson feature with model=%s",
                    asset_id,
                    asset_id,
                )
            else:
                landmarks[asset_id] = {"anchor": anchor}
    return {
        "version": VERSION,
        "as_of": as_of,
        "roles": list(ROLES),
        "precinctGroups": [list(g) for g in PRECINCT_GROUPS],
        "assets": assets,
        "landmarks": landmarks,
    }
