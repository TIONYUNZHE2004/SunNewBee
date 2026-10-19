"""The walk's unchecked places get a verification request (D-T10, ledger ruling: a journey card
says "verification request filed" only when one was filed for that element and attribute).

plan_route files at most MAX_ROUTE_VRS requests in route order, so on the §2 demo route the
Persiaran Tamarind run and the ramp were cut off. The agent files one request for each `unknown`
event of the played plan that has none yet, sanitised like every chat VR (safe_vr_args; the summary
is built from place names, never the resident's words: PDPA).
"""

import asyncio
import json

import pytest
from townshiplens_agent import demo
from townshiplens_agent.agent import Deps, call_tool
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.journeys import MAX_JOURNEY_VRS, journey_vr_targets
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.models import JourneyEvent, JourneyPlan
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
DEMO_Q = "My mum uses a walker. Can she walk from Harmoni 1 to Lakeside Mall Car Park B?"
PROFILE = "older_adult_rest"
HARMONI_1, CAR_PARK_B = "osm-way-909868201", "park-b"
MOCK = AgentSettings(_env_file=None, llm_provider="mock")
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


async def _turn(world, tmp_path, settings=MOCK, message=DEMO_Q):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=message, profile=PROFILE)
    evs = [e async for e in run_turn(ctx, req, settings, record=rec)]
    return evs, rec, ctx


def _play(evs):
    return next(
        e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "journey.play"
    )


def _filed(evs) -> set[tuple[str, str]]:
    return {(e.element_id, e.attribute) for e in evs if e.type == "verification.requested"}


def _has_vr(ev, filed) -> bool:
    return any((ev.element_id, a) in filed for a in ev.attributes)


def _event(kind, element_id, attributes, at_m=0.0):
    return JourneyEvent(
        kind=kind,
        at_m=at_m,
        element_id=element_id,
        attributes=attributes,
        status="unknown",
        demo=False,
        evidence_id="ev-x",
        title="t",
        body="b",
        hold_s=8,
    )


def test_targets_skip_events_that_already_have_a_request():
    plan = JourneyPlan.model_construct(
        events=[
            _event("covered", "seg-c", ["covered"]),
            _event("unknown", "seg-a", ["sidewalk", "step_count"]),
            _event("unknown", "seg-b", ["incline_pct"]),
            _event("unknown", "seg-b", ["incline_pct"]),  # the same element twice: one request
            _event("unknown", None, ["incline_pct"]),  # no element: nothing to ask about
        ]
    )
    route = {"unknowns": [{"element_id": "seg-b", "attribute": "incline_pct", "reason": "unknown"}]}
    assert journey_vr_targets(plan, route, {("seg-a", "step_count")}) == [
        ("seg-b", "incline_pct", "unknown")
    ]


def test_targets_only_ask_about_real_route_unknowns():
    # A ramp UNKNOWN only for flood under a scenario: journey.py shows it with the
    # "incline_pct" fallback, but incline is not a route unknown, so nothing is filed.
    plan = JourneyPlan.model_construct(events=[_event("unknown", "seg-r", ["incline_pct"])])
    route = {"unknowns": [{"element_id": "seg-r", "attribute": "flood", "reason": "unknown"}]}
    assert journey_vr_targets(plan, route, set()) == []
    # The first attribute that is a route unknown is chosen, with its own reason.
    plan = JourneyPlan.model_construct(
        events=[_event("unknown", "seg-s", ["sidewalk", "step_count", "incline_pct"])]
    )
    route = {
        "unknowns": [
            {"element_id": "seg-s", "attribute": "flood", "reason": "unknown"},
            {"element_id": "seg-s", "attribute": "step_count", "reason": "stale"},
        ]
    }
    assert journey_vr_targets(plan, route, set()) == [("seg-s", "step_count", "stale")]


def test_targets_are_capped():
    events = [_event("unknown", f"seg-{i}", ["incline_pct"]) for i in range(10)]
    route = {
        "unknowns": [
            {"element_id": f"seg-{i}", "attribute": "incline_pct", "reason": "unknown"}
            for i in range(10)
        ]
    }
    out = journey_vr_targets(JourneyPlan.model_construct(events=events), route, set())
    assert len(out) == MAX_JOURNEY_VRS == 4


@needs_seed
async def test_demo_turn_files_a_request_for_every_unchecked_place(seed, tmp_path):
    evs, rec, _ = await _turn(seed, tmp_path)
    play = _play(evs)
    unknown = [e for e in play.journey.events if e.kind == "unknown"]
    assert [e.title for e in unknown] == ["Crossing Persiaran Elmina", "Persiaran Tamarind", "Ramp"]
    filed = _filed(evs)
    assert all(_has_vr(e, filed) for e in unknown), "every unchecked place has a request"
    # Only unknown events: covered / verified / rest / arrive cards never claim a request for
    # facts plan_route did not ask about.
    assert rec.validator_errors == []
    assert evs[-1].type == "done" and evs[-1].answer_status == "partial"


@needs_seed
async def test_journey_requests_reduce_the_truncated_count(seed, tmp_path):
    """Final review (4): each pair the walk files was one plan_route left unfiled and counted in
    verification_requests_truncated, so "N more checks pending" must not count it again."""
    ctx = tools.Ctx(world=seed, vrs=VerificationStore(str(tmp_path / "plain.db")))
    plain = tools.plan_route(ctx, HARMONI_1, CAR_PARK_B, PROFILE).data
    ctx = tools.Ctx(world=seed, vrs=VerificationStore(str(tmp_path / "vr.db")))
    deps = Deps(ctx=ctx, rec=TurnRecord(queue=asyncio.Queue()), request=ChatRequest(message="x"))
    out = (
        await call_tool(deps, "plan_route", from_id=HARMONI_1, to_id=CAR_PARK_B, profile=PROFILE)
    )["data"]
    walk_filed = len(out["verification_requests"]) - len(plain["verification_requests"])
    assert walk_filed > 0 and plain["verification_requests_truncated"] >= walk_filed
    assert out["verification_requests_truncated"] == (
        plain["verification_requests_truncated"] - walk_filed
    )


@needs_seed
async def test_journey_requests_are_sanitised_and_name_no_user_words(seed, tmp_path):
    _, _, ctx = await _turn(seed, tmp_path)
    vrs = ctx.vrs.list()
    assert vrs
    for vr in vrs:
        s = (vr.question_summary or "").lower()
        assert "mum" not in s and "walker" not in s and "can she" not in s
        assert s.startswith(f"{PROFILE} route ")
        assert vr.element_id in seed.edges or vr.element_id in seed.places


@needs_seed
async def test_asking_again_upvotes_instead_of_duplicating(seed, tmp_path):
    first, _, ctx = await _turn(seed, tmp_path)
    n = len(ctx.vrs.list())
    second, _, _ = await _turn(seed, tmp_path)
    assert len(ctx.vrs.list()) == n
    assert _filed(first) == _filed(second)
    assert all(not e.created for e in second if e.type == "verification.requested")


# ------------------------------------------------------------------ AC-D16: the recorded turn


def _demo_rows():
    path = ROOT / "data/demo" / f"{demo.key(ChatRequest(message=DEMO_Q, profile=PROFILE))}.jsonl"
    assert path.exists(), f"demo turn not recorded: {path.name}"
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def test_the_demo_turn_is_recorded_with_the_mock_on_elmina():
    meta = _demo_rows()[0]["meta"]
    assert meta["world"] == "elmina"
    assert meta["model"] == "mock-scripted"
    assert meta["profile"] == PROFILE and meta["scenario_id"] is None
    assert "mum" in meta["message"]  # the question itself (redacted of contact details only)


@needs_seed
async def test_demo_mode_replays_the_recorded_turn(seed, tmp_path):
    settings = AgentSettings(_env_file=None, llm_provider="mock", demo_mode=True)
    evs, _, ctx = await _turn(seed, tmp_path, settings)
    assert evs[-1].type == "done" and evs[-1].model == "mock-scripted" + demo.SUFFIX
    rows = _demo_rows()
    assert [e.type for e in evs] == [r["type"] for r in rows[1:]]
    play = _play(evs)
    recorded = next(
        r["intent"]
        for r in rows[1:]
        if r["type"] == "scene.intent" and r["intent"]["kind"] == "journey.play"
    )
    assert play.journey.model_dump(mode="json") == recorded["journey"]
    filed = _filed(evs)
    assert all(_has_vr(e, filed) for e in play.journey.events if e.kind == "unknown")
    # Replay files the requests in this world's store, like a live turn.
    assert {(v.element_id, v.attribute) for v in ctx.vrs.list()} == filed


def test_cli_refuses_to_record_with_a_live_model():
    import asyncio

    from townshiplens_agent import cli

    live = AgentSettings(_env_file=None, llm_provider="openrouter", openrouter_api_key="x")
    with pytest.raises(SystemExit, match="refusing to --record"):
        asyncio.run(cli.main(DEMO_Q, PROFILE, record=True, settings=live))
