from __future__ import annotations

import difflib
from dataclasses import dataclass

import networkx as nx

from . import routing
from .models import Evidence, ToolResult
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


def find_place(ctx: Ctx, query: str, types: list[str] | None = None, limit: int = 5) -> ToolResult:
    q = query.strip().lower()
    if not q:
        return ToolResult(ok=True, data=[], warnings=["empty query"])
    scored = []
    for p in ctx.world.places.values():
        if types and p.type not in types:
            continue
        names = [p.name.lower(), *[a.lower() for a in p.aliases]]
        score = max(
            1.0 if q in n or n in q else difflib.SequenceMatcher(None, q, n).ratio() for n in names
        )
        if score >= 0.6:
            scored.append((score, p))
    scored.sort(key=lambda t: -t[0])
    top = [p for _, p in scored[:limit]]
    return ToolResult(
        ok=True,
        data=[
            {"id": p.id, "name": p.name, "type": p.type, "score": round(s, 2)}
            for s, p in scored[:limit]
        ],
        evidence=[_place_ev(p) for p in top],
    )


def get_place_details(ctx: Ctx, place_id: str) -> ToolResult:
    p = ctx.world.places.get(place_id)
    if p is None:
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
        )
        for a, c in p.claims.items()
    ]
    return ToolResult(ok=True, data=p.model_dump(mode="json"), evidence=ev)


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
    for r in rr.routes:
        evidence += routing.evidence_for_route(ctx.world, r)
        for u in r.unknowns:
            if u["attribute"] == "flood":
                continue
            vr, created = ctx.vrs.request(
                u["element_id"], u["attribute"], "unknown", question_summary
            )
            vrs.append({**vr.model_dump(mode="json"), "created": created})
    if rr.status == "no_data":
        for w in rr.warnings:
            if w.startswith("place not mapped: "):
                vr, created = ctx.vrs.request(
                    w.split(": ", 1)[1], "existence", "missing_place", question_summary
                )
                vrs.append({**vr.model_dump(mode="json"), "created": created})
    if scenario_id:
        evidence.append(
            Evidence(
                id=f"ev-scn-{scenario_id}",
                element_id=scenario_id,
                attribute="scenario",
                status="indicative",
                source_type="HAND scenario",
            )
        )
    seen, uniq = set(), []
    for e in evidence:
        if e.id not in seen:
            seen.add(e.id)
            uniq.append(e)
    data = rr.model_dump(mode="json") | {"verification_requests": vrs}
    return ToolResult(ok=True, data=data, evidence=uniq, warnings=rr.warnings)


def nearby_amenities(
    ctx: Ctx, origin_id: str, amenity: str, max_walk_m: float = 300, profile: str = "default"
) -> ToolResult:
    w = ctx.world
    src = routing._targets(w, origin_id)
    if not src:
        return ToolResult(ok=True, data=[], warnings=[f"place not mapped: {origin_id}"])
    dist = nx.multi_source_dijkstra_path_length(
        w.graph, src, cutoff=max_walk_m, weight=lambda u, v, d: min(w.edges[k].length_m for k in d)
    )
    hits = sorted(
        (
            (dist[p.node_id], p)
            for p in w.places.values()
            if p.type == amenity and p.node_id in dist
        ),
        key=lambda t: t[0],
    )
    return ToolResult(
        ok=True,
        data=[{"id": p.id, "name": p.name, "walk_m": round(d, 1)} for d, p in hits],
        evidence=[_place_ev(p) for _, p in hits],
    )


def get_closures(ctx: Ctx, scope_ids: list[str] | None = None) -> ToolResult:
    return ToolResult(ok=True, data=[], warnings=["closures not modelled in the skeleton"])


def create_verification_request(
    ctx: Ctx, target_id: str, attribute: str, reason: str, question_summary: str
) -> ToolResult:
    vr, created = ctx.vrs.request(target_id, attribute, reason, question_summary)
    return ToolResult(ok=True, data=vr.model_dump(mode="json") | {"created": created})
