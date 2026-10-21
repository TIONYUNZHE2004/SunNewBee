"""Development Simulation tool, mock answer, template and validator (developer lens, ADR 0014).

The mock answers the fixed brief with the restated brief line and one illustrative sentence, then
plays `development.play`. The template says the same, the validator accepts both and rejects a
tampered number or a missing honesty phrase.
"""

import asyncio
import importlib.util
import json
import re
from pathlib import Path

import pytest
from tests_support import TINY
from townshiplens_agent.agent import Deps, call_tool
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.developments import BRIEF, ILLUSTRATIVE, devsim_answer, restatement
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import DEPTH, FORBIDDEN, validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.devsim_models import DevelopmentPlan, DevsimUnavailable
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

FIXTURE = (
    Path(__file__).resolve().parents[3] / "apps/web/src/features/devsim/fixtures/plan.elmina.json"
)
SEED = ROOT / "data/seed/elmina"
HAS_DEVSIM = importlib.util.find_spec("townshiplens_spatial.devsim") is not None
MOCK = AgentSettings(_env_file=None, llm_provider="mock")
LINE = "Brief: 30 storeys · ~500 homes · parcel near Lakeside Mall"
SENTENCE = (
    "This is an illustrative simulation of a hypothetical development, not a forecast and not "
    "an SDP project; walking times come from the mapped routes."
)


def _plan() -> DevelopmentPlan:
    return DevelopmentPlan.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


def _boom(world, brief):
    raise DevsimUnavailable("no parcel")


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


@pytest.fixture(params=["plan", "unavailable"])
def mode(request, monkeypatch):
    if request.param == "plan":
        monkeypatch.setattr(tools, "_build_development_plan", lambda w, b: _plan())
    else:
        monkeypatch.setattr(tools, "_build_development_plan", _boom)
    return request.param


async def _turn(ctx, message=BRIEF, settings=MOCK):
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx, ChatRequest(message=message, profile="default"), settings, record=rec
        )
    ]
    return evs, rec


async def _recorded(ctx) -> TurnRecord:
    deps = Deps(
        ctx=ctx,
        rec=TurnRecord(queue=asyncio.Queue()),
        request=ChatRequest(message=BRIEF, profile="default"),
    )
    await call_tool(deps, "simulate_development")
    return deps.rec


def _answer(rec: TurnRecord) -> FinalAnswer:
    ev = [i for i in rec.evidence if i.startswith("ev-devsim-")]
    return FinalAnswer(**devsim_answer(rec.developments[-1], ev))


# --- AI2: the tool ---------------------------------------------------------------------------


def test_tool_is_registered():
    assert "simulate_development" in tools.TOOLS


def test_tool_returns_the_plan_and_its_facts(ctx, monkeypatch):
    monkeypatch.setattr(tools, "_build_development_plan", lambda w, b: _plan())
    res = tools.TOOLS["simulate_development"](ctx)
    assert res.ok and res.data["available"] is True
    assert res.data["brief"] == {"storeys": 30, "homes": 500}
    plan = DevelopmentPlan.model_validate(res.data["plan"])
    assert res.data["facts"]["park_min"] == plan.facts.park.min
    assert res.data["facts"]["detour_min"] == plan.facts.detour.detour_min
    assert [e.id for e in res.evidence] == ["ev-devsim-brief"]


def test_tool_unavailable_has_no_facts(ctx, monkeypatch):
    monkeypatch.setattr(tools, "_build_development_plan", _boom)
    res = tools.TOOLS["simulate_development"](ctx)
    assert res.ok and res.data["available"] is False
    assert "facts" not in res.data and "plan" not in res.data


async def test_call_tool_records_facts_and_keeps_the_plan_from_the_model(ctx, monkeypatch):
    monkeypatch.setattr(tools, "_build_development_plan", lambda w, b: _plan())
    deps = Deps(
        ctx=ctx,
        rec=TurnRecord(queue=asyncio.Queue()),
        request=ChatRequest(message=BRIEF, profile="default"),
    )
    out = await call_tool(deps, "simulate_development")
    assert "plan" not in out["data"]  # the model never sees the plan
    assert deps.rec.development_plan == _plan()
    assert deps.rec.developments[-1]["facts"]["mall_min"] == _plan().facts.mall.min
    assert "simulate_development" in deps.rec.tool_calls


@pytest.mark.skipif(
    not HAS_DEVSIM or not (SEED / "site.json").exists(),
    reason="needs townshiplens_spatial.devsim (BE lane) and the Elmina seed",
)
def test_tool_on_elmina_gets_a_plan(tmp_path):
    c = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(str(tmp_path / "vr.db")))
    res = tools.TOOLS["simulate_development"](c)
    assert res.data["available"] is True
    assert DevelopmentPlan.model_validate(res.data["plan"]).world == "elmina"


# --- AI3: mock, template, validator ----------------------------------------------------------


@pytest.mark.parametrize("message", [BRIEF, BRIEF.upper(), f"Hi! {BRIEF.lower()}, please"])
async def test_mock_answers_the_brief_and_passes_the_validator(ctx, mode, message):
    evs, _ = await _turn(ctx, message)
    assert [e.name for e in evs if e.type == "tool.call"] == ["simulate_development"]
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert LINE in text and SENTENCE in text
    checks = [e for e in evs if e.type == "answer.check"]
    assert checks and all(c.ok for c in checks), [c.issues for c in checks]
    [it] = [e.intent for e in evs if e.type == "scene.intent"]
    assert it.kind == "development.play" and it.brief_text == BRIEF
    assert (it.plan is not None) == (mode == "plan")
    assert [e for e in evs if e.type == "done"][0].answer_status == "answered"


async def test_other_questions_do_not_use_the_tool(ctx, mode):
    evs, _ = await _turn(ctx, "Can I push a stroller from Car Park B to the playground?")
    assert "simulate_development" not in [e.name for e in evs if e.type == "tool.call"]


async def test_template_answer_passes_the_validator(ctx, mode):
    rec = await _recorded(ctx)
    ans = template_answer(rec, BRIEF)
    assert LINE in ans.summary and SENTENCE in ans.summary
    assert [i.kind for i in ans.scene_intents] == ["development.play"]
    assert validate_answer(ans, rec) == []


async def test_mock_answer_fields_pass_the_validator(ctx, mode):
    rec = await _recorded(ctx)
    assert validate_answer(_answer(rec), rec) == []


async def test_a_changed_number_fails(ctx, mode):
    rec = await _recorded(ctx)
    ans = _answer(rec)
    for old, new in [("30 storeys", "40 storeys"), ("~500 homes", "~800 homes")]:
        bad = ans.model_copy(update={"summary": ans.summary.replace(old, new)})
        assert validate_answer(bad, rec), old


async def test_an_extra_number_fails(ctx, mode):
    rec = await _recorded(ctx)
    ans = _answer(rec)
    bad = ans.model_copy(update={"summary": ans.summary + " The walk takes 41 minutes."})
    assert validate_answer(bad, rec)


async def test_a_plan_number_is_allowed_only_when_the_tool_returned_it(ctx, monkeypatch):
    monkeypatch.setattr(tools, "_build_development_plan", lambda w, b: _plan())
    rec = await _recorded(ctx)
    ans = _answer(rec)
    mins = _plan().facts.park.min
    ok = ans.model_copy(update={"summary": ans.summary + f" The park is {mins} min away."})
    assert validate_answer(ok, rec) == []


async def test_the_hoarding_headline_is_quotable_and_checked(ctx, monkeypatch):  # C7
    """The impact headline is in the tool facts, so the validator allows exactly those numbers;
    the plan's flood exposure is not, and flood wording stays out of the answer."""
    monkeypatch.setattr(tools, "_build_development_plan", lambda w, b: _plan())
    rec = await _recorded(ctx)
    im = _plan().impact
    f = rec.developments[-1]["facts"]
    assert (f["homes_2min_plus"], f["homes_considered"], f["max_extra_min"]) == (
        im.homes_2min_plus,
        im.homes_considered,
        im.max_extra_min,
    )
    assert f["wheelchair_links_cut"] == im.wheelchair_links_cut
    ans = _answer(rec)
    line = (
        f" While the hoarding is up, {im.homes_2min_plus} of {im.homes_considered} nearby homes"
        f" walk up to {im.max_extra_min} min longer."
    )
    assert validate_answer(ans.model_copy(update={"summary": ans.summary + line}), rec) == []
    wrong = line.replace(f"{im.homes_2min_plus} of", f"{im.homes_2min_plus + 7} of")
    assert validate_answer(ans.model_copy(update={"summary": ans.summary + wrong}), rec)
    flood = " The walk to the main road floods from the +1 m scenario."
    assert validate_answer(ans.model_copy(update={"summary": ans.summary + flood}), rec)


@pytest.mark.parametrize("drop", [ILLUSTRATIVE, "illustrative", "not an SDP project", LINE])
async def test_missing_honesty_phrases_fail(ctx, mode, drop):
    rec = await _recorded(ctx)
    ans = _answer(rec)
    bad = ans.model_copy(update={"summary": ans.summary.replace(drop, "")})
    assert validate_answer(bad, rec)


@pytest.mark.parametrize("word", ["safe", "selamat", "flood", "a depth of 2 m"])
async def test_banned_words_fail(ctx, mode, word):
    rec = await _recorded(ctx)
    ans = _answer(rec)
    bad = ans.model_copy(update={"summary": ans.summary + f" It is {word}."})
    assert validate_answer(bad, rec)


async def test_development_play_without_the_tool_fails():
    ans = FinalAnswer.model_validate(
        {
            "answer_status": "partial",
            "summary": "ok",
            "scene_intents": [{"kind": "development.play"}],
        }
    )
    assert any("development.play needs" in e for e in validate_answer(ans, TurnRecord()))


def test_our_own_strings_are_clean():
    for s in (LINE, SENTENCE, BRIEF, restatement(30, 500)):
        assert not FORBIDDEN.search(s) and not DEPTH.search(s)
        assert not re.search(r"flood|safe|selamat|depth", s, re.I)


# --- AI5: the recorded replay ----------------------------------------------------------------


BANNED_IN_REPLAY = re.compile(r"safe|selamat|安全|flood|depth", re.I)


def _strings(node):
    """Every key and string value a recorded event carries, at any depth."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def test_the_committed_brief_replay_carries_no_banned_words():
    """AC-H4: the recorded brief turn (what the demo shows) has no flood, depth or safety words."""
    from townshiplens_agent import demo

    key = demo.key(ChatRequest(message=BRIEF, profile="default"))
    path = ROOT / "data/demo" / f"{key}.jsonl"
    assert path.exists(), "brief replay not recorded"
    rows = [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert rows[0]["meta"]["world"] == "elmina"
    hits = [s for row in rows for s in _strings(row) if BANNED_IN_REPLAY.search(s)]
    assert hits == []
    intents = [r["intent"] for r in rows[1:] if r.get("type") == "scene.intent"]
    assert [i["kind"] for i in intents] == ["development.play"] and intents[0]["plan"]


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
async def test_demo_mode_replays_the_brief_with_a_plan(tmp_path):
    """Record the brief with the mock into a tmp demo dir, then replay it.

    Date-independent: the committed recording's fingerprint carries the day it was recorded,
    so this test makes its own recording (same code, same day) instead of relying on it.
    """
    from townshiplens_agent import cli, demo

    demo_dir = tmp_path / "demo"
    rec_settings = AgentSettings(_env_file=None, llm_provider="mock", demo_dir=demo_dir)
    await cli.main(BRIEF, "default", record=True, settings=rec_settings)
    key = demo.key(ChatRequest(message=BRIEF, profile="default"))
    assert (demo_dir / f"{key}.jsonl").exists()

    c = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(str(tmp_path / "vr.db")))
    settings = AgentSettings(_env_file=None, llm_provider="mock", demo_mode=True, demo_dir=demo_dir)
    evs, _ = await _turn(c, BRIEF, settings)
    assert evs[-1].model.endswith(demo.SUFFIX)  # a replay, not a fresh mock turn
    [it] = [e.intent for e in evs if e.type == "scene.intent"]
    assert it.kind == "development.play" and it.plan is not None
    assert it.plan.world == "elmina" and it.brief_text == BRIEF
