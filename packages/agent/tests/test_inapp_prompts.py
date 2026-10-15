"""Every in-app prompt on the Elmina seed gets a real mock answer that passes the validator.

Keeps keyless demos and DEMO_MODE replays from showing "I don't know" for the app's own chips.
"""

import re

import pytest
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
SUGGESTIONS_TS = ROOT / "apps/web/src/features/chat/suggestions.ts"
pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
MOCK = AgentSettings(_env_file=None, llm_provider="mock")

# (message, profile, scenario_id). Copied from apps/web/src/features/chat/suggestions.ts
# (SUGGESTIONS and WHERE_CAN_I_GO); test_prompts_match_suggestions_ts catches drift.
ACCESS = [
    ("Can I get to the lakeside mall with a stroller?", "stroller", None),
    ("Can I get to the lakeside mall in a wheelchair?", "wheelchair", None),
    (
        "Can I get to the lakeside mall if I am an older adult who needs to rest?",
        "older_adult_rest",
        None,
    ),
    ("Is the walk from the urban park to the lakeside mall easy?", "default", None),
]
FLOOD = [
    ("Where is the nearest evacuation centre if the water rises 3 m?", "default", "stage_p3m"),
    ("Where is the nearest evacuation centre if the water rises 3 m?", "wheelchair", "stage_p3m"),
    (
        "Which routes to the lakeside mall are cut off if the water rises 3 m?",
        "default",
        "stage_p3m",
    ),
    ("Where is the nearest evacuation centre if the water rises 1 m?", "default", "stage_p1m"),
]
WASTE = [("Where can I drop off recycling nearby?", "default", None)]
WHERE = [
    ("Where can I go?", "default", "stage_p3m"),
    ("Where can I go?", "wheelchair", "stage_p3m"),
]
ALL = ACCESS + FLOOD + WASTE + WHERE


@pytest.fixture(scope="module")
def world():
    return load_world(SEED)


async def _turn(world, tmp_path, msg, profile, scenario):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    req = ChatRequest(message=msg, profile=profile, scenario_id=scenario)
    return [e async for e in run_turn(ctx, req, MOCK)]


def _text(evs) -> str:
    return "".join(e.delta for e in evs if e.type == "text.delta")


def _routes(evs):
    return [e for e in evs if e.type == "tool.result" and e.name == "plan_route"]


@pytest.mark.parametrize("msg,profile,scenario", ALL)
async def test_inapp_prompt_is_answered_by_the_mock(world, tmp_path, msg, profile, scenario):
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    done = evs[-1]
    assert done.type == "done"
    assert done.model == "mock-scripted", "validator rejected the mock answer (template used)"
    assert done.answer_status != "cannot_answer", _text(evs)
    assert not [e for e in evs if e.type == "error"]
    assert any(e.type == "citation" for e in evs)
    text = _text(evs)
    low = text.lower()
    words = re.findall(r"[a-z]+", low)
    assert "safe" not in words
    assert not re.search(r"(?<!un)verified", low), "no verified wording on demo data"
    assert not re.search(r"\d+(?:\.\d+)?\s*(?:cm|centimet|metres? deep|m deep)", low)
    assert not re.search(r"\b(?:depth|deep)\b", low)
    if scenario:
        assert "indicative" in low and "not a forecast" in low
        n = scenario.removeprefix("stage_p").removesuffix("m")
        if "cut off" in msg or "evacuation" in msg or msg == "Where can I go?":
            assert f"River +{n} m" in text
        assert any(
            e.type == "scene.intent"
            and e.intent.kind == "flood.set_level"
            and e.intent.scenario_id == scenario
            for e in evs
        )
    # a planned route is always named with its status
    if any(e.type == "tool.result" and e.name == "plan_route" for e in evs):
        assert re.search(
            r"Route status: (confirmed|partly unverified|blocked|no mapped connection)|route "
            r"(confirmed|partly unverified)|No mapped connection|nearest reachable centre",
            text,
        ), text
    assert not re.search(r"\bseg-|\bosm-way|[a-z]+_[a-z]+", text), text  # no ids or raw keys
    if any(e.type == "citation" and e.source_type == "team_survey_placeholder" for e in evs):
        assert "demo values, not yet surveyed" in low


async def test_no_data_route_says_data_gap_not_unverified(world, tmp_path):
    msg, profile, scenario = ACCESS[3]
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    text = _text(evs)
    assert (
        "No mapped connection between Elmina Urban Park and Elmina Lakeside Mall (data gap)" in text
    )
    assert "unverified" not in text.lower() and "blocked" not in text.lower()
    assert evs[-1].answer_status == "partial"


async def test_wheelchair_where_can_i_go_is_short(world, tmp_path):
    evs = await _turn(world, tmp_path, "Where can I go?", "wheelchair", "stage_p3m")
    text = _text(evs)
    assert len(text.encode()) < 2048, len(text)
    assert "staff have been asked" not in text
    assert text.count("Not checked yet") <= 5
    m = re.search(r"and (\d+) more unchecked items", text)
    assert m, text
    # Named lines + "and N more" count items, and the filed count is exact.
    unc = next(e for e in evs if e.type == "uncertainty")
    items = {(i["element_id"], i["attribute"]) for i in unc.items if i["attribute"] != "flood"}
    assert int(m.group(1)) == len(unc.items) - 5
    vrs = {(e.element_id, e.attribute) for e in evs if e.type == "verification.requested"}
    k = len(vrs & items)
    asked = re.search(r"Asked the township team to check (\d+) of the (\d+) unchecked items", text)
    if k and k < len(items):
        assert asked and (int(asked.group(1)), int(asked.group(2))) == (k, len(items)), text
    elif not k:
        assert "Asked the township team" not in text


@pytest.mark.parametrize("level,sid", [("1 m", "stage_p1m"), ("3 m", "stage_p3m")])
async def test_asked_river_level_selects_that_scenario(world, tmp_path, level, sid):
    msg = f"Where is the nearest evacuation centre if the water rises {level}?"
    evs = await _turn(world, tmp_path, msg, "default", None)
    calls = [e.args for e in evs if e.type == "tool.call" and e.name == "list_evacuation_centres"]
    assert calls and calls[0]["scenario_id"] == sid
    assert f"River +{level}" in _text(evs)


@pytest.mark.parametrize("level", ["10 m", "3.5 m", "0 m", "6 m"])
async def test_unsupported_river_level_abstains(world, tmp_path, level):
    msg = f"Where is the nearest evacuation centre if the water rises {level}?"
    evs = await _turn(world, tmp_path, msg, "default", None)
    assert evs[-1].answer_status == "cannot_answer"
    assert "Scenarios exist for river levels +1 m to +5 m only." in _text(evs)
    assert not [e for e in evs if e.type == "tool.call" and e.name == "plan_route"]


async def test_older_adult_chip_uses_that_profile(world, tmp_path):
    msg, profile, scenario = ACCESS[2]
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    plans = [e.args for e in evs if e.type == "tool.call" and e.name == "plan_route"]
    assert plans and plans[0]["profile"] == "older_adult_rest"


async def test_older_adult_answer_reports_the_rest_gap(world, tmp_path):
    msg, profile, scenario = ACCESS[2]
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    assert "longest stretch without one" in _text(evs)


async def test_urban_park_to_mall_routes_between_both(world, tmp_path):
    msg, profile, scenario = ACCESS[3]
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    finds = [e.args["query"] for e in evs if e.type == "tool.call" and e.name == "find_place"]
    assert finds == ["urban park", "lakeside mall"]


@pytest.mark.parametrize("profile", ["default", "wheelchair"])
async def test_where_can_i_go_names_the_demo_start(world, tmp_path, profile):
    evs = await _turn(world, tmp_path, "Where can I go?", profile, "stage_p3m")
    assert "from Elmina Lakeside Mall (demo start point)" in _text(evs)
    finds = [e.args["query"] for e in evs if e.type == "tool.call" and e.name == "find_place"]
    assert finds == ["lakeside mall"]


async def test_where_can_i_go_without_scenario_asks_for_a_river_level(world, tmp_path):
    evs = await _turn(world, tmp_path, "Where can I go?", "default", None)
    assert evs[-1].answer_status == "cannot_answer"
    assert "river level" in _text(evs)


def _parse_suggestions(src: str) -> list[tuple[str, str, str | None]]:
    """(lens, text, profile) for every live chip, plus WHERE_CAN_I_GO under "scenario-bar"."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))
    block = re.search(r"SUGGESTIONS[^=]*=\s*\{(.*?)\n\};", src, re.S).group(1)
    heads = list(re.finditer(r"^  (\w+):\s*\[", block, re.M))
    out = []
    for i, h in enumerate(heads):
        body = block[h.end() : heads[i + 1].start() if i + 1 < len(heads) else len(block)]
        for item in re.findall(r"\{(.*?)\}", body, re.S):
            t = re.search(r'text:\s*"([^"]+)"', item)
            pr = re.search(r'profile:\s*"([^"]+)"', item)
            out.append((h.group(1), t.group(1), pr.group(1) if pr else None))
    out.append(("scenario-bar", re.search(r'WHERE_CAN_I_GO\s*=\s*"([^"]+)"', src).group(1), None))
    return out


def test_prompts_match_suggestions_ts():
    parsed = _parse_suggestions(SUGGESTIONS_TS.read_text(encoding="utf-8"))
    assert len(parsed) == len(set(parsed)), f"duplicate chips: {parsed}"
    mine = {("access", m, pr) for m, pr, _ in ACCESS}
    mine |= {("flood", m, None) for m in dict.fromkeys(m for m, _, _ in FLOOD)}
    mine |= {("waste", m, None) for m, _, _ in WASTE}
    mine |= {("scenario-bar", m, None) for m, _, _ in WHERE}
    assert mine == set(parsed)


PLACE_Q = [
    ("Tell me about Elmina Lakeside Mall", "Elmina Lakeside Mall"),
    ("What is at Elmina Urban Park", "Elmina Urban Park"),
    ("Tell me about the lakeside mall", "Elmina Lakeside Mall"),
]


@pytest.mark.parametrize("msg,name", PLACE_Q)
async def test_place_info_question_summarises_the_place_and_files_nothing(
    world, tmp_path, msg, name
):
    evs = await _turn(world, tmp_path, msg, "default", None)
    text = _text(evs)
    done = evs[-1]
    assert done.model == "mock-scripted", "validator rejected the mock answer"
    calls = [e.name for e in evs if e.type == "tool.call"]
    assert "get_place_details" in calls and "create_verification_request" not in calls
    assert not [e for e in evs if e.type == "verification.requested"]
    assert name in text
    assert "don't have that place" not in text and "asked the team" not in text.lower()
    assert done.answer_status in ("answered", "partial")
    assert any(e.type == "citation" for e in evs)
    assert not re.search(r"\bseg-|[a-z]+_[a-z]+", text), text


async def test_place_found_but_unanswerable_does_not_claim_a_request(world, tmp_path):
    evs = await _turn(world, tmp_path, "Is the lakeside mall open now?", "default", None)
    text = _text(evs)
    assert evs[-1].answer_status == "cannot_answer"
    assert "can't answer that from the township model yet" in text
    assert "asked" not in text.lower() and "don't have that place" not in text
    assert not [e for e in evs if e.type == "verification.requested"]


async def test_unknown_place_still_files_a_missing_place_request(world, tmp_path):
    evs = await _turn(world, tmp_path, "Tell me about Zzyzx Qwerty Xylophone", "default", None)
    assert evs[-1].answer_status == "cannot_answer"
    assert [e for e in evs if e.type == "verification.requested"]
