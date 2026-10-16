from __future__ import annotations

import difflib
import json
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass, replace

import networkx as nx

from . import flood as _flood
from . import models as _m
from . import routing
from .closure_store import ClosureStore
from .evaluate import evaluate_edge
from .geo import haversine_m
from .models import Claim, Closure, Evidence, ToolResult, photo_url
from .scenario_meta import scenario_source
from .vr_store import VerificationStore
from .world import World


@dataclass
class Ctx:
    world: World
    vrs: VerificationStore
    closures: ClosureStore | None = None  # API-owned; tools read closures from the world


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


def _centre_entrance_note(world: World, centre) -> str | None:
    """Task 43: a centre built from an area place whose walk node was inferred (nearest mapped
    path to the OSM area) has no mapped entrance; reachability stops at that path."""
    p = world.places.get(centre.place_id) if centre.place_id else None
    if not (centre.node_inferred or (p is not None and p.node_inferred)):
        return None
    return (
        f"Reachability ends at the nearest mapped path to {centre.name}; "
        "its entrance is not mapped."
    )


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
                "closure": row.closure,
                "route_id": row.route_id,
                "distance_m": row.distance_m,
                "from": near,
                "profile": profile,
                "scenario_id": scenario_id,
                "disclaimer": sc.disclaimer if sc else None,
            }
            note = _centre_entrance_note(ctx.world, c) if row.reachable else None
            if note:
                data["reachability"]["entrance_note"] = note
                warnings.append(note)
            if row.route_status == "closed":
                warnings.append(f"{CLOSURE_SOURCE_LABEL}: {c.name}. {row.closure}.")
                ev += _centre_closure_ev(ctx.world, c)
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
    data = p.model_dump(mode="json")
    for c in data["claims"].values():
        c.pop("notes", None)  # staff free text (resolve/PATCH note): public via /places and the LLM
    live = [c for c in p.closures if c.is_active()]
    data["closures"] = [closure_row(ctx.world, c) for c in live]
    ev += [_closure_ev(ctx.world, c) for c in live]
    return ToolResult(ok=True, data=data, evidence=ev)


def _inferred_endpoints(world: World, from_id: str, to_id: str, warnings: list[str]) -> list:
    """Task 43: a route to or from an area place whose walk node was inferred (nearest mapped
    path, not a mapped entrance) says so, and cites the access_point claim."""
    ev = []
    for pid, verb in ((from_id, "starts"), (to_id, "ends")):
        p = world.places.get(pid)
        if p is None or not p.node_inferred:
            continue
        # Review I2 (R28): routing prefers mapped entrances; then the route does end at one.
        if any(world.places.get(e) and world.places[e].node_id for e in p.entrance_ids):
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


MAX_CLOSURE_PROBES = 30


def _edge_closure_impact(
    world: World, rr, from_id: str, to_id: str, profile: str, scenario_id: str | None
) -> list[tuple]:
    """(edge, closure) pairs a staff-reported closure took out of this answer, or [].

    Search again on a shallow copy of the world whose closed edges have no closure. If that
    route uses closed edges, those closures are what blocked the question (no route now) or
    forced the detour (a different route now). Costs one extra search, and only while an edge
    closure is in force."""
    live = [(e, c) for e in world.edges.values() for c in e.closures if c.is_active()]
    if not live or rr.status == "no_data":
        return []
    opened = replace(
        world,
        edges={
            **world.edges,
            **{e.id: e.model_copy(update={"closures": []}) for e, _ in live},
        },
    )
    alt = routing.plan_route(opened, from_id, to_id, profile, scenario_id)
    if not alt.routes:
        return []
    used = {s.edge_id for s in alt.routes[0].segments}
    hit = [(e, c) for e, c in live if e.id in used]
    if rr.status == "blocked":
        # A closure that alone unblocks the question is also responsible (parallel closed
        # links: the opened route uses only one of them). Capped so a busy day stays cheap.
        for e, c in live[:MAX_CLOSURE_PROBES]:
            if (e, c) in hit:
                continue
            one = replace(world, edges={**world.edges, e.id: e.model_copy(update={"closures": []})})
            if routing.plan_route(one, from_id, to_id, profile, scenario_id).routes:
                hit.append((e, c))
    if rr.status != "blocked" and rr.routes and {s.edge_id for s in rr.routes[0].segments} == used:
        return []  # same route either way: no closure was in its way
    return hit


def _closure_notes(
    world: World, rr, from_id: str, to_id: str, profile: str, scenario_id: str | None
) -> list[Evidence]:
    """Name staff-reported closures that stop or reshape this answer: a closed start or
    destination place, and closed segments that left no route or forced a detour. They go in
    `rr.closures` (never truncated, unlike `blocked_reasons`) and in the warnings."""
    tz = world.site.timezone
    ev: list[Evidence] = []
    seen: set[str] = set()

    def add(c: Closure, name: str, kind: str, note: str = "") -> None:
        if c.id in seen:
            return
        seen.add(c.id)
        rr.closures.append(closure_row(world, c) | {"element_name": name, "impact": kind})
        rr.warnings.append(f"{CLOSURE_SOURCE_LABEL}: {name}. {c.label(tz)}.{note}")
        ev.append(_closure_ev(world, c))

    for pid in (from_id, to_id):
        p = world.places.get(pid)
        if p is None and pid.startswith(routing.CENTRE_PREFIX):  # a centre stands on its place
            c = world.centres.get(pid[len(routing.CENTRE_PREFIX) :])
            p = world.places.get(c.place_id) if c and c.place_id else None
        for c in p.closures if p else []:
            if c.is_active():
                add(c, p.name, "endpoint")
    for e, c in _edge_closure_impact(world, rr, from_id, to_id, profile, scenario_id):
        name = e.name or f"an unnamed {e.type.replace('_', ' ')}"
        if rr.status == "blocked":
            add(c, name, "blocked", " Without it a route would exist.")
        else:
            add(c, name, "detour", " The route below detours around it.")
    return ev


MAX_ROUTE_VRS = 10  # one question must not flood the staff verification queue


def plan_route(
    ctx: Ctx,
    from_id: str,
    to_id: str,
    profile: str,
    scenario_id: str | None = None,
    question_summary: str | None = None,
    file_vrs: bool = True,
) -> ToolResult:
    """`file_vrs=False` plans without writing: the anonymous REST route must not inflate the
    staff queue (final review Minor 2)."""
    rr = routing.plan_route(ctx.world, from_id, to_id, profile, scenario_id)
    evidence: list[Evidence] = []
    vrs = []
    filed: set[tuple[str, str]] = set()  # one VR per element/attribute per call (alt routes repeat)
    truncated = 0
    for r in rr.routes:
        evidence += routing.evidence_for_route(ctx.world, r)
        for u in r.unknowns:
            if (
                not file_vrs
                or u["attribute"] == "flood"
                or (u["element_id"], u["attribute"]) in filed
            ):
                continue
            filed.add((u["element_id"], u["attribute"]))
            if len(filed) > MAX_ROUTE_VRS:
                truncated += 1
                continue
            vr, created = ctx.vrs.request(
                u["element_id"], u["attribute"], u.get("reason", "unknown"), question_summary
            )
            vrs.append({**vr.model_dump(mode="json"), "created": created})
    if rr.status == "no_data" and file_vrs:
        for w in rr.warnings:
            if w.startswith("place not mapped: "):
                vr, created = ctx.vrs.request(
                    w.split(": ", 1)[1], "existence", "missing_place", question_summary
                )
                vrs.append({**vr.model_dump(mode="json"), "created": created})
    evidence += _closure_notes(ctx.world, rr, from_id, to_id, profile, scenario_id)
    if rr.routes or rr.status == "blocked":  # a blocked answer still rests on the snapped endpoint
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


CLOSURE_SOURCE_LABEL = "Reported closure (staff)"
NEAR_CLOSURE_M = 300.0


def _closure_anchor(world: World, element_id: str):
    """(name, kind, [lon, lat]) of the closed element, or None when it no longer exists."""
    e = world.edges.get(element_id)
    if e is not None:
        return e.name or f"Unnamed {e.type.replace('_', ' ')}", "edge", e.coords[len(e.coords) // 2]
    p = world.places.get(element_id)
    if p is not None:
        return p.name, "place", p.coord
    return None


def closure_row(world: World, c: Closure, now=None, with_note: bool = False) -> dict:
    """One closure as data. The staff `note` is free text (it can carry names or phone numbers),
    so it is left out unless `with_note` (staff-only API output): public and LLM-facing rows never
    carry it (PDPA, Task 55)."""
    tz = world.site.timezone
    zone = _m.site_tz(tz)
    anchor = _closure_anchor(world, c.element_id)
    return {
        "id": c.id,
        "element_id": c.element_id,
        "element_name": anchor[0] if anchor else None,
        "element_kind": anchor[1] if anchor else None,
        "reason": c.reason,
        "starts_at": c.starts_at.astimezone(zone).isoformat(),  # site-local, with offset
        "ends_at": c.ends_at.astimezone(zone).isoformat() if c.ends_at else None,
        "note": c.note if with_note else None,
        "label": c.label(tz),
        "source_label": CLOSURE_SOURCE_LABEL,
        "active": c.is_active(now),
    }


def _centre_closure_ev(world: World, centre) -> list[Evidence]:
    p = world.places.get(centre.place_id) if centre.place_id else None
    return [_closure_ev(world, c) for c in (p.closures if p else []) if c.is_active()]


def _closure_ev(world: World, c: Closure) -> Evidence:
    return Evidence(
        id=f"ev-closure-{c.id}",
        element_id=c.element_id,
        attribute="closure",
        value=c.label(),
        status="reported",
        verified_at=c.starts_at.astimezone(_m.site_tz(world.site.timezone)).date().isoformat(),
        source_type="staff report",
    )


def get_closures(ctx: Ctx, near_place: str | None = None, active_only: bool = True) -> ToolResult:
    """Staff-reported closures, soonest first. active_only=False also lists closures that have
    not started yet (expired ones are dropped when the world loads). With near_place, only
    closures on that place or within ~300 m of it, nearest first. A report, never a guarantee."""
    w = ctx.world
    now = _m.utcnow()
    found = list(w.closures)
    found = [c for c in found if not active_only or c.is_active(now)]
    warnings: list[str] = []
    dist: dict[str, float] = {}
    if near_place:
        origin = w.places.get(near_place)
        if origin is None:
            return ToolResult(ok=False, warnings=[f"no such place: {near_place}"])
        for c in found:
            anchor = _closure_anchor(w, c.element_id)
            if anchor is not None:
                dist[c.id] = (
                    0.0 if c.element_id == origin.id else haversine_m(origin.coord, anchor[2])
                )
        found = [c for c in found if dist.get(c.id, 1e9) <= NEAR_CLOSURE_M]
        found.sort(key=lambda c: (dist[c.id], c.id))
    else:
        found.sort(key=lambda c: (c.starts_at, c.id))
    if not found:
        warnings.append("no reported closures in the loaded data; this is not a guarantee")
    return ToolResult(
        ok=True,
        data=[closure_row(w, c, now) for c in found],
        evidence=[_closure_ev(w, c) for c in found],
        warnings=warnings,
    )


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
    n_inferred = 0
    for r, d in zip(res, data, strict=True):
        note = _centre_entrance_note(ctx.world, r.centre) if r.reachable else None
        if note:
            d["entrance_note"] = note
            n_inferred += 1
    closed = [r for r in res if r.route_status == "closed"]
    for r in closed:
        warnings.append(f"{CLOSURE_SOURCE_LABEL}: {r.centre.name}. {r.closure}.")
        ev += _centre_closure_ev(ctx.world, r.centre)
    if n_inferred:
        warnings.append(
            f"{n_inferred} reachable centre(s) end at the nearest mapped path to the site; "
            "their entrances are not mapped"
        )
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


# ---- Township World Model tools (Cycle 1): what-if rollouts ----------------------------------
SCOPES = ("journey", "suite", "evacuation")
SUITE_SAMPLE = 60  # journeys per what-if in chat (deterministic prefix of the suite)
# World-model runs are CPU-bound (seconds each): at most 2 at once per process, and identical
# requests on the same world version are answered from a small cache (the engine is
# deterministic), so a public endpoint or a looping model cannot stall chat for everyone.
_WM_SLOTS = threading.BoundedSemaphore(2)
_WM_WAIT_S = 20.0
_WM_CACHE: OrderedDict[str, ToolResult] = OrderedDict()
_WM_CACHE_MAX = 32
_WM_CACHE_LOCK = threading.Lock()


# Ticket impact (staff board) has its own, larger cache of small results keyed by the fact, not
# the ticket id, and waits briefly for a slot: cycling through ticket ids cannot evict chat
# what-ifs or queue threads behind the solver for long.
_IMPACT_CACHE: OrderedDict[str, ToolResult] = OrderedDict()
_IMPACT_CACHE_MAX = 512
_IMPACT_WAIT_S = 2.0


def wm_idle() -> bool:
    """No world-model request is running (both solver slots free)."""
    if not _WM_SLOTS.acquire(blocking=False):
        return False
    try:
        if not _WM_SLOTS.acquire(blocking=False):
            return False
        _WM_SLOTS.release()
        return True
    finally:
        _WM_SLOTS.release()


def _wm_cached(
    world: World,
    kind: str,
    args: dict,
    run,
    cache: OrderedDict[str, ToolResult] = _WM_CACHE,
    cache_max: int = _WM_CACHE_MAX,
    wait_s: float = _WM_WAIT_S,
) -> ToolResult:
    key = json.dumps([kind, id(world), world.version, args], sort_keys=True, default=str)
    with _WM_CACHE_LOCK:  # request threads and the warm-up thread share the caches
        hit = cache.get(key)
        if hit is not None:
            cache.move_to_end(key)
            return hit.model_copy(deep=True)
    if not _WM_SLOTS.acquire(timeout=wait_s):
        return ToolResult(ok=False, warnings=["the township model is busy; try again shortly"])
    try:
        res = run()
    finally:
        _WM_SLOTS.release()
    if res.ok and not (isinstance(res.data, dict) and res.data.get("stopped_early")):
        with _WM_CACHE_LOCK:
            cache[key] = res.model_copy(deep=True)  # a stopped (partial) search is not cached
            while len(cache) > cache_max:
                cache.popitem(last=False)
    return res


def _walking(world: World, profile: str) -> str | None:
    from . import twm

    if profile not in world.profiles or profile not in twm.WALKING:
        return f"what-ifs cover walking profiles only ({', '.join(twm.WALKING)})"
    return None


def suggest_interventions(ctx: Ctx, profile: str = "wheelchair", near_place: str | None = None):
    """Legal what-if actions proposed by the engine, with readable labels: ramps where steps
    block `profile`, facts staff could verify, and the paths most journeys rely on (to imagine
    them closed)."""

    w = ctx.world
    if err := _walking(w, profile):
        return ToolResult(ok=False, warnings=[err])
    if (
        near_place
        and near_place not in w.places
        and not near_place.startswith(routing.CENTRE_PREFIX)
    ):
        return ToolResult(ok=False, warnings=[f"unknown place {near_place}"])
    return _wm_cached(
        w,
        "suggest",
        {"profile": profile, "near_place": near_place},
        lambda: _suggest(w, profile, near_place),
    )


def _suggest(w: World, profile: str, near_place: str | None) -> ToolResult:
    from . import twm

    out = [
        {"action": a.model_dump(), "label": twm.describe(w, a)}
        for a in twm.suggest_actions(w, profile, near_place=near_place)
    ]
    out += [
        {
            "action": a.model_dump(),
            "label": twm.describe(w, a),
            "journeys_using_it": n,
        }
        for a, n in twm.keystone_paths(w, profile, near_place)
    ]
    stages = [s.id for s in w.flood.scenarios]
    return ToolResult(ok=True, data={"candidates": out, "river_stages": stages})


def simulate_what_if(
    ctx: Ctx,
    actions: list[dict],
    profile: str = "default",
    scope: str = "journey",
    from_id: str | None = None,
    to_id: str | None = None,
    scenario_id: str | None = None,
):
    """Imagine `actions` on a copy of the township and compare journeys before and after.

    scope journey: from_id -> to_id (to_id may be "__centre__<id>" or "nearest_centre");
    suite: sample resident journeys; evacuation: sampled origins -> nearest reachable centre.
    `scenario_id` is the stage already on screen (the "before" state). Never changes the real
    world; the result is labelled what-if."""
    from pydantic import TypeAdapter, ValidationError

    from . import twm

    w = ctx.world
    if err := _walking(w, profile):
        return ToolResult(ok=False, warnings=[err])
    if scenario_id and scenario_id not in {s.id for s in w.flood.scenarios}:
        return ToolResult(ok=False, warnings=[f"unknown scenario {scenario_id}"])
    if len(actions or []) > twm.MAX_ACTIONS:
        return ToolResult(ok=False, warnings=[f"at most {twm.MAX_ACTIONS} actions"])
    if scope not in SCOPES:
        return ToolResult(ok=False, warnings=[f"scope must be one of {', '.join(SCOPES)}"])
    try:
        acts = TypeAdapter(list[twm.Action]).validate_python(actions or [])
    except ValidationError as exc:
        return ToolResult(ok=False, warnings=[f"invalid actions: {exc.errors()[0]['msg']}"])
    if illegal := [r for a in acts if (r := twm.legal(w, a))]:
        return ToolResult(ok=False, warnings=[f"illegal action: {r}" for r in illegal])
    if scope == "journey":
        if not from_id or not to_id:
            return ToolResult(ok=False, warnings=["scope journey needs from_id and to_id"])
        dest = twm.NEAREST_CENTRE if to_id in ("nearest_centre", twm.NEAREST_CENTRE) else to_id
        journeys = [twm.Journey(from_id=from_id, to_id=dest, profile=profile)]
    elif scope == "suite":
        journeys = twm.suite_journeys(w, profile)[:SUITE_SAMPLE]
    else:
        journeys = twm.evacuation_journeys(w, profile)
    base = scenario_id if scenario_id and scenario_id != "baseline" else None
    args = {
        "actions": [a.model_dump(mode="json") for a in acts],
        "profile": profile,
        "journeys": [j.model_dump() for j in journeys],
        "base": base,
    }
    return _wm_cached(w, "whatif", args, lambda: _simulate(w, acts, journeys, base, scope, profile))


def _simulate(w: World, acts, journeys, base, scope: str, profile: str) -> ToolResult:
    from . import twm

    res = twm.compare(w, acts, journeys, base_scenario_id=base)
    data = res.model_dump(mode="json")
    data["action_labels"] = [twm.describe(w, a) for a in acts]
    data["diff_geojson"] = _diff_geojson(w, res, data["action_labels"], scope, profile)
    data["scope"] = scope
    data["profile"] = profile
    data["imagined"] = bool(res.touched)  # any non-stage change: outcomes are "would be"
    for o in data["journeys"]:
        for side in ("before", "after"):
            o[side].pop("geometry", None)  # the agent gets geometry from the record, not here
        o["from_name"] = _place_name(w, o["journey"]["from_id"])
    data["changed"] = [o for o in data["journeys"] if o["before"]["status"] != o["after"]["status"]]
    data["journeys"] = data["journeys"][:10] if scope != "journey" else data["journeys"]
    data["changed"] = data["changed"][:10]
    data["changed_truncated"] = res.summary["changed"] > 10
    return ToolResult(ok=True, data=data, evidence=[res.evidence], warnings=[res.disclaimer])


def _diff_geojson(world: World, res, labels: list[str], scope: str, profile: str) -> dict:
    """Before/after lines of the journeys that changed, plus the imagined paths, for the map.
    Every feature is tagged `whatif` so a renderer can never draw it as a real route. The `meta`
    member (a GeoJSON foreign member) carries the engine's summary and readable names, so the
    lite map and the list view can show the same what-if without recomputing anything."""
    from . import twm

    feats = []
    changed = []
    for i, o in enumerate(res.changed[:20]):
        names = {
            "from_name": twm._name(world, o.journey.from_id) or "a mapped place",
            "to_name": o.after.target_name
            or o.before.target_name
            or twm._name(world, o.journey.to_id)
            or "a mapped place",
        }
        # Both statuses, whether or not a side has a line (a cut route has no "after" geometry).
        changed.append({**names, "before": o.before.status, "after": o.after.status})
        for side in ("before", "after"):
            st = getattr(o, side)
            if st.geometry:
                feats.append(
                    {
                        "type": "Feature",
                        "geometry": st.geometry,
                        "properties": {
                            "whatif": True,
                            "side": side,
                            "status": st.status,
                            "journey": i,
                            **names,
                        },
                    }
                )
    for eid in res.touched:
        e = world.edges.get(eid)
        if e is not None:
            feats.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": e.coords},
                    "properties": {
                        "whatif": True,
                        "side": "touched",
                        "element_id": eid,
                        "label": twm.path_label(world, eid),
                    },
                }
            )
    meta = {
        "summary": res.summary,
        "actions": labels,
        "profile": profile,
        "scope": scope,
        "imagined": bool(res.touched),
        "base_scenario_id": res.base_scenario_id,
        "scenario_id": res.scenario_id,
        "changed_shown": len(changed),
        "changed": changed,
    }
    return {"type": "FeatureCollection", "features": feats, "meta": meta}


def _place_name(world: World, pid: str) -> str | None:
    p = world.places.get(pid)
    return p.name if p else None


TOOLS["suggest_interventions"] = suggest_interventions
TOOLS["simulate_what_if"] = simulate_what_if


def plan_verifications(
    ctx: Ctx, profile: str = "wheelchair", scope: str = "evacuation", budget: int = 15
):
    """Survey plan (staff): which unchecked facts to verify first so the most sample journeys
    would be confirmed, if those facts pass. Verified on the world model; open tickets linked."""
    from . import belief

    w = ctx.world
    if err := _walking(w, profile):
        return ToolResult(ok=False, warnings=[err])
    if scope not in ("suite", "evacuation"):
        return ToolResult(ok=False, warnings=["scope must be suite or evacuation"])
    tickets: dict[tuple[str, str], str] = {}
    for status in ("open", "in_progress"):
        for vr in ctx.vrs.list(status=status):
            tickets.setdefault((vr.element_id, vr.attribute), vr.id)
    prior = belief.load_prior(w.data_dir / "belief_prior.json") if w.data_dir else {}
    args = {
        "profile": profile,
        "scope": scope,
        "budget": int(budget),
        "tickets": sorted(tickets.items()),
    }
    return _wm_cached(
        w, "plan", args, lambda: _plan(w, profile, scope, int(budget), tickets, prior)
    )


def _plan(w: World, profile, scope, budget, tickets, prior) -> ToolResult:
    from . import planner

    plan = planner.plan_verifications(w, profile, scope, budget, tickets, prior=prior)
    data = plan.model_dump(mode="json")
    data["places"] = len({f["element_id"] for f in data["facts"]})
    ev = Evidence(
        id=plan.evidence_id,
        element_id="plan",
        attribute="verify_next",
        value={"facts": len(plan.facts)},
        status="indicative",
        source_type="whatif",
    )
    return ToolResult(ok=True, data=data, evidence=[ev], warnings=[plan.disclaimer])


TOOLS["plan_verifications"] = plan_verifications


def river_tipping_point(ctx: Ctx, from_id: str, profile: str = "default", to_id: str | None = None):
    """One journey across every river stage (to a place, or the nearest evacuation centre):
    the status per stage and the first stage where it degrades or breaks. Indicative."""
    from . import rollout

    w = ctx.world
    if err := _walking(w, profile):
        return ToolResult(ok=False, warnings=[err])
    if from_id not in w.places or (to_id and to_id not in w.places):
        return ToolResult(ok=False, warnings=["unknown place: use ids from find_place"])
    tp = rollout.tipping_point(w, from_id, profile, to_id)
    data = tp.model_dump(mode="json")
    p = w.places.get(from_id)
    data["from_name"] = p.name if p else None
    if to_id:
        data["target_name"] = w.places[to_id].name
    ev = Evidence(
        id=tp.evidence_id,
        element_id=from_id,
        attribute="tipping_point",
        value=tp.breaks_at,
        status="indicative",
        source_type=scenario_source(w, "stage_p3m") if w.flood.scenarios else None,
    )
    return ToolResult(ok=True, data=data, evidence=[ev], warnings=[tp.disclaimer])


def rising_river_rollout(ctx: Ctx, profiles: list[str] | None = None, n: int = 30):
    """Synthetic residents per persona heading for the nearest evacuation centre at every river
    stage: counts per stage and who is cut off first. Indicative simulation, not a forecast."""
    from . import rollout

    w = ctx.world
    for p in set(profiles or []):
        if err := _walking(w, p):
            return ToolResult(ok=False, warnings=[err])
    # Deduplicated, ordered and capped, so repeats or permutations neither cost nor bust the cache.
    profs = rollout.normalise_profiles(profiles)
    n = max(5, min(int(n), 50))
    return _wm_cached(w, "rollout", {"profiles": profs, "n": n}, lambda: _rollout(w, profs, n))


def _rollout(w: World, profs: list[str], n: int) -> ToolResult:
    from . import rollout

    r = rollout.river_rollout(w, profs, n)
    data = r.model_dump(mode="json")
    stage_label = {s.id: s.label for s in r.stages}
    data["first_cut_off"] = [
        {
            "origin_name": res.origin_name,
            "profile": res.profile,
            "stage": res.tipping_stage,
            "stage_label": stage_label.get(res.tipping_stage or ""),
        }
        for res in sorted(
            (x for x in r.residents if x.tipping_stage),
            key=lambda x: ([s.id for s in r.stages].index(x.tipping_stage), x.id),
        )
    ][:10]
    ev = Evidence(
        id=r.evidence_id,
        element_id="rollout",
        attribute="river_rollout",
        value={"residents": len(r.residents)},
        status="indicative",
        source_type="whatif",
    )
    return ToolResult(ok=True, data=data, evidence=[ev], warnings=[r.disclaimer])


TOOLS["river_tipping_point"] = river_tipping_point
TOOLS["rising_river_rollout"] = rising_river_rollout


def find_fixes(
    ctx: Ctx,
    profile: str = "wheelchair",
    scope: str = "evacuation",
    scenario_id: str | None = None,
    budget: int = 2,
    proposals: list[dict] | None = None,
):
    """Fix-it search: the best set of up to `budget` imagined fixes (ramps, verifications) for
    `profile` under an optional river stage, scored by rolling each set out on the world model.
    `proposals` are extra legal actions the assistant suggests (illegal ones are rejected)."""

    w = ctx.world
    if err := _walking(w, profile):
        return ToolResult(ok=False, warnings=[err])
    if scenario_id and scenario_id not in {s.id for s in w.flood.scenarios}:
        return ToolResult(ok=False, warnings=[f"unknown scenario {scenario_id}"])
    if scope not in ("suite", "evacuation"):
        return ToolResult(ok=False, warnings=["scope must be suite or evacuation"])
    from . import fixit as _fx

    props = sorted(json.dumps(p, sort_keys=True, default=str) for p in (proposals or [])[:10])
    args = {
        "profile": profile,
        "scope": scope,
        "stage": None if scenario_id in (None, "", "baseline") else scenario_id,
        "budget": max(1, min(int(budget), _fx.MAX_BUDGET)),
        "proposals": [json.loads(p) for p in props],
    }
    return _wm_cached(w, "fixit", args, lambda: _fixes(w, args))


def _fixes(w: World, a: dict) -> ToolResult:
    from . import fixit

    r = fixit.find_fixes(
        w, a["profile"], a["scope"], a["stage"], a["budget"], extra_actions=a["proposals"]
    )
    data = r.model_dump(mode="json")
    ev = Evidence(
        id=r.evidence_id,
        element_id="fixit",
        attribute="find_fixes",
        value={"rollouts": r.rollouts},
        status="indicative",
        source_type="whatif",
    )
    return ToolResult(ok=True, data=data, evidence=[ev], warnings=[r.disclaimer])


TOOLS["find_fixes"] = find_fixes


def ticket_impact(ctx: Ctx, vr_id: str):
    """What one verification ticket would change (open) or changed (resolved) on the world
    model: sampled journeys, the ticket's own journey, and the belief. Staff planning only."""
    from . import belief, impact

    vr = ctx.vrs.get(vr_id)
    if vr is None:
        return ToolResult(ok=False, warnings=[f"unknown verification request {vr_id}"])
    w = ctx.world
    prior = belief.load_prior(w.data_dir / "belief_prior.json") if w.data_dir else {}
    status = "resolved" if vr.status == "resolved" else "open"
    args = {
        "element": vr.element_id,
        "attr": vr.attribute,
        "status": status,
        "summary": vr.question_summary,
    }
    return _wm_cached(
        w,
        "impact",
        args,
        lambda: ToolResult(
            ok=True,
            data=impact.fact_impact(
                w, vr.element_id, vr.attribute, vr.question_summary, prior, status
            ).model_dump(mode="json"),
        ),
        cache=_IMPACT_CACHE,
        cache_max=_IMPACT_CACHE_MAX,
        wait_s=_IMPACT_WAIT_S,
    )


# ---- Elmina Day (Cycle 10): synthetic residents living a day on the world model -------------
DAY_RESIDENTS = 5000
_DAY_CACHE: OrderedDict[str, ToolResult] = OrderedDict()


def day_scenarios(ctx: Ctx) -> list[dict]:
    from .day.scenarios import scenarios

    return [
        {"id": s.id, "label": s.label, "summary": s.summary, "hero": s.hero, "day": s.day}
        for s in scenarios(ctx.world).values()
    ]


def day_rehearsal(ctx: Ctx, scenario_id: str = "weekday") -> ToolResult:
    """A simulated day of 5,000 synthetic residents in one built-in scenario: counts by group,
    a timeline, busy places and map tracks. A rehearsal on the township model, not a forecast.
    Cached per world version (about 5 s on the seed when cold)."""
    from .day import engine, summary
    from .day.scenarios import scenarios

    w = ctx.world
    sc = scenarios(w)
    if scenario_id not in sc:
        return ToolResult(ok=False, warnings=[f"unknown day scenario {scenario_id}"])
    return _wm_cached(
        w,
        "day",
        {"s": scenario_id, "n": DAY_RESIDENTS},
        lambda: ToolResult(
            ok=True,
            data=summary.report(engine.Day(w, sc[scenario_id], n_residents=DAY_RESIDENTS).run()),
        ),
        cache=_DAY_CACHE,
        cache_max=16,
    )
