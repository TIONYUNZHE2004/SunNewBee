"""T-026: management answers about any closure (simulate_closure) and their checks. The backend
tool is replaced by tests/closure_stub.py until it lands (same contract)."""

from datetime import date

import pytest
from closure_stub import DISCLAIMER, WEIGHTS_NOTE
from closure_stub import simulate_closure as stub
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.event_course import event_window
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.labels import closure_line
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.validate import closure_claim_errors, event_coverage_errors
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
STAFF = AgentSettings(
    _env_file=None, llm_provider="mock", assistant_scope="access_flood", turn_timeout_s=600
)


@pytest.fixture
def backend(monkeypatch):
    monkeypatch.setitem(tools.TOOLS, "simulate_closure", stub)


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


@pytest.mark.parametrize(
    "day, want",
    [
        ("next Tuesday", "2026-10-27"),
        ("Selasa depan", "2026-10-27"),
        ("下周二", "2026-10-27"),
        ("Sunday", "2026-10-25"),
        ("周日", "2026-10-25"),
        ("tomorrow", "2026-10-22"),
        ("wednesday", "2026-10-21"),  # today counts
    ],
)
def test_weekday_words_resolve_to_the_next_such_day(day, want):
    starts, ends = event_window("9", "5 pm", day, None, today=date(2026, 10, 21))
    assert starts == f"{want}T09:00:00+08:00" and ends == f"{want}T17:00:00+08:00"


async def _ask(world, tmp_path, q, panel="management"):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=q, panel=panel)
    evs = [e async for e in run_turn(ctx, req, STAFF, record=rec, memory=SessionMemory())]
    return evs, rec, "".join(e.delta for e in evs if e.type == "text.delta")


@needs_seed
@pytest.mark.parametrize(
    "q, reason, day",
    [
        (
            "What if we close Persiaran Garcinia for a marathon 7-11 am on Sunday?",
            "event",
            "sunday",
        ),
        (
            "Road works on Persiaran Garcinia next Tuesday 9 am-5 pm: what is affected?",
            "works",
            "tuesday",
        ),
        (
            "Kerja jalan di Persiaran Garcinia Selasa depan 9 pagi-5 petang: apa yang terjejas?",
            "works",
            "selasa",
        ),
        ("下周二上午9点到下午5点Persiaran Garcinia道路施工，有什么影响？", "works", "下周二"),
    ],
)
async def test_closure_questions_are_simulated_with_pressure_for_managers(
    backend, seed, tmp_path, q, reason, day
):
    evs, rec, text = await _ask(seed, tmp_path, q)
    call = next(e for e in evs if e.type == "tool.call" and e.name == "simulate_closure")
    assert call.args["reason"] == reason and call.args["closures"][0]["day"] == day
    assert call.args["closures"][0]["road_names"] == ["Persiaran Garcinia"]
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "answered"
    assert "Persiaran Tamarind (detour pressure: high)" in text
    assert "Suggestion:" in text and "had no mapped route before the" in text
    assert DISCLAIMER in text and WEIGHTS_NOTE in text


@needs_seed
async def test_without_the_backend_tool_events_still_use_simulate_event(seed, tmp_path):
    evs, rec, _ = await _ask(
        seed, tmp_path, "What if we close Persiaran Garcinia for a marathon 7-11 am?"
    )
    assert "simulate_event" in rec.tool_calls and "simulate_closure" not in rec.tool_calls


@needs_seed
async def test_residents_cannot_run_closure_simulations(backend, seed, tmp_path):
    q = "Road works on Persiaran Garcinia next Tuesday 9 am-5 pm: what is affected?"
    evs, rec, text = await _ask(seed, tmp_path, q, panel="resident")
    assert "simulate_closure" not in rec.tool_calls and "pressure" not in text.lower()


CLOSURE = {
    "event": {"name": "Road works"},
    "reason": "works",
    "trips_total": 63,
    "trips_affected": 7,
    "detour_roads": [
        {"name": "Persiaran Tamarind", "trips": 4, "pressure": "high"},
        {"name": "Jalan Kecil", "trips": 1, "pressure": "low"},
    ],
    "suggestions": [{"kind": "signpost", "text": "Signpost the detour.", "basis": "x=4"}],
    "weights_note": WEIGHTS_NOTE,
}


def _check(summary: str, panel: str = "management") -> list[str]:
    rec = TurnRecord(events=[CLOSURE], panel=panel)
    ans = FinalAnswer(
        answer_status="answered",
        summary=summary,
        claims=[Claim(text="Road works", status="indicative", evidence_ids=["ev-closure-x"])],
    )
    return closure_claim_errors(ans, rec) + event_coverage_errors(ans, rec)


def test_pressure_bands_and_suggestions_as_returned_pass():
    ok = (
        "4 sample trips reroute onto Persiaran Tamarind (detour pressure: high); Jalan Kecil "
        "has low detour pressure. Suggestion: signpost the detour."
    )
    assert _check(ok) == []


@pytest.mark.parametrize(
    "summary, why",
    [
        (
            "Persiaran Tamarind has medium detour pressure. Signpost the detour.",
            "not what the tool",
        ),
        ("Persiaran Tamarind (detour pressure: high). Expect 200 cars on it.", "vehicles"),
        ("Persiaran Tamarind (high pressure). Signpost it and add marshals.", "not returned"),
        ("Persiaran Tamarind takes 4 trips. Signpost the detour.", "pressure band"),
    ],
)
def test_pressure_or_suggestions_the_tool_did_not_return_are_rejected(summary, why):
    assert any(why in e for e in _check(summary))


def test_residents_never_see_detour_pressure():
    rec = TurnRecord(panel="resident", route_closures=[{"id": "c1"}])
    ans = FinalAnswer(answer_status="partial", summary="The detour has high detour pressure.")
    assert any("managers only" in e for e in closure_claim_errors(ans, rec))


def test_a_named_closure_of_any_reason_reads_with_its_reason():
    row = {
        "element_name": "Jalan Kecil",
        "reason": "works",
        "event_name": "Pipe repair",
        "ends_at": "2026-10-27T17:00:00+08:00",
    }
    assert closure_line(row).endswith("— works (Pipe repair)")
    assert closure_line({**row, "reason": "accident", "event_name": None}).endswith("— accident")


def test_chinese_band_words_count_only_next_to_pressure():
    ok = (
        "Persiaran Tamarind 绕行压力为高，有4个样本出行改道，离中心较远。"
        "Suggestion: signpost the detour."
    )
    assert _check(ok) == []
    bad = "Persiaran Tamarind 的绕行压力为中。Suggestion: signpost the detour."
    assert any("not what the tool" in e for e in _check(bad))


@needs_seed
async def test_a_too_long_course_refusal_can_be_relayed(backend, seed, tmp_path):
    q = "We need to close Persiaran Elmina for road works tomorrow 9 am to 5 pm. What is affected?"
    evs, rec, text = await _ask(seed, tmp_path, q)
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "cannot_answer"
    assert "51 mapped segments" in text and "between" in text
    assert rec.validator_errors == []


def test_a_chinese_answer_gives_its_suggestions_in_chinese():
    zh = (
        "Persiaran Garcinia 道路施工期间，63 个样本出行中有 7 个改道。"
        "Persiaran Tamarind 有 4 个样本出行改道（绕行压力为高）。"
        "可考虑在 Persiaran Tamarind 设置指示牌。"
    )
    assert _check(zh) == []
