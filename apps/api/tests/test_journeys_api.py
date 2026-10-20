"""POST /journeys and the journey.play contract (spec 2026-10-19 resident journey §6.2, AC-D4)."""

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.journey import JourneyEvidenceError, build_journey
from townshiplens_spatial.models import JourneyPlan
from townshiplens_spatial.routing import plan_route

SEED = Path(__file__).resolve().parents[3] / "data/seed/elmina"
KIOSK = "Can I push a stroller from Car Park B to the kiosk without stairs?"


def _body(a="park-b", b="kiosk", profile="older_adult_rest", start="15:20", **kw):
    return {"from_id": a, "to_id": b, "profile": profile, "start_time": start, **kw}


def test_post_journeys_returns_the_plan_for_the_recommended_route():
    r = TestClient(app).post("/journeys", json=_body())
    assert r.status_code == 200, r.text
    plan = JourneyPlan.model_validate(r.json())
    world = state.get_ctx().world
    route = plan_route(world, "park-b", "kiosk", "older_adult_rest").routes[0]
    assert plan == build_journey(world, route, "older_adult_rest", "15:20")
    assert [e.kind for e in plan.events] == ["verified", "gap", "unknown", "rest", "arrive"]


def test_post_journeys_files_no_verification_requests():
    c = TestClient(app)
    assert c.post("/journeys", json=_body(profile="stroller")).status_code == 200
    assert c.get("/verification-requests").json() == []


def test_post_journeys_with_a_scenario_plans_that_scenario():
    r = TestClient(app).post("/journeys", json=_body(profile="stroller", scenario_id="stage_p3m"))
    assert r.status_code == 200, r.text
    world = state.get_ctx().world
    route = plan_route(world, "park-b", "kiosk", "stroller", "stage_p3m").routes[0]
    assert r.json() == json.loads(
        build_journey(world, route, "stroller", "15:20").model_dump_json()
    )


@pytest.mark.parametrize(
    ("body", "code", "words"),
    [
        (_body(profile="jetpack"), 422, "profile"),
        (_body(scenario_id="stage_p9m"), 404, "stage_p9m"),  # as /routes (require_selection)
        (_body(start="3pm"), 422, "start_time"),
        (_body(b="does-not-exist"), 404, "does-not-exist"),
    ],
)
def test_post_journeys_rejects_bad_input(body, code, words):
    r = TestClient(app).post("/journeys", json=body)
    assert r.status_code == code, r.text
    assert words in r.text


@pytest.mark.parametrize("dest", ["island-hut", "moon-base"])
def test_no_route_is_a_data_gap_not_blocked(dest):
    r = TestClient(app).post("/journeys", json=_body(b=dest, profile="stroller"))
    assert r.status_code == 409, r.text
    detail = r.json()  # top level, as the generated NoJourney type declares (no "detail")
    assert set(detail) == {"route_status", "message", "warnings"}
    assert detail["route_status"] == "no_data"
    assert detail["message"] == "No mapped connection (data gap)"
    assert "blocked" not in json.dumps(detail).lower()
    assert "reachable" not in json.dumps(detail).lower()


def test_blocked_route_says_its_status():
    # T-016: a likely-flooded destination at +3 m is blocked by a known FAIL.
    body = _body(b="playground", profile="stroller", scenario_id="stage_p3m")
    r = TestClient(app).post("/journeys", json=body)
    assert r.status_code == 409, r.text
    assert r.json()["route_status"] == "blocked" and "detail" not in r.json()


def test_a_journey_evidence_bug_is_a_named_500(monkeypatch):
    from townshiplens_api.routes import core

    def broken(*a, **k):
        raise JourneyEvidenceError("unknown", "seg-cf", "ev-x")

    monkeypatch.setattr(core, "build_journey", broken)
    r = TestClient(app, raise_server_exceptions=False).post("/journeys", json=_body())
    assert r.status_code == 500
    assert "seg-cf" in r.json()["detail"] and "unknown" in r.json()["detail"]


# ---------------------------------------------------------------- AC-D4: same plan everywhere


def _sse(client, msg, profile, scenario_id=None):
    data = []
    body = {"message": msg, "profile": profile, "scenario_id": scenario_id}
    with client.stream("POST", "/chat", json=body) as r:
        assert r.status_code == 200
        data = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    return data


@pytest.mark.parametrize("scenario_id", [None, "stage_p3m"])
def test_sse_journey_equals_post_journeys_tiny(scenario_id):  # AC-D4
    # The real mock emits journey.play after route.highlight (D-T3), at the demo start time.
    from townshiplens_agent.journeys import JOURNEY_START

    c = TestClient(app)
    data = _sse(c, KIOSK, "stroller", scenario_id)
    call = next(d for d in data if d["type"] == "tool.call" and d["name"] == "plan_route")
    intents = [d["intent"] for d in data if d["type"] == "scene.intent"]
    play = next(i for i in intents if i["kind"] == "journey.play")
    hl = next(i for i in intents if i["kind"] == "route.highlight")
    assert play["route_id"] == hl["route_id"] and play["start_time"] == JOURNEY_START
    assert play["journey"]["route_id"] == play["route_id"]
    a = call["args"]
    assert a["scenario_id"] == scenario_id  # a UI scenario is injected into plan_route
    rest = c.post(
        "/journeys",
        json=_body(
            a["from_id"], a["to_id"], a["profile"], JOURNEY_START, scenario_id=a["scenario_id"]
        ),
    )
    assert rest.status_code == 200, rest.text
    assert play["journey"] == rest.json()
    assert [e["kind"] for e in rest.json()["events"]] == ["verified", "unknown", "arrive"]
    if scenario_id:  # the scenario's own route, not the baseline one
        base = c.post(
            "/journeys", json=_body(a["from_id"], a["to_id"], a["profile"], JOURNEY_START)
        )
        assert base.json()["route_id"] != rest.json()["route_id"]


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
def test_agent_journey_equals_post_journeys_on_the_seed_demo_route(monkeypatch, tmp_path):
    """AC-D4 on the §2 demo route: the plan run.py attaches to journey.play from this turn's
    plan_route call equals POST /journeys for the same endpoints, profile and start time."""
    from townshiplens_agent import run as run_mod
    from townshiplens_agent.agent import Deps, call_tool
    from townshiplens_agent.answer import FinalAnswer
    from townshiplens_agent.events import ChatRequest
    from townshiplens_agent.record import TurnRecord

    monkeypatch.setenv("TL_DATA_DIR", str(SEED))
    state.reset()
    ctx = state.get_ctx()
    a, b, profile = "osm-way-909868201", "park-b", "older_adult_rest"

    async def plan():
        deps = Deps(
            ctx=ctx,
            rec=TurnRecord(queue=asyncio.Queue()),
            request=ChatRequest(
                message=(
                    "As an older adult, walk from Harmoni 1 @ City of Elmina Show Units "
                    "to Lakeside Mall Car Park B."
                ),
                profile=profile,
            ),
        )
        out = await call_tool(deps, "plan_route", from_id=a, to_id=b, profile=profile)
        return deps.rec, out["data"]["routes"][0]["id"]

    rec, rid = asyncio.run(plan())
    ans = FinalAnswer.model_validate(
        {
            "answer_status": "partial",
            "summary": "ok",
            "scene_intents": [{"kind": "journey.play", "route_id": rid, "start_time": "15:20"}],
        }
    )
    (ev,) = [e for e in run_mod._answer_events(ans, rec, ctx) if e.type == "scene.intent"]
    sse_json = json.loads(ev.model_dump_json())["intent"]["journey"]
    rest = TestClient(app).post("/journeys", json=_body(a, b, profile, "15:20"))
    assert rest.status_code == 200, rest.text
    assert sse_json == rest.json()
    assert len(rest.json()["events"]) == 10 and rest.json()["route_id"] == rid
