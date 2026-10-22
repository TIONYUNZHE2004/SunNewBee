from datetime import date, datetime

from townshiplens_spatial import models as spatial_models
from townshiplens_spatial.access import assess_access, urban_context
from townshiplens_spatial.evaluate import (
    claim_gap,
    edge_demo_gaps,
    edge_gaps,
    effective_claim_status,
    evaluate_edge,
    is_demo,
    relevant_attributes,
)
from townshiplens_spatial.lowlying import terrain_only
from townshiplens_spatial.models import active_closures
from townshiplens_spatial.world import World

LENSES = ("access", "flood", "waste")
_MAP = {"PASS": "ok", "UNKNOWN": "unknown", "FAIL": "blocked"}
_FLOOD = {"likely_flooded": "flooded_likely", "possible": "flooded_possible"}


def _place_closure(p, now: datetime, tz: str) -> dict:
    live = active_closures(p.closures, now)
    return {"closed": True, "closure_label": live[0].label(tz)} if live else {}


def _layer(
    world: World, lens: str, profile: str = "default", scenario_id: str | None = None
) -> dict:
    prof = world.profiles.get(profile) or world.profiles["default"]
    now = spatial_models.utcnow()
    feats: list[dict] = []
    if lens in ("access", "flood"):
        classes = world.flood.edge_classes.get(scenario_id or "", {})
        for e in world.edges.values():
            fc = classes.get(e.id)
            coverage = world.flood.coverage_for(scenario_id, e.id)
            if lens == "flood" and fc not in _FLOOD and not coverage:
                continue
            live = active_closures(e.closures, now)
            terrain = bool(scenario_id) and terrain_only(world, scenario_id, e.id)
            factual = evaluate_edge(
                e, prof, fc, now=now, flood_coverage=coverage, terrain_only=terrain
            )
            access = assess_access(
                e,
                prof,
                fc,
                flood_coverage=coverage,
                now=now,
                urban=urban_context(world, e),
                factual=factual,
            )
            # A reported closure is shown as Not passable even where a flood class also applies.
            status = "blocked" if live else _FLOOD.get(fc or "") or _MAP[factual[0]]
            if lens == "access":
                status = {
                    "verified": "verified",
                    "likely_ok": "likely_ok",
                    "unknown": "unknown",
                    "barrier": "blocked",
                    "not_a_road": "not_a_road",
                }[access.level]
                if (
                    access.level != "not_a_road"
                    and not live
                    and fc in _FLOOD
                    and not (terrain and factual[0] == "FAIL")
                ):
                    status = _FLOOD[fc]
            props = {
                "id": e.id,
                "type": e.type,
                "name": e.name,
                "status_for_profile": status,
                "access_level": access.level,
                "rule_id": access.rule_id,
                "tags_used": access.tags_used,
            }
            if e.type in ("street", "major_road"):
                sidewalk = e.claims.get("sidewalk")
                props["sidewalk"] = sidewalk.value if sidewalk else None
                props["sidewalk_status"] = effective_claim_status(sidewalk, "sidewalk")
            if e.type == "crossing":  # B-T7 fix round 1: zebra stripes only where marked
                crossing = e.claims.get("crossing")
                props["crossing"] = crossing.value if crossing else None
                props["crossing_status"] = crossing.status if crossing else "unknown"
            if live:  # Task 46: staff-reported, shown as "Reported closure (staff)"
                props["closed"] = True
                props["closure_label"] = live[0].label(world.site.timezone)
            if fc in _FLOOD:  # class + scenario only; never a depth
                props["flood_class"] = fc
                props["scenario_id"] = scenario_id
            if coverage:
                props["flood_coverage"] = coverage
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
                "properties": {
                    "id": p.id,
                    "kind": p.kind,
                    "type": p.type,
                    "name": p.name,
                    "node_inferred": p.node_inferred,  # Task 43: nearest path, not an entrance
                    **_place_closure(p, now, world.site.timezone),
                },
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


def clear_cache() -> None:
    """Drop memoised layers. The key holds `id(world)`, which a new world can reuse once the old
    one is freed, so a world swap (`state.reset`) must clear it."""
    _cache.clear()


def layer(
    world: World, lens: str, profile: str = "default", scenario_id: str | None = None
) -> dict:
    """Memoised on (world identity, world.version, lens, profile, scenario, live closures): a
    closure starts and expires on the clock without a version bump."""
    live = tuple(c.id for c in world.active_closures())
    key = (id(world), world.version, date.today().isoformat(), lens, profile, scenario_id, live)
    hit = _cache.get(key)
    if hit is None:
        if len(_cache) > 64:
            _cache.clear()
        hit = _cache[key] = _layer(world, lens, profile, scenario_id)
    return hit


def gaps_layer(
    world: World,
    demand: dict[str, int],
    profile: str = "default",
    impact: dict[str, int] | None = None,
) -> dict:
    """Where the world model is not yet checked, for one profile. Counts only: no status colour
    and no verdict (a gap is "facts not yet checked", never "unsafe" or "inaccessible").

    Edges: the facts that keep `evaluate_edge` from a PASS for this profile (`edge_gaps`; reported
    claims count, as they do for evaluation; demo values, `team_survey_placeholder`, count as not
    yet surveyed and are tallied in `demo_count`, so nothing resting on
    them is "fully checked"). Places: the claims each place carries, since no profile decides
    which place facts matter. `demand` maps
    element id to open verification-request demand; `impact` maps element id to the number of
    journey tasks the latest simulation says checking its facts would confirm (sim.py ranks it)."""
    prof = world.profiles.get(profile) or world.profiles["default"]
    today = date.today()
    impact = impact or {}

    def summary(gaps: list[dict], relevant: int) -> dict:
        return {
            "relevant_count": relevant,
            "unknown_count": len(gaps),
            "stale_count": sum(1 for g in gaps if g["stale"]),
            "reported_count": sum(1 for g in gaps if g["reported"]),
            "demo_count": sum(1 for g in gaps if g.get("demo")),
            "unknown_attributes": [g["attribute"] for g in gaps],
        }

    def place_gaps(claims) -> list[dict]:
        out = []
        for a, c in claims.items():
            unknown, stale, reported = claim_gap(c, a, today)
            if unknown:
                out.append({"attribute": a, "stale": stale, "reported": reported})
            elif is_demo(c):  # demo values count as not yet surveyed (Task 55)
                out.append({"attribute": a, "stale": False, "reported": False, "demo": True})
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
                    **summary(
                        edge_gaps(e, prof, today) + edge_demo_gaps(e, prof, today),
                        len(relevant_attributes(e, prof)),
                    ),
                    "demand": demand.get(e.id, 0),
                    "journey_impact": impact.get(e.id, 0),
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
                    "journey_impact": impact.get(p.id, 0),
                },
            }
        )
    return {"type": "FeatureCollection", "features": feats}
