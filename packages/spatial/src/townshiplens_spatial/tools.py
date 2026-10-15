from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

import networkx as nx

from . import flood as _flood
from . import routing
from .evaluate import evaluate_edge
from .geo import haversine_m
from .models import Claim, Evidence, ToolResult, photo_url
from .scenario_meta import scenario_source
from .vr_store import VerificationStore
from .world import World


@dataclass
class Ctx:
    world: World
    vrs: VerificationStore


def _place_ev(p) -> Evidence:
    return Evidence(
        id=f"ev-place-{p.id}",
        element_id=p.id,
        attribute="name",
        value=p.name,
        status="reported",
        source_type="world_model",
    )


_STOPWORDS = {"take", "from", "with", "near", "where", "that", "this", "your", "have"}
_CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def _phrase_score(shorter: int, longer: int) -> float:
    return 0.9 + 0.09 * min(1.0, shorter / longer)


def _score_name(q: str, name: str) -> float:
    """Exact (1.0) > full-phrase containment (0.9-0.99) > token overlap (<=0.85) > fuzzy (<0.85)."""
    if q == name:
        return 1.0
    if _CJK.search(q) or _CJK.search(name):
        # No word boundaries in CJK: plain containment, both directions, min 2 chars.
        if len(name) >= 2 and name in q:
            return _phrase_score(len(name), len(q))
        if len(q) >= 2 and q in name:
            return _phrase_score(len(q), len(name))
        return 0.0
    if len(q) < 3 and " " not in q:
        return 0.0  # short single tokens ("a", "wc") only match exactly
    if re.search(rf"\b{re.escape(q)}\b", name):
        return _phrase_score(len(q), len(name))
    if (len(name) >= 3 or " " in name) and re.search(rf"\b{re.escape(name)}\b", q):
        return _phrase_score(len(name), len(q))
    best = 0.0
    qt = {t for t in re.findall(r"\w+", q) if len(t) >= 4 and t not in _STOPWORDS}
    nt = {t for t in re.findall(r"\w+", name) if len(t) >= 4 and t not in _STOPWORDS}
    if qt and qt & nt:
        best = 0.5 + 0.35 * len(qt & nt) / len(qt)
    if len(q) >= 3:
        best = max(best, min(0.84, difflib.SequenceMatcher(None, q, name).ratio()))
    return best


def find_place(ctx: Ctx, query: str, types: list[str] | None = None, limit: int = 5) -> ToolResult:
    q = query.strip().lower()
    if not q:
        return ToolResult(ok=True, data=[], warnings=["empty query"])
    scored = []
    for p in ctx.world.places.values():
        if p.id.startswith("__"):
            continue  # transient places (R12) never surface in search
        if types and p.type not in types:
            continue
        score = max(_score_name(q, n.lower()) for n in [p.name, *p.aliases])
        if score >= 0.6:
            scored.append((score, p))
    scored.sort(key=lambda t: (-t[0], len(t[1].name), t[1].id))
    top = [p for _, p in scored[:limit]]
    return ToolResult(
        ok=True,
        data=[
            {"id": p.id, "name": p.name, "type": p.type, "score": round(s, 2)}
            for s, p in scored[:limit]
        ],
        evidence=[_place_ev(p) for p in top],
    )


CENTRE_SOURCE_LABEL = {
    "official_pps": "Official PPS",
    "osm_candidate": "Candidate (OSM), not an official relief centre",
}


def _centre_details(
    ctx: Ctx, place_id: str, scenario_id: str | None, profile: str, near: str | None
) -> ToolResult | None:
    c = ctx.world.centres.get(place_id)
    if c is None:
        return None
    official = c.source == "official_pps"
    src_type = "official PPS report" if official else "OSM candidate"
    claims = {
        "source": Claim(
            value=CENTRE_SOURCE_LABEL[c.source],
            status="reported" if official else "unknown",
            evidence_type=src_type,
        )
    }
    if c.capacity is not None:
        claims["capacity"] = Claim(value=c.capacity, status="unknown", evidence_type=src_type)
    data = {
        "id": c.id,
        "kind": "evac_centre",
        "type": "evacuation_centre",
        "name": c.name,
        "coord": c.coord,
        "source": c.source,
        "source_label": CENTRE_SOURCE_LABEL[c.source],
        "evidence_url": c.evidence_url,
        "notes": c.notes,
        "claims": {a: v.model_dump(mode="json") for a, v in claims.items()},
    }
    ev = [
        Evidence(
            id=f"ev-centre-{c.id}",
            element_id=c.id,
            attribute="source",
            value=c.source,
            status=claims["source"].status,
            source_type=src_type,
            source_url=c.evidence_url,
        )
    ]
    warnings: list[str] = []
    if near:
        row = next(
            (
                r
                for r in _flood.centres_reachability(ctx.world, scenario_id, profile, near)
                if r.centre.id == c.id
            ),
            None,
        )
        if row is not None:
            sc = _flood.scenario(ctx.world, scenario_id) if scenario_id else None
            data["reachability"] = {
                "reachable": row.reachable,
                "route_status": row.route_status,
                "route_id": row.route_id,
                "distance_m": row.distance_m,
                "from": near,
                "profile": profile,
                "scenario_id": scenario_id,
                "disclaimer": sc.disclaimer if sc else None,
            }
            if scenario_id:
                ev.append(
                    Evidence(
                        id=f"ev-scn-{scenario_id}",
                        element_id=scenario_id,
                        attribute="scenario",
                        status="indicative",
                        source_type=scenario_source(ctx.world, scenario_id),
                    )
                )
    return ToolResult(ok=True, data=data, evidence=ev, warnings=warnings)


def _waste_details(ctx: Ctx, place_id: str) -> ToolResult | None:
    w = ctx.world.waste.get(place_id)
    if w is None:
        return None
    claims = {
        "status": Claim(
            value=w.status,
            status=w.status,
            evidence_type="waste point listing",
            verified_at=w.verified_at,
        ),
    }
    if w.accepted_items:
        claims["accepted_items"] = Claim(
            value=", ".join(w.accepted_items), status=w.status, verified_at=w.verified_at
        )
    data = {
        "id": w.id,
        "kind": "waste_point",
        "type": w.type,
        "name": w.name,
        "coord": w.coord,
        "status": w.status,
        "source_label": f"Waste point: {w.status}",
        "source_url": w.source_url,
        "collection_day": None,  # never invented; ask the council
        "claims": {a: v.model_dump(mode="json") for a, v in claims.items()},
    }
    ev = [
        Evidence(
            id=f"ev-{w.id}.status",
            element_id=w.id,
            attribute="status",
            value=w.status,
            status=w.status,
            verified_at=w.verified_at,
            source_type="waste point listing",
            source_url=w.source_url,
        )
    ]
    return ToolResult(ok=True, data=data, evidence=ev)


def get_place_details(
    ctx: Ctx,
    place_id: str,
    scenario_id: str | None = None,
    profile: str = "default",
    near: str | None = None,
) -> ToolResult:
    p = ctx.world.places.get(place_id)
    if p is None:
        r = _centre_details(ctx, place_id, scenario_id, profile, near) or _waste_details(
            ctx, place_id
        )
        if r is not None:
            return r
        return ToolResult(ok=False, warnings=[f"unknown place {place_id}"])
    ev = [_place_ev(p)] + [
        Evidence(
            id=f"ev-{p.id}.{a}",
            element_id=p.id,
            attribute=a,
            value=c.value,
            status=c.status,
            verified_at=c.verified_at,
            source_type=c.evidence_type,
            photo_url=photo_url(c),
        )
        for a, c in p.claims.items()
    ]
    return ToolResult(ok=True, data=p.model_dump(mode="json"), evidence=ev)


def _inferred_endpoints(world: World, from_id: str, to_id: str, warnings: list[str]) -> list:
    """Task 43: a route to or from an area place whose walk node was inferred (nearest mapped
    path, not a mapped entrance) says so, and cites the access_point claim."""
    ev = []
    for pid, verb in ((from_id, "starts"), (to_id, "ends")):
        p = world.places.get(pid)
        if p is None or not p.node_inferred:
            continue
        warnings.append(
            f"Route {verb} at the nearest mapped path to {p.name}; its entrance is not mapped."
        )
        c = p.claims.get("access_point")
        if c is not None:
            ev.append(
                Evidence(
                    id=f"ev-{p.id}.access_point",
                    element_id=p.id,
                    attribute="access_point",
                    value=c.value,
                    status=c.status,
                    source_type=c.evidence_type,
                )
            )
    return ev


MAX_ROUTE_VRS = 10  # one question must not flood the staff verification queue


def plan_route(
    ctx: Ctx,
    from_id: str,
    to_id: str,
    profile: str,
    scenario_id: str | None = None,
    question_summary: str | None = None,
) -> ToolResult:
    rr = routing.plan_route(ctx.world, from_id, to_id, profile, scenario_id)
    evidence: list[Evidence] = []
    vrs = []
    filed: set[tuple[str, str]] = set()  # one VR per element/attribute per call (alt routes repeat)
    truncated = 0
    for r in rr.routes:
        evidence += routing.evidence_for_route(ctx.world, r)
        for u in r.unknowns:
            if u["attribute"] == "flood" or (u["element_id"], u["attribute"]) in filed:
                continue
            filed.add((u["element_id"], u["attribute"]))
            if len(filed) > MAX_ROUTE_VRS:
                truncated += 1
                continue
            vr, created = ctx.vrs.request(
                u["element_id"], u["attribute"], u.get("reason", "unknown"), question_summary
            )
            vrs.append({**vr.model_dump(mode="json"), "created": created})
    if rr.status == "no_data":
        for w in rr.warnings:
            if w.startswith("place not mapped: "):
                vr, created = ctx.vrs.request(
                    w.split(": ", 1)[1], "existence", "missing_place", question_summary
                )
                vrs.append({**vr.model_dump(mode="json"), "created": created})
    if rr.routes:
        evidence += _inferred_endpoints(ctx.world, from_id, to_id, rr.warnings)
    if scenario_id:
        evidence.append(
            Evidence(
                id=f"ev-scn-{scenario_id}",
                element_id=scenario_id,
                attribute="scenario",
                status="indicative",
                source_type=scenario_source(ctx.world, scenario_id),
            )
        )
    seen, uniq = set(), []
    for e in evidence:
        if e.id not in seen:
            seen.add(e.id)
            uniq.append(e)
    data = rr.model_dump(mode="json") | {
        "verification_requests": vrs,
        "verification_requests_truncated": truncated,
    }
    return ToolResult(ok=True, data=data, evidence=uniq, warnings=rr.warnings)


def _reach(w: World, src: list[str], profile, max_m: float, allow_unknown: bool) -> dict:
    """Walking distance (m) to every node within max_m, over edges this profile can use."""

    def weight(u, v, d):
        best = None
        for k in d:
            res, _ = evaluate_edge(w.edges[k], profile)
            if res == "FAIL" or (res == "UNKNOWN" and not allow_unknown):
                continue
            best = w.edges[k].length_m if best is None else min(best, w.edges[k].length_m)
        return best

    return nx.multi_source_dijkstra_path_length(w.graph, src, cutoff=max_m, weight=weight)


def nearby_amenities(
    ctx: Ctx, origin_id: str, amenity: str, max_walk_m: float = 300, profile: str = "default"
) -> ToolResult:
    w = ctx.world
    prof = w.profiles.get(profile)
    if prof is None or prof.stub:
        return ToolResult(ok=True, data=[], warnings=[f"unsupported profile {profile}"])
    src = routing._targets(w, origin_id, prof)
    if not src:
        why = "place not mapped" if origin_id in w.places else "no such place"
        warn = routing._no_road_warning(w, origin_id, prof) or f"{why}: {origin_id}"
        return ToolResult(ok=True, data=[], warnings=[warn])
    strict = _reach(w, src, prof, max_walk_m, allow_unknown=False)
    lenient = _reach(w, src, prof, max_walk_m, allow_unknown=True)
    hits = []
    for p in w.places.values():
        if p.type != amenity or not p.node_id:
            continue
        nodes = [p.node_id] if prof.allowed_types is None else routing._targets(w, p.id, prof)
        s_d = [strict[n] for n in nodes if n in strict]
        l_d = [lenient[n] for n in nodes if n in lenient]
        if s_d:
            hits.append((min(s_d), p, False))
        elif l_d:
            hits.append((min(l_d), p, True))
    hits.sort(key=lambda t: t[0])
    warnings = []
    if profile == "default":
        warnings.append("default profile applies no accessibility constraints")
    if prof.standing_warning:
        warnings.append(prof.standing_warning)
    return ToolResult(
        ok=True,
        data=[
            {"id": p.id, "name": p.name, "walk_m": round(d, 1), "via_unverified": unv}
            for d, p, unv in hits
        ],
        evidence=[_place_ev(p) for _, p, _ in hits],
        warnings=warnings,
    )


def get_closures(ctx: Ctx, scope_ids: list[str] | None = None) -> ToolResult:
    return ToolResult(ok=True, data=[], warnings=["closures not modelled in the skeleton"])


def create_verification_request(
    ctx: Ctx, target_id: str, attribute: str, reason: str, question_summary: str
) -> ToolResult:
    vr, created = ctx.vrs.request(target_id, attribute, reason, question_summary)
    return ToolResult(ok=True, data=vr.model_dump(mode="json") | {"created": created})


def list_flood_scenarios(ctx: Ctx) -> ToolResult:
    sc = ctx.world.flood.scenarios
    return ToolResult(
        ok=True,
        data=[s.model_dump(mode="json") for s in sc],
        evidence=[
            Evidence(
                id=f"ev-scn-{s.id}",
                element_id=s.id,
                attribute="scenario",
                status="indicative",
                source_type=f"{s.method} / {s.dem}",
            )
            for s in sc
        ],
    )


def affected_places(
    ctx: Ctx, scenario_id: str, kind: str = "all", profile: str = "default"
) -> ToolResult:
    if _flood.scenario(ctx.world, scenario_id) is None:
        return ToolResult(ok=False, warnings=[f"unknown scenario {scenario_id}"])
    if kind not in _flood._KIND:
        return ToolResult(ok=False, warnings=[f"unknown kind {kind}"])
    prof = ctx.world.profiles.get(profile)
    if prof is None:
        return ToolResult(ok=False, warnings=[f"unknown profile {profile}"])
    if prof.stub:
        return ToolResult(ok=False, warnings=[f"{profile} profile is not available yet"])
    a = _flood.affected(ctx.world, scenario_id, profile, kind)
    ev = [
        Evidence(
            id=f"ev-scn-{scenario_id}",
            element_id=scenario_id,
            attribute="scenario",
            status="indicative",
            source_type=scenario_source(ctx.world, scenario_id),
        )
    ]
    ev += [
        Evidence(
            id=f"ev-scn-{scenario_id}.{eid}",
            element_id=eid,
            attribute="flood",
            value=cls,
            status="indicative",
            source_type=scenario_source(ctx.world, scenario_id),
        )
        for cls, xs in (
            ("likely_flooded", a.likely_place_ids + a.likely_edge_ids),
            ("possible", a.possible_place_ids + a.possible_edge_ids),
        )
        for eid in xs
    ]
    return ToolResult(ok=True, data=a.model_dump(mode="json"), evidence=ev, warnings=a.warnings)


def list_evacuation_centres(
    ctx: Ctx,
    scenario_id: str | None = None,
    profile: str = "default",
    near_place: str | None = None,
) -> ToolResult:
    res = _flood.centres_reachability(ctx.world, scenario_id, profile, near_place)
    warnings = []
    prof = ctx.world.profiles.get(profile)
    if prof is None:
        warnings.append(f"unknown profile {profile}")
    elif prof.stub:
        warnings.append(f"{profile} profile is not available yet")
    elif prof.standing_warning:
        warnings.append(prof.standing_warning)
    if near_place and prof is not None and not routing._targets(ctx.world, near_place, prof):
        warnings.append(
            routing._no_road_warning(ctx.world, near_place, prof)
            or f"place not mapped: {near_place}"
        )
    if near_place and prof is not None and routing._targets(ctx.world, near_place, prof):
        n_gap = sum(1 for r in res if r.route_status == "no_data")
        if n_gap:
            warnings.append(
                f"{n_gap} centre(s) have no mapped connection from {near_place}; "
                "the path data may be incomplete, so they are not shown as unreachable"
            )
    ev = [
        Evidence(
            id=f"ev-centre-{r.centre.id}",
            element_id=r.centre.id,
            attribute="source",
            value=r.centre.source,
            status="reported" if r.centre.source == "official_pps" else "unknown",
            source_type="official PPS report"
            if r.centre.source == "official_pps"
            else "OSM candidate",
            source_url=r.centre.evidence_url,
        )
        for r in res
    ]
    data = [r.model_dump(mode="json") for r in res]
    sc = _flood.scenario(ctx.world, scenario_id) if scenario_id else None
    if scenario_id:
        ev.append(
            Evidence(
                id=f"ev-scn-{scenario_id}",
                element_id=scenario_id,
                attribute="scenario",
                status="indicative",
                source_type=scenario_source(ctx.world, scenario_id),
            )
        )
        if sc:
            for d in data:
                d["disclaimer"] = sc.disclaimer
        else:
            warnings.append(f"unknown scenario {scenario_id}")
    return ToolResult(ok=True, data=data, evidence=ev, warnings=warnings)


def find_waste_points(
    ctx: Ctx, type: str | None = None, near_place: str | None = None
) -> ToolResult:
    pts = [p for p in ctx.world.waste.values() if type is None or p.type == type]
    warnings = []
    if near_place:
        if pl := ctx.world.places.get(near_place):
            pts.sort(key=lambda p: haversine_m(p.coord, pl.coord))
        else:
            warnings.append(f"no such place: {near_place}")
    return ToolResult(
        ok=True,
        data=[p.model_dump(mode="json") for p in pts],
        warnings=warnings,
        evidence=[
            Evidence(
                id=f"ev-{p.id}.status",
                element_id=p.id,
                attribute="status",
                value=p.status,
                status=p.status,
                verified_at=p.verified_at,
                source_url=p.source_url,
            )
            for p in pts
        ],
    )


TOOLS = {
    f.__name__: f
    for f in (
        find_place,
        get_place_details,
        plan_route,
        nearby_amenities,
        get_closures,
        create_verification_request,
        list_flood_scenarios,
        affected_places,
        list_evacuation_centres,
        find_waste_points,
    )
}
