from datetime import date

from townshiplens_spatial.evaluate import claim_gap, edge_gaps, evaluate_edge, relevant_attributes
from townshiplens_spatial.world import World

LENSES = ("access", "flood", "waste")
_MAP = {"PASS": "ok", "UNKNOWN": "unknown", "FAIL": "blocked"}
_FLOOD = {"likely_flooded": "flooded_likely", "possible": "flooded_possible"}


def _layer(
    world: World, lens: str, profile: str = "default", scenario_id: str | None = None
) -> dict:
    prof = world.profiles.get(profile) or world.profiles["default"]
    feats: list[dict] = []
    if lens in ("access", "flood"):
        classes = world.flood.edge_classes.get(scenario_id or "", {})
        for e in world.edges.values():
            fc = classes.get(e.id)
            if lens == "flood" and fc not in _FLOOD:
                continue
            status = _FLOOD.get(fc or "") or _MAP[evaluate_edge(e, prof)[0]]
            props = {
                "id": e.id,
                "type": e.type,
                "name": e.name,
                "status_for_profile": status,
            }
            if fc in _FLOOD:  # class + scenario only; never a depth
                props["flood_class"] = fc
                props["scenario_id"] = scenario_id
            feats.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": e.coords},
                    "properties": props,
                }
            )
    if lens == "access":
        feats += [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": p.coord},
                "properties": {"id": p.id, "kind": p.kind, "type": p.type, "name": p.name},
            }
            for p in world.places.values()
            if not p.id.startswith("__")
        ]
    if lens == "flood":
        feats += [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": c.coord},
                "properties": {"id": c.id, "kind": "evac_centre", "type": c.source, "name": c.name},
            }
            for c in world.centres.values()
        ]
    if lens == "waste":
        feats += [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": w.coord},
                "properties": {
                    "id": w.id,
                    "kind": "waste_point",
                    "type": w.type,
                    "name": w.name,
                    "status": w.status,
                },
            }
            for w in world.waste.values()
        ]
    return {"type": "FeatureCollection", "features": feats}


_cache: dict[tuple, dict] = {}


def layer(
    world: World, lens: str, profile: str = "default", scenario_id: str | None = None
) -> dict:
    """Memoised on (world identity, world.version, lens, profile, scenario)."""
    key = (id(world), world.version, lens, profile, scenario_id)
    hit = _cache.get(key)
    if hit is None:
        if len(_cache) > 64:
            _cache.clear()
        hit = _cache[key] = _layer(world, lens, profile, scenario_id)
    return hit


def gaps_layer(world: World, demand: dict[str, int], profile: str = "default") -> dict:
    """Where the world model is not yet checked, for one profile. Counts only: no status colour
    and no verdict (a gap is "facts not yet checked", never "unsafe" or "inaccessible").

    Edges: the facts that keep `evaluate_edge` from a PASS for this profile (`edge_gaps`; reported
    claims count, as they do for evaluation). Places: the
    claims each place carries, since no profile decides which place facts matter. `demand` maps
    element id to open verification-request demand."""
    prof = world.profiles.get(profile) or world.profiles["default"]
    today = date.today()

    def summary(gaps: list[dict], relevant: int) -> dict:
        return {
            "relevant_count": relevant,
            "unknown_count": len(gaps),
            "stale_count": sum(1 for g in gaps if g["stale"]),
            "reported_count": sum(1 for g in gaps if g["reported"]),
            "unknown_attributes": [g["attribute"] for g in gaps],
        }

    def place_gaps(claims) -> list[dict]:
        out = []
        for a, c in claims.items():
            unknown, stale, reported = claim_gap(c, a, today)
            if unknown:
                out.append({"attribute": a, "stale": stale, "reported": reported})
        return out

    feats: list[dict] = []
    for e in world.edges.values():
        feats.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": e.coords},
                "properties": {
                    "id": e.id,
                    "kind": "segment",
                    "type": e.type,
                    "name": e.name,
                    **summary(edge_gaps(e, prof, today), len(relevant_attributes(e, prof))),
                    "demand": demand.get(e.id, 0),
                },
            }
        )
    for p in world.places.values():
        if p.id.startswith("__"):
            continue
        feats.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": p.coord},
                "properties": {
                    "id": p.id,
                    "kind": p.kind,
                    "type": p.type,
                    "name": p.name,
                    **summary(place_gaps(p.claims), len(p.claims)),
                    "demand": demand.get(p.id, 0),
                },
            }
        )
    return {"type": "FeatureCollection", "features": feats}
