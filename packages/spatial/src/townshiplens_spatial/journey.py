"""Journey plans: a planned route turned into ordered, evidence-backed stops (spec §6.1).

`build_journey` is deterministic and reads world-model data only. The 3D player animates the
plan; it never invents events. Ported and hardened from the prototype's `build_scene.py`
(docs/03-product/prototypes/resident-journey/).

Distances (`at_m`, `spans`) are measured along the oriented polyline in a local WGS84 tangent
plane, the same frame the Three.js scene uses (apps/web/src/features/scene/three/frame.ts), so
the hero is at an event's element when the event fires. They differ from the route's
`distance_m` (spherical haversine) by well under 1%.
"""

from __future__ import annotations

import math
from types import SimpleNamespace

from . import routing
from .evaluate import _YES, SIDEWALK_PRESENT
from .models import Evidence, JourneyEvent, JourneyPlan, LonLat, Profile, Route
from .world import World

# Simulated seconds the player holds on each event kind (spec §6.1).
HOLD_S: dict[str, float] = {
    "rest": 60,
    "unknown": 8,
    "covered": 3,
    "gap": 3,
    "verified": 3,
    "arrive": 3,
}
# Placeholder evidence is never presented as verified (AGENTS.md honesty invariants).
DEMO_NOTE = "Demo value · not surveyed."
MAX_EVENTS = 12  # AC-D3: a route of up to 2 km stays readable
MAX_RAMP_EVENTS = 2
# The rules, in the order the spec lists them; that order is also the tie-break for events at
# the same distance. Each takes the trip (world, route, prof, segs, node_at, evidence, total).
_RULES = {
    "covered": lambda t: _covered(t.world, t.segs, t.evidence),
    "major_road": lambda t: _major_road(t.world, t.route, t.segs, t.evidence),
    "gap": lambda t: _gap(t.world, t.route, t.segs, t.node_at, t.evidence),
    "street": lambda t: _street_run(t.world, t.route, t.segs, t.evidence),
    "verified": lambda t: _verified(t.segs, t.evidence),
    "ramp": lambda t: _ramps(t.route, t.segs, t.evidence),
    "rest": lambda t: _rests(t.world, t.route, t.prof, t.node_at, t.evidence),
    "arrive": lambda t: [_arrive(t.world, t.route, t.total, t.evidence)],
}
_RULE_ORDER = tuple(_RULES)
# Covered-claim wording by status (not verified, not placeholder).
_COVERED_BY_STATUS = {
    "reported": "Someone reported a roof here.",
    "stale": "A roof was recorded here, but the record is out of date.",
    "contested": "Reports disagree about a roof here.",
}
# Below this, "about N m further on" would read "about 0 m": the clause is dropped.
_MIN_AHEAD_M = 10.0
_ATTR_WORDS = {
    "incline_pct": "slope",
    "width_m": "width",
    "step_count": "steps",
    "sidewalk": "sidewalk",
    "surface": "surface",
    "kerb_height_cm": "kerb",
    "handrail": "handrail",
}

# WGS84 (same constants as the web scene frame).
_A = 6378137.0
_E2 = 0.00669437999014


class JourneyEvidenceError(RuntimeError):
    """An event would cite evidence the route did not return: a data or rule bug, never shown
    to a resident as a fact. Carries the event kind and its element (or route-level source)."""

    def __init__(self, kind: str, element_id: str | None, evidence_id: str):
        self.kind, self.element_id, self.evidence_id = kind, element_id, evidence_id
        super().__init__(
            f"journey {kind} event for {element_id or 'the route'} cites {evidence_id!r}, "
            "which is not in the route's evidence"
        )


class _Seg:
    __slots__ = ("idx", "edge", "eval", "start", "end", "u", "v")

    def __init__(self, idx, edge, ev, start, end, u, v):
        self.idx, self.edge, self.eval = idx, edge, ev
        self.start, self.end, self.u, self.v = start, end, u, v


def build_journey(
    world: World, route: Route, profile: str | Profile, start_time: str
) -> JourneyPlan:
    """The whole trip for `route`: polyline, per-segment spans and the ordered events.

    Rules (spec §6.1), each tied to a world-model element and a cited evidence id:
    first covered claim; first UNKNOWN main road; the longest stretch over the profile's rest
    limit; the longest named UNKNOWN street run; the first PASS edge resting on verified claims;
    UNKNOWN ramps (adjacent ramp edges collapsed, at most two); each rest point (profiles with a
    rest rule only, thinned evenly past MAX_EVENTS); arrival.
    """
    prof = world.profiles[profile] if isinstance(profile, str) else profile
    if prof.id != route.profile:
        raise ValueError(f"profile {prof.id!r} does not match route profile {route.profile!r}")
    polyline, segs, node_at = _orient(world, route)
    evidence = {ev.id: ev for ev in routing.evidence_for_route(world, route)}
    total = segs[-1].end if segs else 0.0

    trip = SimpleNamespace(
        world=world,
        route=route,
        prof=prof,
        segs=segs,
        node_at=node_at,
        evidence=evidence,
        total=total,
    )
    found = [(rule, e) for rule, build in _RULES.items() for e in build(trip)]
    found = _thin_rests(found)
    found.sort(key=lambda re: (re[1].at_m, _RULE_ORDER.index(re[0])))
    return JourneyPlan(
        route_id=route.id,
        profile=prof.id,
        start_time=start_time,
        pace_m_per_s=routing._pace_m_per_min(prof) / 60,
        polyline=polyline,
        spans=[(round(s.start, 1), round(s.end, 1), s.eval) for s in segs],
        events=[e for _, e in found],
    )


# ---------------------------------------------------------------- geometry


def _metric(polyline: list[LonLat]):
    """Metres per degree (east, north) of the local WGS84 tangent plane at the mean latitude."""
    lat = sum(c[1] for c in polyline) / len(polyline) if polyline else 0.0
    phi = math.radians(lat)
    s = 1 - _E2 * math.sin(phi) ** 2
    north = _A * (1 - _E2) / s**1.5 * math.pi / 180
    east = _A / math.sqrt(s) * math.cos(phi) * math.pi / 180
    return east, north


def _orient(world: World, route: Route):
    """Travel-ordered polyline, per-segment spans and the distance at each node visit.

    Chained by graph nodes from the route's start node, so edges drawn against the direction
    of travel are reversed and out-and-back spurs repeat correctly. The start node is the end
    of the first edge at the route geometry's first coordinate (falling back to the end not
    shared with the second edge).
    """
    if not route.segments:
        coords = [list(c) for c in route.geometry.get("coordinates", [])[:1]]
        return coords, [], [(route.target_node, 0.0)]
    edges = [world.edges[s.edge_id] for s in route.segments]
    u = _start_node(world, route, edges)
    polyline: list[LonLat] = []
    walked: list[tuple[str, list[LonLat], str]] = []
    for e in edges:
        if e.from_node == u:
            pts, v = e.coords, e.to_node
        elif e.to_node == u:
            pts, v = list(reversed(e.coords)), e.from_node
        else:  # not chained in the graph: orient by the nearer end (prototype fallback)
            last = polyline[-1] if polyline else e.coords[0]
            fwd = math.dist(e.coords[0], last) <= math.dist(e.coords[-1], last)
            pts, v = (e.coords, e.to_node) if fwd else (list(reversed(e.coords)), e.from_node)
        walked.append((u, pts, v))
        polyline.extend([list(p) for p in (pts if not polyline else pts[1:])])
        u = v
    kx, ky = _metric(polyline)
    segs: list[_Seg] = []
    node_at: list[tuple[str, float]] = [(walked[0][0], 0.0)]
    at = 0.0
    for i, ((a, pts, b), s) in enumerate(zip(walked, route.segments, strict=True)):
        length = sum(
            math.hypot((q[0] - p[0]) * kx, (q[1] - p[1]) * ky)
            for p, q in zip(pts, pts[1:], strict=False)
        )
        segs.append(_Seg(i, world.edges[s.edge_id], s.eval, at, at + length, a, b))
        at += length
        node_at.append((b, at))
    return polyline, segs, node_at


def _start_node(world: World, route: Route, edges) -> str:
    e0 = edges[0]
    geom = route.geometry.get("coordinates") or []
    if geom and e0.from_node != e0.to_node:
        if list(e0.coords[0]) == list(geom[0]) and list(e0.coords[-1]) != list(geom[0]):
            return e0.from_node
        if list(e0.coords[-1]) == list(geom[0]):
            return e0.to_node
    if len(edges) > 1:
        shared = {edges[1].from_node, edges[1].to_node}
        if e0.to_node in shared and e0.from_node not in shared:
            return e0.from_node
        if e0.from_node in shared:
            return e0.to_node
    return e0.from_node


# ---------------------------------------------------------------- rules


def _event(kind, at, evidence: dict[str, Evidence], evidence_id: str, **kw) -> JourneyEvent:
    ev = evidence.get(evidence_id)
    if ev is None:  # an event without route evidence is a bug: name it, never guess
        raise JourneyEvidenceError(kind, kw.get("element_id") or kw.get("source"), evidence_id)
    return JourneyEvent(
        kind=kind,
        at_m=round(at, 1),
        evidence_id=evidence_id,
        demo=ev.source_type == routing.PLACEHOLDER_SOURCE,
        hold_s=HOLD_S[kind],
        **kw,
    )


def _unknown_attrs(route: Route, edge_id: str) -> list[str]:
    attrs = [u["attribute"] for u in route.unknowns if u["element_id"] == edge_id]
    return list(dict.fromkeys(a for a in attrs if a not in ("flood", "flood_coverage")))


def _unknown_evidence(route, seg: _Seg, attrs, evidence) -> str:
    """The edge's own claim for an unknown attribute, else the route's mapped-walkway record."""
    for a in attrs:
        if f"ev-{seg.edge.id}.{a}" in evidence:
            return f"ev-{seg.edge.id}.{a}"
    return f"ev-{route.id}.walkways"


def _has_mapped_sidewalk(edge) -> bool:
    c = edge.claims.get("sidewalk")
    return bool(c and c.value in SIDEWALK_PRESENT and c.status in ("reported", "verified"))


def _covered(world, segs, evidence):
    for s in segs:
        c = s.edge.claims.get("covered")
        if c is None or c.status == "unknown":
            continue
        value = c.value.lower() if isinstance(c.value, str) else c.value
        if value not in _YES:
            continue
        if c.evidence_type == routing.PLACEHOLDER_SOURCE:
            body = f"A roof over this stretch. {DEMO_NOTE}"
        elif c.status == "verified":
            body = "A roof over this stretch, verified."
        else:
            said = _COVERED_BY_STATUS.get(c.status, _COVERED_BY_STATUS["reported"])
            body = f"{said} Not checked yet."
        return [
            _event(
                "covered",
                s.start,
                evidence,
                f"ev-{s.edge.id}.covered",
                element_id=s.edge.id,
                attributes=["covered"],
                status=c.status,
                title="Covered walkway",
                body=body,
            )
        ]
    return []


def _major_road(world, route, segs, evidence):
    for i, s in enumerate(segs):
        if s.edge.type != "major_road" or s.eval != "UNKNOWN":
            continue
        attrs = _unknown_attrs(route, s.edge.id) or ["sidewalk"]
        near = [segs[j].edge.type for j in (i - 1, i + 1) if 0 <= j < len(segs)]
        missing = []
        if "crossing" not in near:
            missing.append("crossing")
        if not _has_mapped_sidewalk(s.edge):
            missing.append("sidewalk")
        first = (
            f"No mapped {' or '.join(missing)} here."
            if missing
            else f"Mapped {_words(attrs)} not checked."
        )
        return [
            _event(
                "unknown",
                s.start,
                evidence,
                _unknown_evidence(route, s, attrs, evidence),
                element_id=s.edge.id,
                attributes=attrs,
                status=_claim_status(s.edge, attrs),
                title=f"Crossing {s.edge.name or 'a main road'}",
                body=f"{first} Not checked yet.",
            )
        ]
    return []


def _gap(world, route, segs, node_at, evidence):
    """The longest stretch without a rest point, when it runs past the profile's limit.

    Stretches are measured with edge lengths (as Route.max_gap_between_rest_m is); the event
    fires `limit` metres into the stretch, where the profile's rest rule is first broken.
    """
    limit, gap = route.rest_limit_m, route.max_gap_between_rest_m
    if not limit or gap is None or gap <= limit or not segs:
        return []
    rest_nodes = {r["node_id"] for r in route.rest_points}
    best = (-1.0, 0, len(segs))  # (length, first seg index, end seg index exclusive)
    run, start = 0.0, 0
    for i, s in enumerate(segs):
        run += s.edge.length_m
        if s.v in rest_nodes or i == len(segs) - 1:
            if run > best[0] + 1e-9:
                best = (run, start, i + 1)
            run, start = 0.0, i + 1
    _, i0, i1 = best
    begin, end = segs[i0].start, segs[i1 - 1].end
    at = min(begin + limit, end)
    ahead = max(0.0, end - at)
    to_rest = segs[i1 - 1].v in rest_nodes
    if ahead < _MIN_AHEAD_M:
        first = (
            "The next mapped rest stop is just ahead."
            if to_rest
            else "No mapped rest stop before the destination."
        )
    elif to_rest:
        first = f"The next mapped rest stop is about {_round10(ahead)} m further on."
    else:
        first = f"No mapped rest stop before the destination, about {_round10(ahead)} m on."
    return [
        _event(
            "gap",
            at,
            evidence,
            f"ev-{route.id}.rest_gap",
            source="route.max_gap_between_rest_m",
            attributes=["max_gap_between_rest_m"],
            status="route",
            title="No mapped rest stop ahead",
            body=f"{first} The rest rule for this profile is every {limit:.0f} m.",
        )
    ]


def _street_run(world, route, segs, evidence):
    """The longest run of consecutive UNKNOWN edges of one named street, reported once."""
    runs: list[list[_Seg]] = []
    for s in segs:
        if s.eval == "UNKNOWN" and s.edge.type == "street" and s.edge.name:
            if runs and runs[-1][-1].idx == s.idx - 1 and runs[-1][-1].edge.name == s.edge.name:
                runs[-1].append(s)
                continue
            runs.append([s])
    if not runs:
        return []
    run = max(runs, key=lambda r: (r[-1].end - r[0].start, -r[0].idx))
    s0 = run[0]
    length = run[-1].end - s0.start
    attrs = _unknown_attrs(route, s0.edge.id) or ["sidewalk"]
    no_sidewalk = not any(_has_mapped_sidewalk(s.edge) for s in run)
    what = "with no mapped sidewalk" if no_sidewalk else f"with its {_words(attrs)} unchecked"
    return [
        _event(
            "unknown",
            s0.start,
            evidence,
            _unknown_evidence(route, s0, attrs, evidence),
            element_id=s0.edge.id,
            attributes=attrs,
            status=_claim_status(s0.edge, attrs),
            title=s0.edge.name,
            body=f"About {_round10(length)} m along the road {what}. Not checked yet.",
        )
    ]


def _verified(segs, evidence):
    """The first PASS edge that rests on verified claims (OSM passability is never 'verified')."""
    for s in segs:
        if s.eval != "PASS":
            continue
        claims = {k: c for k, c in s.edge.claims.items() if c.status == "verified"}
        cited = [k for k in claims if f"ev-{s.edge.id}.{k}" in evidence]
        if not cited:
            continue
        step_free = "step_count" in claims and claims["step_count"].value == 0
        parts = []
        if step_free:
            parts.append("No steps")
        if (c := claims.get("incline_pct")) is not None and c.value is not None:
            parts.append(f"slope {c.value:g}%")
        if (c := claims.get("width_m")) is not None and c.value is not None:
            parts.append(f"{c.value:g} m wide")
        detail = ", ".join(parts) if parts else _words(cited).capitalize()
        demo_keys = [k for k in cited if claims[k].evidence_type == routing.PLACEHOLDER_SOURCE]
        demo = bool(demo_keys)
        # Cite a demo claim when any is demo, so the card's demo chip matches the body.
        pool = demo_keys or cited
        lead = "step_count" if "step_count" in pool else pool[0]
        return [
            _event(
                "verified",
                s.start,
                evidence,
                f"ev-{s.edge.id}.{lead}",
                element_id=s.edge.id,
                attributes=cited,
                status="verified",
                title="Step-free path" if step_free else "Recorded path details",
                body=f"{detail[:1].upper()}{detail[1:]}. {DEMO_NOTE if demo else 'Verified.'}",
            )
        ]
    return []


def _ramps(route, segs, evidence):
    """UNKNOWN ramps; adjacent ramp edges are one ramp. At most MAX_RAMP_EVENTS."""
    out, prev = [], None
    for s in segs:
        if s.edge.type != "ramp" or s.eval != "UNKNOWN":
            prev = None
            continue
        if prev is not None and prev.idx == s.idx - 1:
            prev = s
            continue
        prev = s
        attrs = _unknown_attrs(route, s.edge.id) or ["incline_pct"]
        out.append(
            _event(
                "unknown",
                s.start,
                evidence,
                _unknown_evidence(route, s, attrs, evidence),
                element_id=s.edge.id,
                attributes=attrs,
                status=_claim_status(s.edge, attrs),
                title="Ramp",
                body=f"This ramp's {_words(attrs)} is not on record. Not checked yet.",
            )
        )
    return out[:MAX_RAMP_EVENTS]


def _rests(world, route, prof, node_at, evidence):
    """Each rest point on the way (not at the start), for profiles with a rest rule."""
    if prof.max_rest_free_run_m is None:
        return []
    first_at: dict[str, float] = {}
    for node, at in node_at[1:]:
        first_at.setdefault(node, at)
    out = []
    for r in route.rest_points:
        if r["node_id"] not in first_at or r["place_id"] not in world.places:
            continue
        evs = routing.rest_claim_evidence(world, r["place_id"])
        verified = r["status"] == "verified"
        ev = next((e for e in evs if e.status == "verified"), evs[0]) if verified else evs[0]
        out.append(
            _event(
                "rest",
                first_at[r["node_id"]],
                evidence,
                ev.id,
                element_id=r["place_id"],
                attributes=[ev.attribute] if ev.attribute != "name" else [],
                status="verified" if verified else "unverified",
                title=r["name"],
                body=(
                    "Rest stop: a minute's pause here."
                    if verified
                    else "Rest stop: mapped, not checked yet. A minute's pause here."
                ),
            )
        )
    return out


def _arrive(world, route, total, evidence):
    dest = world.places.get(route.to_place)
    eid = f"ev-place-{route.to_place}"
    if eid not in evidence:
        eid = f"ev-{route.id}.walkways"
    name = dest.name if dest else "Destination"
    return _event(
        "arrive",
        total,
        evidence,
        eid,
        element_id=route.to_place,
        source="route.to_place",
        attributes=[],
        status="route",
        title=name,
        body=(
            f"About {_round10(route.distance_m)} m. "
            f"Est. {round(route.est_minutes)} min at this pace, plus rests."
        ),
    )


def _thin_rests(found):
    """Keep at most MAX_EVENTS events by keeping rest points spread evenly along the route."""
    if len(found) <= MAX_EVENTS:
        return found
    rests = sorted(
        (i for i, (rule, _) in enumerate(found) if rule == "rest"),
        key=lambda i: (found[i][1].at_m, i),
    )
    room = MAX_EVENTS - (len(found) - len(rests))
    keep = {rests[math.floor((k + 0.5) * len(rests) / room)] for k in range(room)}
    return [x for i, x in enumerate(found) if found[i][0] != "rest" or i in keep]


# ---------------------------------------------------------------- wording


def _words(attrs) -> str:
    names = list(dict.fromkeys(_ATTR_WORDS.get(a, a.replace("_", " ")) for a in attrs))
    return " and ".join(names) if names else "details"


def _claim_status(edge, attrs) -> str:
    for a in attrs:
        if (c := edge.claims.get(a)) is not None:
            return c.status
    return "unknown"


def _round10(m: float) -> int:
    return int(round(m, -1))
