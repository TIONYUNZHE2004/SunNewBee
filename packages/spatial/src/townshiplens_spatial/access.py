"""Map-derived access estimates. These never change factual PASS/FAIL/UNKNOWN.

Urban context is an explicit proxy: every vertex is within 60 m of an OSM residential
road centreline. Buildings, renderers and decorative details are never inputs.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from math import cos, radians
from typing import TYPE_CHECKING

from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from .direction import direction_unknown
from .evaluate import (
    SIDEWALK_PRESENT,
    _needs_verification,
    evaluate_edge,
    mode_access,
    relevant_attributes,
)
from .models import AccessLevel, Edge, Profile

if TYPE_CHECKING:
    from .world import World

LEVELS = ("verified", "likely_ok", "unknown", "barrier", "not_a_road")
PAVED = {"asphalt", "concrete", "concrete:plates", "concrete:lanes", "paved", "paving_stones"}
ROUGH = {"gravel", "fine_gravel", "grass", "dirt", "earth", "ground", "sand", "unpaved", "mud"}


@dataclass(frozen=True)
class AccessAssessment:
    level: AccessLevel
    rule_id: str
    tags_used: dict[str, str] = field(default_factory=dict)


def urban_context(world: "World", edge: Edge) -> dict[str, str]:
    """Static OSM proxy: all vertices must be close, including a long edge's ends."""
    if "_urban_access" not in world.graph.graph:
        lon, lat = world.site.center
        sx, sy = 111_320 * cos(radians(lat)), 111_320

        def xy(p):
            return ((p[0] - lon) * sx, (p[1] - lat) * sy)

        roads = [e for e in world.edges.values() if e.osm_tags.get("highway") == "residential"]
        contexts = {}
        if roads:
            tree = STRtree([LineString([xy(p) for p in e.coords]) for e in roads])
            for e in world.edges.values():
                if e.type not in {"footway", "path", "ramp"} or not e.osm_tags:
                    continue
                samples = [Point(xy(p)) for p in e.coords]
                near = [int(tree.nearest(p)) for p in samples]
                distances = [
                    p.distance(tree.geometries[i]) for p, i in zip(samples, near, strict=True)
                ]
                furthest = max(range(len(samples)), key=distances.__getitem__)
                if distances[furthest] <= 60:
                    contexts[e.id] = {
                        "context:rule": "all_vertices_within_60m_residential_v1",
                        "context:road_edge": roads[near[furthest]].id,
                        "context:max_distance_m": f"{distances[furthest]:.1f}",
                    }
        world.graph.graph["_urban_access"] = contexts
    return world.graph.graph["_urban_access"].get(edge.id, {})


def assess_access(
    edge: Edge,
    profile: Profile,
    flood_class=None,
    *,
    flood_coverage=None,
    urban: dict[str, str] | None = None,
    today: date | None = None,
    now: datetime | None = None,
    factual=None,
) -> AccessAssessment:
    today = today or date.today()
    tags = dict(edge.osm_tags)

    def result(level, rule):
        return AccessAssessment(level, rule, tags)

    # Non-roads are a separate map category, including when a scenario overlays them.
    if profile.allowed_types is not None and edge.type not in profile.allowed_types:
        tags["edge:type"] = edge.type
        return result("not_a_road", "driving_nonroad_v1")
    state, why = factual or evaluate_edge(edge, profile, flood_class, today, now, flood_coverage)
    if state == "FAIL":
        tags["facts:barrier_attributes"] = ",".join(sorted({r["attribute"] for r in why}))
        return result("barrier", "known_barrier_v1")
    if flood_class == "possible" or flood_coverage:
        tags["scenario:class"] = flood_class or "unassessed"
        if flood_coverage:
            tags["scenario:coverage"] = flood_coverage
        return result("unknown", "scenario_uncertainty_v1")
    _, permission = mode_access(edge, profile)
    if permission is not None and permission not in {"yes", "designated", "permissive", "official"}:
        return result("unknown", "restricted_access_v1")
    if profile.id == "drive" and direction_unknown(edge):
        return result("unknown", "driving_direction_unknown_v1")
    attrs = relevant_attributes(edge, profile)
    # An unconstrained profile's vacuous PASS does not establish a staff survey.
    survey_attrs = attrs or ["step_count", "incline_pct", "width_m"]
    if state == "PASS" and all(
        not _needs_verification(edge.claims.get(a), a, today)
        and edge.claims[a].evidence_type
        not in {None, "team_survey_placeholder", "osm_import", "whatif"}
        and bool(edge.claims[a].verified_by)
        for a in survey_attrs
    ):
        tags["facts:verified_attributes"] = ",".join(survey_attrs)
        return result("verified", "staff_verified_v1")
    # Legacy/demo worlds without raw map provenance retain factual evaluation, not an estimate.
    if not edge.osm_tags:
        return result("unknown", "no_map_basis_v1")
    if any(
        c.status in {"contested", "stale"}
        or (c.status == "verified" and _needs_verification(c, a, today))
        for a, c in edge.claims.items()
        if a in attrs
    ):
        return result("unknown", "unresolved_claim_v1")
    if profile.id == "drive":
        if tags.get("smoothness") in {"bad", "very_bad", "horrible", "very_horrible", "impassable"}:
            return result("unknown", "adverse_smoothness_v1")
        if edge.type == "track" and tags.get("surface") not in PAVED:
            return result("unknown", "driving_track_surface_unknown_v1")
        return result("likely_ok", "mapped_road_driving_v1")
    strict = bool(profile.hard)
    surface_claim = edge.claims.get("surface")
    surface = (
        surface_claim.value
        if surface_claim and surface_claim.status in {"reported", "verified"}
        else tags.get("surface")
    )
    if strict:
        if tags.get("smoothness") in {"bad", "very_bad", "horrible", "very_horrible", "impassable"}:
            return result("unknown", "adverse_smoothness_v1")
        if surface in ROUGH or (surface and surface not in PAVED):
            return result("unknown", "surface_not_suitable_for_estimate_v1")
        if tags.get("wheelchair") == "limited":
            return result("unknown", "wheelchair_limited_v1")
        if tags.get("incline") and not tags["incline"].strip().endswith("%"):
            return result("unknown", "incline_not_numeric_v1")
        if tags.get("width") and "width_m" not in edge.claims:
            return result("unknown", "width_not_numeric_v1")
    if edge.type in {"street", "major_road"}:
        sidewalk = edge.claims.get("sidewalk")
        if strict or edge.type == "major_road":
            if (
                not sidewalk
                or sidewalk.value not in SIDEWALK_PRESENT
                or sidewalk.status not in {"reported", "verified"}
            ):
                return result("unknown", "road_sidewalk_missing_v1")
            return result("likely_ok", "mapped_road_sidewalk_v1")
        if tags.get("highway") not in {
            "residential",
            "living_street",
            "service",
            "unclassified",
            "tertiary",
            "tertiary_link",
        }:
            return result("unknown", "road_type_unknown_v1")
        return result("likely_ok", "local_road_walking_v1")
    if edge.type in {"sidewalk", "crossing", "pedestrian"}:
        return result("likely_ok", "pedestrian_infrastructure_v1")
    if edge.type in {"footway", "path", "ramp"}:
        if not strict:
            return result("likely_ok", "mapped_path_walking_v1")
        if surface in PAVED:
            return result("likely_ok", "paved_path_v1")
        if tags.get("wheelchair") == "yes":
            return result("likely_ok", "osm_wheelchair_yes_v1")
        if edge.type in {"footway", "ramp"} and urban:
            tags.update(urban)
            return result("likely_ok", "urban_footway_v1")
    if edge.type == "steps" and not strict:
        return result("likely_ok", "mapped_steps_walking_v1")
    return result("unknown", "no_estimate_rule_v1")
