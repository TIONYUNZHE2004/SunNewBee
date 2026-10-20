"""Rising-river population rollout and tipping points on the Township World Model (Cycle 3).

Synthetic residents per persona (the seeded origin sample of `sim.evacuation_origins`) head for
their nearest reachable evacuation centre at every precomputed river stage. Every route is the
engine's. The rollout adds the time axis: the river stage.

- `river_rollout`: per-stage counts per profile and per-resident statuses, with the *tipping
  stage* (the first stage at which a resident no longer reaches a centre) and route references,
  for the 3D animation.
- `tipping_point`: one journey across all stages.

Both use one rule for "no longer reached" (`_broken`): no route, or the start (or the named
destination) is likely flooded at that stage, even if a path to it still exists.

It is a simulation, not a forecast. Stages are discrete scenarios (labels, never depths), and
departure times, warnings, crowding and real travel times are not modelled.
"""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel, Field

from . import twm
from .routing import eval_memo
from .world import World

REACHED = twm.REACHED
DEFAULT_PROFILES = ("wheelchair", "stroller", "older_adult_rest")
DEFAULT_N = 30
MAX_PROFILES = 4
DISCLAIMER = (
    "Synthetic residents on the township model: an indicative simulation, not a forecast. "
    "River stages are scenarios, not water depths; departure times, warnings and crowding are "
    "not modelled; animation speed is illustrative. Follow official MBSA / JPS / NADMA guidance."
)
# Status shown when a path exists but the start is likely flooded at that stage.
START_FLOODED = "start_flooded"


class Stage(BaseModel):
    id: str
    label: str  # "Normal level", "River +3 m"


class Resident(BaseModel):
    id: str
    profile: str
    origin_id: str
    origin_name: str | None = None
    origin_coord: list[float] | None = None  # [lon, lat]: where a resident without a route stands
    # One per stage: confirmed | partly_unverified | blocked | no_data | start_flooded
    statuses: list[str]
    route_ids: list[str | None]  # one per stage: key into RiverRollout.routes (None: no route)
    tipping_stage: str | None = None  # first stage where the centre is no longer reached
    demo_evidence: bool = False  # some stage's confirmed route rests on demo values


class RiverRollout(BaseModel):
    stages: list[Stage]
    profiles: list[str]
    counts: dict[str, dict[str, dict[str, int]]]  # profile -> stage -> {total, reach, ...}
    residents: list[Resident]
    routes: dict[str, dict] = Field(default_factory=dict)  # geometry key -> GeoJSON LineString
    evidence_id: str
    disclaimer: str = DISCLAIMER


def stages(world: World) -> list[Stage]:
    out = []
    for s in sorted(world.flood.scenarios, key=lambda s: s.stage_m):
        label = (
            "Normal level" if s.id == "baseline" or s.stage_m == 0 else f"River +{s.stage_m:g} m"
        )
        out.append(Stage(id=s.id, label=label))
    return out


def _sid(stage_id: str) -> str | None:
    return None if stage_id == "baseline" else stage_id


def _flood(world: World, stage_id: str, place_id: str | None) -> str | None:
    if not place_id:
        return None
    return world.flood.place_classes.get(stage_id, {}).get(place_id)


def _geom_key(geometry: dict) -> str:
    return "g-" + hashlib.sha1(json.dumps(geometry["coordinates"]).encode()).hexdigest()[:12]


def normalise_profiles(profiles: list[str] | None) -> list[str]:
    """Walking profiles only, deduplicated, in a fixed order, at most MAX_PROFILES."""
    want = set(profiles or DEFAULT_PROFILES)
    return [p for p in twm.WALKING if p in want][:MAX_PROFILES]


def river_rollout(
    world: World,
    profiles: list[str] | None = None,
    n: int = DEFAULT_N,
) -> RiverRollout:
    profs = [p for p in normalise_profiles(profiles) if p in world.profiles]
    sts = stages(world)
    origins = twm.evacuation_journeys(world, "wheelchair", n)  # same seeded sample for everyone
    counts: dict[str, dict[str, dict[str, int]]] = {}
    residents: list[Resident] = []
    routes: dict[str, dict] = {}
    with eval_memo():
        for prof in profs:
            journeys = [
                twm.Journey(from_id=j.from_id, to_id=j.to_id, profile=prof) for j in origins
            ]
            per_stage = [twm.rollout(world, _sid(s.id), journeys) for s in sts]
            columns: list[list[str]] = []
            for i, j in enumerate(journeys):
                col = [states[i] for states in per_stage]
                statuses = []
                for s, st in zip(sts, col, strict=True):
                    start = _flood(world, s.id, j.from_id) == "likely_flooded"
                    statuses.append(START_FLOODED if start and st.status in REACHED else st.status)
                columns.append(statuses)
                keys = []
                for st in col:
                    if st.geometry:
                        k = _geom_key(st.geometry)
                        routes.setdefault(k, st.geometry)
                        keys.append(k)
                    else:
                        keys.append(None)
                tip = (
                    next(
                        (s.id for s, x in zip(sts, statuses, strict=True) if x not in REACHED), None
                    )
                    if statuses[0] in REACHED
                    else None
                )
                place = world.places.get(j.from_id)
                residents.append(
                    Resident(
                        id=f"{prof}:{j.from_id}",
                        profile=prof,
                        origin_id=j.from_id,
                        origin_name=place.name if place else None,
                        origin_coord=list(place.coord) if place else None,
                        statuses=statuses,
                        route_ids=keys,
                        tipping_stage=tip,
                        demo_evidence=any(
                            st.demo_evidence and x == "confirmed"
                            for st, x in zip(col, statuses, strict=True)
                        ),
                    )
                )
            counts[prof] = {}
            for k, s in enumerate(sts):
                col = [c[k] for c in columns]
                demo = [
                    per_stage[k][i].demo_evidence and x == "confirmed" for i, x in enumerate(col)
                ]
                counts[prof][s.id] = {
                    "total": len(col),
                    "reach": sum(x in REACHED for x in col),
                    "confirmed": sum(x == "confirmed" for x in col),
                    "confirmed_on_demo": sum(demo),
                    "cut_off": sum(x in ("blocked", START_FLOODED) for x in col),
                    "start_flooded": sum(x == START_FLOODED for x in col),
                    "no_data": sum(x == "no_data" for x in col),
                }
    blob = json.dumps([profs, n, world.version, [s.id for s in sts]])
    return RiverRollout(
        stages=sts,
        profiles=profs,
        counts=counts,
        residents=residents,
        routes=routes,
        evidence_id="ev-rollout-" + hashlib.sha1(blob.encode()).hexdigest()[:10],
    )


class TippingStage(BaseModel):
    stage: str
    status: str  # route status at this stage
    start_flood: str | None = None  # flood class of the start at this stage
    end_flood: str | None = None  # flood class of the named destination (to_id) at this stage
    target_name: str | None = None  # the centre reached at this stage (nearest-centre trips)
    demo_evidence: bool = False  # a confirmed route here rests on demo values


class TippingPoint(BaseModel):
    from_id: str
    to_id: str
    profile: str
    target_name: str | None = None  # the destination at normal level
    stages: list[TippingStage]
    reached_at_normal: bool  # False: the trip has no working route even at normal level
    degrades_at: str | None = None  # first stage worse than normal level (incl. centre change)
    breaks_at: str | None = None  # first stage where the destination is no longer reached
    centre_changes: bool = False  # the nearest centre differs between stages
    labels: dict[str, str] = Field(default_factory=dict)  # stage id -> label
    evidence_id: str
    disclaimer: str = DISCLAIMER


def _broken(t: TippingStage) -> bool:
    return t.status not in REACHED or "likely_flooded" in (t.start_flood, t.end_flood)


def tipping_point(
    world: World, from_id: str, profile: str, to_id: str | None = None
) -> TippingPoint:
    """One journey across every river stage. A start, or a named destination, that is likely
    flooded at a stage breaks the trip there, even when a path to it still exists."""
    sts = stages(world)
    dest = to_id or twm.NEAREST_CENTRE
    rows: list[TippingStage] = []
    with eval_memo():
        for s in sts:
            j = twm.Journey(from_id=from_id, to_id=dest, profile=profile)
            st = twm._state(world, j, _sid(s.id), False)
            rows.append(
                TippingStage(
                    stage=s.id,
                    status=st.status,
                    start_flood=_flood(world, s.id, from_id),
                    end_flood=_flood(world, s.id, to_id),
                    target_name=st.target_name,
                    demo_evidence=st.demo_evidence and st.status == "confirmed",
                )
            )
    rank = {"confirmed": 0, "likely_ok": 1, "partly_unverified": 2}
    base = rows[0]
    ok = not _broken(base)

    def worse(r: TippingStage) -> bool:
        return (
            _broken(r)
            or rank.get(r.status, 2) > rank.get(base.status, 2)
            or bool(r.start_flood or r.end_flood) > bool(base.start_flood or base.end_flood)
            or (to_id is None and r.target_name != base.target_name)
        )

    blob = json.dumps([from_id, dest, profile, world.version])
    return TippingPoint(
        from_id=from_id,
        to_id=dest,
        profile=profile,
        target_name=base.target_name or (world.places[to_id].name if to_id else None),
        stages=rows,
        reached_at_normal=ok,
        degrades_at=next((r.stage for r in rows[1:] if worse(r)), None) if ok else None,
        breaks_at=next((r.stage for r in rows if _broken(r)), None) if ok else None,
        centre_changes=to_id is None and len({r.target_name for r in rows if r.target_name}) > 1,
        labels={s.id: s.label for s in sts},
        evidence_id="ev-tip-" + hashlib.sha1(blob.encode()).hexdigest()[:10],
    )
