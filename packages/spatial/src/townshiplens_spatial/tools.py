from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

import networkx as nx

from . import routing
from .evaluate import evaluate_edge
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
    filed: set[tuple[str, str]] = set()  # one VR per element/attribute per call (alt routes repeat)
    for r in rr.routes:
        evidence += routing.evidence_for_route(ctx.world, r)
        for u in r.unknowns:
            if u["attribute"] == "flood" or (u["element_id"], u["attribute"]) in filed:
                continue
            filed.add((u["element_id"], u["attribute"]))
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
    src = routing._targets(w, origin_id)
    if not src:
        why = "place not mapped" if origin_id in w.places else "no such place"
        return ToolResult(ok=True, data=[], warnings=[f"{why}: {origin_id}"])
    strict = _reach(w, src, prof, max_walk_m, allow_unknown=False)
    lenient = _reach(w, src, prof, max_walk_m, allow_unknown=True)
    hits = []
    for p in w.places.values():
        if p.type != amenity or not p.node_id:
            continue
        if p.node_id in strict:
            hits.append((strict[p.node_id], p, False))
        elif p.node_id in lenient:
            hits.append((lenient[p.node_id], p, True))
    hits.sort(key=lambda t: t[0])
    warnings = []
    if profile == "default":
        warnings.append("default profile applies no accessibility constraints")
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
