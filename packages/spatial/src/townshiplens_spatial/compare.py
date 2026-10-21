"""Navigation compare (demo polish, spec §5.1): the fastest route against the profile's route.

`fastest` is the `default` profile's route (shortest walk); `recommended` is the requested
profile's route, exactly as `routing.plan_route` plans it. The fastest route is then evaluated
under the requested profile: its first known FAIL is the stop point.

Reasons use **known facts only** (spec D2, AC-B3/B4): a value counts when the evaluator could
rest a result on it, i.e. a verified, valued, fresh claim (`not _needs_verification`), or a
reported/verified value that breaks one of the profile's hard limits (a known barrier). An
unknown value never counts for or against a route; unknown stretches are listed separately as
`unchecked`.

Pure function of the world: nothing is written (the tool wrapper files the ticket).
"""

from __future__ import annotations

import heapq
import itertools
import math
from datetime import date
from typing import Any

from . import journey, routing
from .direction import allows_direction
from .evaluate import _CHECKS, _needs_verification, rest_point_state
from .models import (
    CompareResult,
    Evidence,
    Poi,
    Profile,
    ReasonSet,
    Route,
    RouteReasons,
    StopPoint,
    UncheckedStretch,
)
from .scenario_meta import selection_error
from .world import World

SEATING_NEAR_M = 15.0  # a known rest place this close to the route counts as a rest stop
# Not survey gaps: a scenario's possible-flood class or raster coverage is never "not checked".
_NOT_A_CHECK = frozenset({"flood", "flood_coverage"})
_ATTR_ORDER = ("step_count", "incline_pct", "width_m", "sidewalk")
_POI_ORDER = ("kerb", "covered_start", "incline", "seating", "unknown", "arrival")
_HARD_KEY = {attr: key for key, (attr, _) in _CHECKS.items()}  # attribute -> hard limit key
_LOWERED = frozenset({"lowered", "flush"})
_YES = frozenset({True, "yes", "true"})


def compare(
    world: World, from_id: str, to_id: str, profile: str, scenario_id: str | None = None
) -> CompareResult:
    """Fastest vs recommended route for `profile`. Raises ValueError for an unknown or
    unavailable profile or scenario (the tool turns it into a warning)."""
    if error := selection_error(world, profile, scenario_id):
        raise ValueError(error)
    prof = world.profiles[profile]
    today = date.today()
    with routing.eval_memo():
        # plan_route decides no_data / blocked (and their warnings) exactly as /routes does.
        rr = routing.plan_route(world, from_id, to_id, profile, scenario_id)
        fast = _neutral_route(world, from_id, to_id, prof, scenario_id, fastest=True)
        rec = None
        if rr.routes:
            rec = _neutral_route(world, from_id, to_id, prof, scenario_id) or rr.routes[0]
            if fast is not None and _stop(world, fast, prof, scenario_id, today, {}) is None:
                # Ruling R21: the shortest walk has no known FAIL for the profile, so it is the
                # recommendation and there is nothing to compare (same_path).
                rec = _neutral_route(
                    world, from_id, to_id, prof, scenario_id, fastest=True, as_profile=True
                )
        evidence: dict[str, Evidence] = {}
        if fast is not None:
            _add(evidence, routing.evidence_for_route(world, fast))
        if rec is None:
            # no_data / blocked short-circuit: no stop, no unchecked stretch, no ticket.
            fast_reasons = None
            if fast is not None:
                rests = _rest_stops(world, fast, today)
                fast_reasons = _reasons(world, fast, prof, today, evidence, rests)
            return CompareResult(
                status=rr.status,
                profile=profile,
                same_path=False,
                fastest=fast,
                reasons=RouteReasons(fastest=fast_reasons),
                evidence=list(evidence.values()),
                warnings=list(rr.warnings),
            )
        _add(evidence, routing.evidence_for_route(world, rec))
        same = fast is not None and _edge_ids(fast) == _edge_ids(rec)
        if same:
            fast = rec
        stop = None
        if fast is not None and not same:
            stop = _stop(world, fast, prof, scenario_id, today, evidence)
        rec_rests = _rest_stops(world, rec, today)
        rec_reasons = _reasons(world, rec, prof, today, evidence, rec_rests)
        fast_reasons = rec_reasons
        if fast is not None and not same:
            fast_rests = _rest_stops(world, fast, today)
            fast_reasons = _reasons(world, fast, prof, today, evidence, fast_rests)
        unchecked = _unchecked(world, rec)
        return CompareResult(
            status=rec.status,
            profile=profile,
            same_path=same,
            fastest=fast,
            recommended=rec,
            stop=stop,
            reasons=RouteReasons(fastest=fast_reasons if fast else None, recommended=rec_reasons),
            extra_minutes=(
                round(max(0.0, rec.est_minutes - fast.est_minutes), 1) if fast is not None else None
            ),
            unchecked=unchecked,
            pois=_pois(world, rec, prof, today, evidence, unchecked, rec_rests),
            evidence=list(evidence.values()),
            warnings=_route_warnings(rr.warnings, rec, prof),
        )


def _route_warnings(warnings: list[str], rec: Route, prof: Profile) -> list[str]:
    """plan_route's warnings, with its two per-route notes (map estimates, road centre lines)
    rewritten for the recommended route: plan_route's own route can be a different one."""
    own = [
        w
        for w in warnings
        if not (
            w.startswith("Likely OK sections are estimated")
            or (w.startswith("About ") and "road centre" in w)
        )
    ]
    notes = []
    if rec.access_metres.get("likely_ok", 0):
        notes.append("Likely OK sections are estimated from map data, not checked on site")
    if prof.allowed_types is None and rec.road_without_mapped_sidewalk_m:
        notes.append(
            f"About {rec.road_without_mapped_sidewalk_m:.0f} m follows road centre lines "
            "without a mapped sidewalk; sidewalk access is not verified"
        )
    return notes + own


# ---------------------------------------------------------------- unknown-neutral search


def _neutral_cost(world: World, prof: Profile, scenario_id, key: str, by_length: bool):
    """Search cost of one edge, or None when it is a known FAIL for `prof`.

    Ruling R20 (spec D2, AC-B3): an UNKNOWN edge costs exactly what it would cost as PASS, so no
    unknown fact can change which route wins; only known FAILs are excluded. `by_length` (the
    fastest walk, ruling R21) costs plain metres; otherwise only the profile's type preferences
    apply (steps multiplier, the walking road multiplier), never a claim-based weight.
    """
    res, _ = routing._evaluate(world, prof, scenario_id, key)
    if res == "FAIL":
        return None
    e = world.edges[key]
    w = e.length_m
    if by_length:
        return w
    if e.type == "steps":
        w *= prof.soft.get("steps_multiplier", 1.0)
    if prof.allowed_types is None and e.type in routing.ROAD_TYPES:
        w *= routing.WALK_ROAD_MULTIPLIER
    return w


def _neutral_route(
    world: World,
    from_id: str,
    to_id: str,
    prof: Profile,
    scenario_id,
    *,
    fastest: bool = False,
    as_profile: bool = False,
) -> Route | None:
    """Cheapest route by `_neutral_cost`, built and evaluated by the normal route builder.

    `fastest`: the length-shortest walk over edges the `default` profile does not FAIL, built as
    a `default` route (R21). With `as_profile` the same walk is built and evaluated under `prof`
    (the R21 same-path recommendation). Otherwise: the cheapest walk over edges `prof` does not
    FAIL, unknown edges costed as PASS (R20)."""
    search = world.profiles["default"] if fastest else prof
    build = prof if as_profile or not fastest else search
    sources = routing._targets(world, from_id, search)
    targets = set(routing._targets(world, to_id, search))
    if not sources or not targets:
        return None
    g = world.graph
    seen: dict[str, float] = {}
    done: set[str] = set()
    pred: dict[str, tuple[str, str]] = {}
    tick = itertools.count()
    heap: list[tuple[float, int, str]] = []
    for s in dict.fromkeys(sources):
        seen[s] = 0.0
        heapq.heappush(heap, (0.0, next(tick), s))
    end = None
    while heap:
        dist, _, v = heapq.heappop(heap)
        if v in done:
            continue
        done.add(v)
        if v in targets:
            end = v
            break
        for u, data in g[v].items():
            if u in done:
                continue
            best = None
            for key in data:  # MultiGraph: data = {edge_id: attrs}
                if not allows_direction(world.edges[key], search.id, v):
                    continue
                c = _neutral_cost(world, search, scenario_id, key, fastest)
                if c is not None and (best is None or c < best[0]):
                    best = (c, key)
            if best is not None and (u not in seen or dist + best[0] < seen[u]):
                seen[u] = dist + best[0]
                pred[u] = (v, best[1])
                heapq.heappush(heap, (seen[u], next(tick), u))
    if end is None:
        return None
    nodes, keys = [end], []
    while nodes[-1] in pred:
        v, key = pred[nodes[-1]]
        nodes.append(v)
        keys.append(key)
    nodes.reverse()
    keys.reverse()
    evals = {k: routing._evaluate(world, build, scenario_id, k) for k in keys}
    route = routing._route_from_nodes(world, nodes, keys, from_id, to_id, build, scenario_id, evals)
    # Endpoint flood unknowns, exactly as routing.plan_route adds them.
    extra = [
        why
        for pid in dict.fromkeys((from_id, to_id))
        for state, reasons in [
            routing.endpoint_flood(world, pid, build, scenario_id)
            if pid == to_id
            else routing.origin_flood(world, pid, build, scenario_id)
        ]
        if state == "UNKNOWN"
        for why in reasons
    ]
    if extra:
        route.unknowns.extend(extra)
        route.status = "partly_unverified"
    return route


# ---------------------------------------------------------------- helpers


def _add(evidence: dict[str, Evidence], evs) -> None:
    for ev in evs:
        evidence.setdefault(ev.id, ev)


def _edge_ids(route: Route) -> list[str]:
    return [s.edge_id for s in route.segments]


def _starts(world: World, route: Route) -> list[float]:
    """Distance from the route start to the start of each segment (edge `length_m` sums)."""
    out, at = [], 0.0
    for s in route.segments:
        out.append(round(at, 1))
        at += world.edges[s.edge_id].length_m
    return out


def _implied_steps(edge, claim) -> bool:
    """`evaluate_edge` reads a steps edge as a reported step unless a claim says otherwise."""
    return edge.type == "steps" and (
        claim is None or claim.value is None or claim.status not in ("verified", "reported")
    )


def _type_evidence(edge) -> Evidence:
    return Evidence(
        id=f"ev-{edge.id}.type",
        element_id=edge.id,
        attribute="type",
        value=edge.type,
        status="reported",
        source_type="osm_import",
    )


def _known(edge, attr: str, prof: Profile, today: date, evidence: dict[str, Evidence]):
    """(value, evidence id) when the evaluation of `attr` on this edge is known, else None."""
    c = edge.claims.get(attr)
    key = _HARD_KEY.get(attr)
    limit = prof.hard.get(key) if key else None
    if attr == "step_count" and _implied_steps(edge, c):
        if limit is None:
            return None  # the evaluator only reads the implied step against a step limit
        value = max((c.value or 0) if c else 0, 1)
        ev = _type_evidence(edge)
        _add(evidence, [ev])
        return value, ev.id
    if c is None or c.value is None:
        return None
    ev_id = f"ev-{edge.id}.{attr}"
    if ev_id not in evidence:
        return None  # every value must trace to returned evidence (AC-B4)
    breaks = (
        limit is not None
        and c.status in ("verified", "reported")
        and _CHECKS[key][1](c.value, limit)
    )
    if breaks or not _needs_verification(c, attr, today):
        return c.value, ev_id
    return None


def _stop(world, fast: Route, prof: Profile, scenario_id, today, evidence) -> StopPoint | None:
    for s, at in zip(fast.segments, _starts(world, fast), strict=True):
        edge = world.edges[s.edge_id]
        res, why = routing._evaluate(world, prof, scenario_id, s.edge_id)
        if res != "FAIL":
            continue
        attr = why[0]["attribute"] if why else "unknown"
        key = _HARD_KEY.get(attr)
        limit = prof.hard.get(key) if key else None
        value: Any = None
        ev_id: str | None = None
        c = edge.claims.get(attr)
        if attr == "step_count" and _implied_steps(edge, c):
            value = max((c.value or 0) if c else 0, 1)
            ev = _type_evidence(edge)
            _add(evidence, [ev])
            ev_id = ev.id
        elif attr == "flood":
            value = routing._flood_class(world, scenario_id, s.edge_id)
            ev_id = f"ev-scn-{scenario_id}.{s.edge_id}"
        elif c is not None:
            value = c.value
            ev_id = f"ev-{edge.id}.{attr}"
        else:
            value = edge.osm_tags.get(attr)
        return StopPoint(
            edge_id=s.edge_id,
            at_m=at,
            attribute=attr,
            value=value,
            limit=limit,
            evidence_id=ev_id if ev_id in evidence else None,
        )
    return None


def _node_positions(world: World, route: Route) -> dict[str, float]:
    """First distance (edge `length_m` sums) at which the route visits each node."""
    if not route.segments:
        return {route.target_node: 0.0}
    _, segs, _ = journey._orient(world, route)
    out: dict[str, float] = {segs[0].u: 0.0}
    at = 0.0
    for sg in segs:
        at += sg.edge.length_m
        out.setdefault(sg.v, round(at, 1))
    return out


def _project(route: Route) -> Any:
    """A function lonlat -> (distance to the route polyline m, position along it in route m)."""
    poly = route.geometry.get("coordinates") or []
    kx, ky = journey._metric(poly)
    pts = [(c[0] * kx, c[1] * ky) for c in poly]
    cum = [0.0]
    for p, q in zip(pts, pts[1:], strict=False):
        cum.append(cum[-1] + math.dist(p, q))
    scale = route.distance_m / cum[-1] if cum[-1] > 0 else 0.0

    def at(lonlat) -> tuple[float, float]:
        x, y = lonlat[0] * kx, lonlat[1] * ky
        best = (math.inf, 0.0)
        for i, (p, q) in enumerate(zip(pts, pts[1:], strict=False)):
            dx, dy = q[0] - p[0], q[1] - p[1]
            seg2 = dx * dx + dy * dy
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((x - p[0]) * dx + (y - p[1]) * dy) / seg2))
            d = math.hypot(x - (p[0] + t * dx), y - (p[1] + t * dy))
            if d < best[0]:
                best = (d, (cum[i] + t * math.sqrt(seg2)) * scale)
        if len(pts) == 1:
            best = (math.hypot(x - pts[0][0], y - pts[0][1]), 0.0)
        return best

    return at


def _rest_stops(world: World, route: Route, today: date) -> list[tuple[Any, float]]:
    """Known rest stops: the route's verified rest points, plus known (PASS) seating or shelter
    places within SEATING_NEAR_M of the route. [(place, at_m)] in route order."""
    nodes = _node_positions(world, route)
    found: dict[str, tuple[Any, float]] = {}
    for r in route.rest_points:
        p = world.places.get(r["place_id"])
        if p is not None and r["status"] == "verified" and r["node_id"] in nodes:
            found[p.id] = (p, nodes[r["node_id"]])
    at = _project(route)
    for p in world.places.values():
        if p.id in found or p.type not in routing.REST_TYPES:
            continue
        if rest_point_state(p, today) != "PASS" or any(c.is_active() for c in p.closures):
            continue
        d, pos = at(p.coord)
        if d <= SEATING_NEAR_M:
            found[p.id] = (p, round(pos, 1))
    return sorted(found.values(), key=lambda pa: (pa[1], pa[0].id))


def _reasons(world, route: Route, prof: Profile, today, evidence, rests) -> ReasonSet:
    steps, inclines, widths = [], [], []
    ev: dict[str, list[str]] = {}
    covered_m, covered_known = 0.0, False
    for s in route.segments:
        edge = world.edges[s.edge_id]
        for attr, bucket, field in (
            ("step_count", steps, "steps"),
            ("incline_pct", inclines, "max_incline_pct"),
            ("width_m", widths, "min_width_m"),
        ):
            if (k := _known(edge, attr, prof, today, evidence)) is not None:
                bucket.append(k[0])
                ev.setdefault(field, []).append(k[1])
        if (k := _known(edge, "covered", prof, today, evidence)) is not None:
            covered_known = True
            ev.setdefault("covered_share", []).append(k[1])
            if k[0] in _YES:
                covered_m += edge.length_m
    for p, _ in rests:
        evs = routing.rest_claim_evidence(world, p.id)
        _add(evidence, evs)
        ev.setdefault("rest_stops", []).extend(e.id for e in evs)
    walk = f"ev-{route.id}.walkways"
    ev["distance_m"] = ev["minutes"] = [walk]
    share = None
    if covered_known and route.distance_m > 0:
        share = round(round(covered_m / route.distance_m / 0.05) * 0.05, 2)
    return ReasonSet(
        steps=int(sum(steps)) if steps else None,
        max_incline_pct=max(abs(v) for v in inclines) if inclines else None,
        min_width_m=min(widths) if widths else None,
        covered_share=share,
        # No known rest stop is not a known absence (a bench may be unmapped): None, not 0.
        rest_stops=len(rests) or None,
        distance_m=route.distance_m,
        minutes=route.est_minutes,
        evidence_ids={k: list(dict.fromkeys(v)) for k, v in ev.items()},
    )


def _unchecked(world: World, route: Route) -> list[UncheckedStretch]:
    """Contiguous runs of UNKNOWN edges per attribute (from `route.unknowns`), in route order."""
    attrs_of: dict[str, list[str]] = {}
    for u in route.unknowns:
        if u["attribute"] not in _NOT_A_CHECK:
            attrs_of.setdefault(u["element_id"], []).append(u["attribute"])
    lengths = [world.edges[s.edge_id].length_m for s in route.segments]
    starts = _starts(world, route)
    attrs = sorted(
        {a for v in attrs_of.values() for a in v},
        key=lambda a: (_ATTR_ORDER.index(a) if a in _ATTR_ORDER else len(_ATTR_ORDER), a),
    )
    out: list[UncheckedStretch] = []
    for attr in attrs:
        run: list[Any] | None = None
        for s, start, length in zip(route.segments, starts, lengths, strict=True):
            if s.eval == "UNKNOWN" and attr in attrs_of.get(s.edge_id, ()):
                if run is None:
                    run = [s.edge_id, start, start + length]
                else:
                    run[2] = start + length
                continue
            if run is not None:
                out.append(_stretch(attr, run))
                run = None
        if run is not None:
            out.append(_stretch(attr, run))
    order = {a: i for i, a in enumerate(attrs)}
    return sorted(out, key=lambda u: (u.start_m, order[u.attribute]))


def _stretch(attr: str, run: list[Any]) -> UncheckedStretch:
    start, end = round(run[1], 1), round(run[2], 1)
    return UncheckedStretch(
        edge_id=run[0], attribute=attr, start_m=start, end_m=end, length_m=round(end - start, 1)
    )


def _pois(world, route: Route, prof, today, evidence, unchecked, rests) -> list[Poi]:
    out: list[Poi] = []

    def poi(kind, at, value, ids):
        ids = [i for i in dict.fromkeys(ids) if i in evidence]
        demo = any(evidence[i].source_type == routing.PLACEHOLDER_SOURCE for i in ids)
        out.append(Poi(kind=kind, at_m=round(at, 1), value=value, evidence_ids=ids, demo=demo))

    starts = _starts(world, route)
    kerb_done = covered_done = False
    prev_covered = False
    steepest = None  # (abs incline, at, value, evidence id)
    for s, at in zip(route.segments, starts, strict=True):
        edge = world.edges[s.edge_id]
        k = _known(edge, "kerb", prof, today, evidence)
        if not kerb_done and k is not None and k[0] in _LOWERED:
            poi("kerb", at, k[0], [k[1]])
            kerb_done = True
        c = _known(edge, "covered", prof, today, evidence)
        is_covered = c is not None and c[0] in _YES
        if not covered_done and is_covered and not prev_covered:
            poi("covered_start", at, True, [c[1]])
            covered_done = True
        prev_covered = is_covered
        i = _known(edge, "incline_pct", prof, today, evidence)
        if i is not None and (steepest is None or abs(i[0]) > steepest[0]):
            steepest = (abs(i[0]), at, i[0], i[1])
    if steepest is not None:
        poi("incline", steepest[1], steepest[2], [steepest[3]])
    for p, at in rests:
        poi("seating", at, p.name, [e.id for e in routing.rest_claim_evidence(world, p.id)])
    for u in unchecked:
        own = f"ev-{u.edge_id}.{u.attribute}"
        poi(
            "unknown",
            u.start_m,
            u.attribute,
            [own if own in evidence else f"ev-{route.id}.walkways"],
        )
    dest = world.places.get(route.to_place)
    arrive = f"ev-place-{route.to_place}"
    poi(
        "arrival",
        route.distance_m,
        dest.name if dest else None,
        [arrive if arrive in evidence else f"ev-{route.id}.walkways"],
    )
    return sorted(out, key=lambda p: (p.at_m, _POI_ORDER.index(p.kind)))
