"""T-028: a manager edits the proposed course in the same chat session ("make it 10 km",
"avoid Persiaran Tamarind", ...): the last request is carried in canonical form and re-planned
with only that edit."""

import pytest
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
STAFF = AgentSettings(
    _env_file=None, llm_provider="mock", assistant_scope="access_flood", turn_timeout_s=600
)
FIRST = (
    "I want to host a 5 km marathon starting at Elmina Valley Central Park on Sunday 6-10 am. "
    "Which roads should we use and what is affected?"
)


async def _turn(ctx, memory, q, panel="management"):
    rec = TurnRecord()
    req = ChatRequest(message=q, panel=panel, session_id="s-marathon")
    evs = [e async for e in run_turn(ctx, req, STAFF, record=rec, memory=memory)]
    call = next((e for e in evs if e.type == "tool.call" and e.name == "simulate_marathon"), None)
    return evs, rec, call


@needs_seed
@pytest.mark.parametrize(
    "edit, check",
    [
        ("Make it 10 km.", lambda a: a["distance_km"] == 10),
        ("Make it 21.1 km.", lambda a: a["distance_km"] == 21.1),
        ("Avoid Persiaran Tamarind.", lambda a: a["avoid_roads"] == ["Persiaran Tamarind"]),
        ("Prefer Persiaran Garcinia.", lambda a: a["prefer_roads"] == ["Persiaran Garcinia"]),
        (
            "Make it point_to_point and finish at Elmina Lakeside Mall.",
            lambda a: a["shape"] == "point_to_point" and a["finish"] == "Elmina Lakeside Mall",
        ),
    ],
)
async def test_an_edit_replans_the_last_course_in_the_same_session(tmp_path, edit, check):
    world = load_world(SEED)
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    memory = SessionMemory()
    evs, rec, first = await _turn(ctx, memory, FIRST)
    assert first is not None and evs[-1].answer_status == "answered"
    evs, rec, call = await _turn(ctx, memory, edit)
    assert call is not None, "the edit must re-plan, not search places"
    assert "find_place" not in rec.tool_calls
    # everything but the edit stays as asked: the start (resolved id) and the window
    assert call.args["start"] == first_start(first) and call.args["start_time"] == "6am"
    assert check(call.args)
    assert rec.validator_errors == [] and evs[-1].answer_status in ("answered", "cannot_answer")
    if evs[-1].answer_status == "cannot_answer":  # a course the planner cannot make: relayed
        assert "".join(e.delta for e in evs if e.type == "text.delta").strip()


def first_start(call) -> str:
    # the first call names the place; the carried request holds its resolved id
    return "osm-way-866543394" if call.args["start"] == "Elmina Valley Central Park" else ""


@needs_seed
async def test_residents_never_get_a_carried_marathon(tmp_path):
    world = load_world(SEED)
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    memory = SessionMemory()
    await _turn(ctx, memory, FIRST)
    evs, rec, call = await _turn(ctx, memory, "Make it 10 km.", panel="resident")
    assert call is None and "simulate_marathon" not in rec.tool_calls


@needs_seed
async def test_a_course_far_from_its_target_length_says_so(tmp_path):
    world = load_world(SEED)
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    memory = SessionMemory()
    await _turn(ctx, memory, FIRST)
    evs, rec, call = await _turn(ctx, memory, "Make it 21.1 km.")
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    course = rec.marathons[-1]["course"]
    if abs(course["length_m"] - 21100) > 2110:  # outside +-10%: the planner's reason is shown
        assert "Requested 21100 m; proposed" in text
    assert rec.validator_errors == []
