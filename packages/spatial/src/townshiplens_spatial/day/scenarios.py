"""Built-in day rehearsals (Cycle 10). Each one is a hypothetical day for synthetic residents,
never a forecast: river levels are the township's precomputed indicative scenarios."""

from __future__ import annotations

from ..world import World
from .engine import Scenario


def _hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _venue(world: World) -> str | None:
    """The evening event's venue: Elmina Valley Central Park on the seed, else any park."""
    named = [
        p for p in world.places.values() if p.name == "Elmina Valley Central Park" and p.node_id
    ]
    if named:
        return named[0].id
    parks = sorted(
        (p for p in world.places.values() if p.type in ("park", "playground") and p.node_id),
        key=lambda p: p.id,
    )
    return parks[0].id if parks else None


def _stage(world: World, metres: float) -> str | None:
    for s in world.flood.scenarios:
        if s.kind == "river_stage" and abs(s.stage_m - metres) < 1e-6 and s.id != "baseline":
            return s.id
    return None


def scenarios(world: World) -> dict[str, Scenario]:
    venue = _venue(world)
    p1, p2, p3 = _stage(world, 1), _stage(world, 2), _stage(world, 3)
    out = {
        "weekday": Scenario(
            id="weekday",
            label="A normal weekday",
            summary="School run, commutes, errands, prayers and an evening at the park, with the "
            "river at its normal level.",
            hero="Where everyday life works, and where it quietly fails for some residents.",
        ),
        "storm": Scenario(
            id="storm",
            label="Storm at the school run",
            summary="Heavy rain from 06:15; the river rises to +1 m at 06:45, +2 m at 07:05 and "
            "+3 m at 07:25 (indicative scenarios), then falls back by 12:30.",
            stages=[
                (0, None),
                (_hm("06:45"), p1),
                (_hm("07:05"), p2),
                (_hm("07:25"), p3),
                (_hm("10:00"), p2),
                (_hm("11:00"), p1),
                (_hm("12:30"), None),
            ],
            rain=[(_hm("06:15"), _hm("09:30"))],
            hero="Who can't get the children to school, who is caught on the way, and who waits.",
        ),
        "friday": Scenario(
            id="friday",
            label="Friday prayers",
            day="friday",
            summary="A Friday: men walk or drive to Jumaat prayers at the nearest masjid or surau "
            "around 12:50.",
            hero="Which masjid and surau fill up, and who struggles to reach one.",
        ),
    }
    if venue:
        out["event"] = Scenario(
            id="event",
            label="Night event at the park",
            summary="A community evening at "
            + (world.places[venue].name if venue in world.places else "the park")
            + " from 19:30 to 22:00.",
            event={
                "place_id": venue,
                "start": _hm("19:30"),
                "end": _hm("22:00"),
                "share": 0.15,
                "label": "community night",
            },
            hero="Who can reach the event, how crowded it gets, and who meets their neighbours.",
        )
    if not (p1 and p2 and p3):
        out.pop("storm")
    return out
