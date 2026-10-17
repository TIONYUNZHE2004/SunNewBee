"""Rehearse my trip (Cycle 19): one resident's own trip through an Elmina Day rehearsal."""

from pathlib import Path

import pytest
from townshiplens_spatial import tools
from townshiplens_spatial.day import myday
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

TINY = Path(__file__).parent / "fixtures" / "tiny"
SEED = Path(__file__).resolve().parents[3] / "data" / "seed" / "elmina"


@pytest.fixture(scope="module")
def ctx():
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))


def trip(ctx, **kw):
    args = {"from_id": "park-b", "to_id": "playground", "leave_at": "07:30", "day": "weekday"}
    return tools.TOOLS["rehearse_my_trip"](ctx, **{**args, **kw})


def test_a_normal_day_trip_gets_through_at_every_departure(ctx):
    r = trip(ctx)
    assert r.ok, r.warnings
    d = r.data
    assert d["status"] == "rehearsed" and d["asked"]["outcome"] == "clear"
    assert d["cut_by"] == [] and d["asked"]["arrive"] and d["asked"]["minutes"] >= 0
    assert {s["outcome"] for s in d["sweep"]} == {"clear"}
    assert [s["leave"] for s in d["sweep"]][:2] == ["06:30", "06:40"]  # every 10 minutes
    assert d["track"] and all(len(c) == 2 for seg in d["track"] for c in seg["coords"])
    assert d["from"]["name"] == "Car Park B" and r.evidence[0].id == "ev-mytrip-weekday"
    assert "not a forecast" in r.warnings[0]


@pytest.mark.parametrize(
    "kw,why",
    [
        ({"leave_at": "7.30"}, "leave_at"),
        ({"leave_at": "03:00"}, "leave_at"),
        ({"profile": "rocket"}, "unknown profile"),
        ({"to_id": "nowhere"}, "unknown place"),
        ({"to_id": "park-b"}, "same place"),
        ({"day": "christmas"}, "unknown day scenario"),
        ({"from_id": None, "from_point": "1,2"}, "outside the mapped area"),
        ({"from_id": None, "from_point": "abc"}, "lon,lat"),
    ],
)
def test_bad_requests_are_refused(ctx, kw, why):
    r = trip(ctx, **kw)
    assert not r.ok and any(why in w for w in r.warnings), r.warnings


def test_a_place_without_a_mapped_entrance_is_a_data_gap(ctx):
    d = trip(ctx, to_id="moon-base").data
    assert d["status"] == "no_data" and "entrance" in d["reason"]


def test_a_tapped_point_is_snapped_and_never_echoed(ctx):
    lon, lat = ctx.world.node_coords["n-a"]
    point = f"{lon + 0.0002},{lat}"  # about 22 m east of Car Park B's node
    d = trip(ctx, from_id=None, from_point=point).data
    assert d["status"] == "rehearsed" and 0 < d["from"]["snapped_m"] < 60
    assert d["from"]["name"] == "the point you chose on the map"
    assert point not in str({k: v for k, v in d.items() if k != "track"})


def test_a_point_far_from_any_path_is_a_data_gap(ctx, monkeypatch):
    monkeypatch.setattr(myday, "SNAP_M", 5.0)  # the tiny map is smaller than the real 300 m
    lon, lat = ctx.world.node_coords["n-a"]
    d = trip(ctx, from_id=None, from_point=f"{lon + 0.0004},{lat + 0.0004}", leave_at="08:10").data
    assert d["status"] == "no_data" and "no mapped path within 5 m" in d["reason"]


def test_minutes_parses_clock_times_of_the_day():
    assert myday.minutes("07:05") == 425 and myday.minutes(" 22:30 ") == 1350
    assert myday.minutes("23:00") is None and myday.minutes("7pm") is None


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
def test_the_storm_rehearsal_cuts_a_school_run_and_names_the_street():
    w = load_world(SEED)
    c = tools.Ctx(world=w, vrs=VerificationStore(":memory:"))
    school = next(p.id for p in w.places.values() if p.name == "SK Denai Alam")
    d = tools.TOOLS["rehearse_my_trip"](
        c, from_id="park-b", to_id=school, profile="drive", leave_at="07:30", day="storm"
    ).data
    assert d["asked"]["outcome"] in ("no_way", "very_long", "turned_back", "stranded")
    assert d["cut_by"], "the flooded street is named"
    assert d["last_ok_leave_before"] < "07:30" < d["next_clear_leave"]
    assert d["stage_at_leave"] == "stage_p3m"
