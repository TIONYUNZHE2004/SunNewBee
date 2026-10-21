"""Scope-B policy is tested independently of the legacy all-features tests."""

import pytest
from fastmcp import Client
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as A
from townshiplens_agent import mcp_server
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import outside_note, run_turn
from townshiplens_agent.scope import ACCESS_FLOOD_TOOLS, is_greeting, outside_scope
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.template import greeting_answer, scope_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"

REMOVED_QUESTIONS = [
    ("Where can I recycle batteries near the mall?", "outside what I can check"),
    ("Boleh kitar semula bateri di mall?", "di luar"),
    ("商场哪里可以回收电池？", "超出"),
    ("What if we build a ramp at the steps?", "outside what I can check"),
    ("Bagaimana jika kita bina tanjakan?", "di luar"),
    ("如果建造坡道，会有多少路线改善？", "超出"),
    ("Which facts should staff verify first?", "outside what I can check"),
    ("Fakta mana perlu disahkan dahulu?", "di luar"),
    ("工作人员应该先核实哪些信息？", "超出"),
    ("At which river level does the route break?", "outside what I can check"),
    ("Pada paras sungai berapakah laluan terputus?", "di luar"),
    ("哪个水位让路线中断？", "超出"),
    (
        "Show what happens to residents stage by stage as the river rises.",
        "outside what I can check",
    ),
    ("Apa yang berlaku kepada penduduk pada setiap paras sungai?", "di luar"),
    ("每个水位下居民会怎样？", "超出"),
    ("Which changes would help wheelchair users most?", "outside what I can check"),
    ("Perubahan terbaik untuk membantu kerusi roda?", "di luar"),
    ("哪些改造帮助最多居民？", "超出"),
    ("Show the Elmina Day rehearsal.", "outside what I can check"),
    ("Simulasi hari biasa penduduk.", "di luar"),
    ("模拟居民的一天。", "超出"),
    ("Give me a nasi lemak recipe.", "outside what I can check"),
    ("What if the council closes the footbridge?", "outside what I can check"),
    ("Pada paras sungai berapa laluan ke mall terputus?", "di luar"),
]


@pytest.fixture
def ctx():
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))


@pytest.mark.parametrize("question,phrase", REMOVED_QUESTIONS)
async def test_removed_features_refuse_before_model_cache_and_tools(
    ctx, monkeypatch, question, phrase
):
    def forbidden(*args, **kwargs):
        raise AssertionError("scope refusal must not call model or demo cache")

    monkeypatch.setattr(A, "model_for", forbidden)
    monkeypatch.setattr("townshiplens_agent.run.demo.load", forbidden)
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(message=question),
            AgentSettings(llm_provider="mock", assistant_scope="access_flood", demo_mode=True),
            record=rec,
            memory=SessionMemory(),
        )
    ]
    assert [e.type for e in evs] == ["text.delta", "done"]
    assert phrase in evs[0].delta
    assert evs[-1].answer_status == "cannot_answer"
    assert rec.tool_calls == [] and ctx.vrs.list(status="all") == []
    assert validate_answer(scope_answer(question), TurnRecord()) == []


# T-013 (scope B+): a route or place question is never refused for its wording, and a question
# with no access keyword is no longer refused before the model.
ALLOWED = [
    "Can I push a stroller from Car Park B to the playground?",
    "Which places are affected if the river rises 3 m?",
    "What if the river rises 3 m: where can I evacuate?",
    "Adakah laluan ke tandas ditutup?",
    "我推婴儿车去公园，有什么未核实的入口信息？",
    "Di mana pusat pemindahan terdekat?",
    "B停车场的通道有扶手吗？",
    # the phrasings T-013 reported as refused
    "I am in Surau Al Mahdi, how can I go to Surau At Taqwa",
    "Can my grandmother get to the clinic?",
    "Saya di Surau Al Mahdi, macam mana nak pergi Surau At Taqwa?",
    "怎么去",
    "我在Surau Al Mahdi，怎么去Surau At Taqwa？",
    # narrowed removed phrases: real access / evacuation questions
    "How do I get to the town hall?",
    "What happens to residents near the park if the river rises 2 m?",
    "随着河水上涨，居民应该去哪里疏散？",
    "What if the path is closed, how do I get to the mall?",
    "Bagaimana jika jalan ditutup, macam mana nak ke mall?",
    "如果路封闭了，怎么去商场？",
    "At what river level is the playground flooded?",
    # new route / place phrasings (EN / BM / 中文)
    "Is Surau At Taqwa far from Surau Al Mahdi?",
    "My mum uses a walker. Getting from the mall to the surau, any stairs?",
    "Where is Anadia Clinic?",
    "Anything to sit on near the lake?",
    "Nak ke Anadia Clinic dari Car Park B, ikut mana?",
    "Klinik paling dekat dengan mall di mana?",
    "Boleh bawa nenek ke surau naik kerusi roda?",
    "从停车场到诊所要走多久？",
    "附近有没有诊所？",
    "Anadia Clinic在哪里？",
    "Tell me about Surau At Taqwa.",
    "Hi, how do I get to the playground?",
]


@pytest.mark.parametrize("question", ALLOWED)
def test_access_and_place_questions_are_never_refused_for_wording(question):
    assert not outside_scope(question)
    assert not is_greeting(question)


GREETINGS = [
    ("Hi", "Hello!"),
    ("hello!", "Hello!"),
    ("Hey there", "Hello!"),
    ("Good morning", "Hello!"),
    ("Thanks!", "You're welcome!"),
    ("Hai", "Hai!"),
    ("Selamat pagi", "Hai!"),
    ("Terima kasih", "Sama-sama!"),
    ("你好", "你好！"),
    ("谢谢！", "不客气！"),
]


@pytest.mark.parametrize("question,head", GREETINGS)
async def test_greeting_gets_a_hello_not_a_refusal(ctx, monkeypatch, question, head):
    def forbidden(*args, **kwargs):
        raise AssertionError("a greeting must not call the model or the demo cache")

    monkeypatch.setattr(A, "model_for", forbidden)
    monkeypatch.setattr("townshiplens_agent.run.demo.load", forbidden)
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(message=question),
            AgentSettings(llm_provider="mock", assistant_scope="access_flood", demo_mode=True),
            record=rec,
            memory=SessionMemory(),
        )
    ]
    assert [e.type for e in evs] == ["text.delta", "done"]
    assert evs[0].delta.startswith(head)
    assert "outside" not in evs[0].delta and "di luar" not in evs[0].delta
    assert rec.tool_calls == [] and ctx.vrs.list(status="all") == []
    assert validate_answer(greeting_answer(question), TurnRecord()) == []


SURAU_A, SURAU_B = "osm-way-910405528", "osm-way-910378231"  # Surau Al Mahdi, Surau At Taqwa


def _route_model(from_id: str, to_id: str, profile: str):
    """A model that plans one route and answers with the route's own evidence and warnings."""

    def model(messages, info):
        rets = [
            p
            for m in messages
            for p in getattr(m, "parts", [])
            if getattr(p, "part_kind", "") == "tool-return"
        ]
        if not rets:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "plan_route", {"from_id": from_id, "to_id": to_id, "profile": profile}
                    )
                ]
            )
        data = rets[-1].content
        r = data["data"]["routes"][0]
        caveats = [w for w in data.get("warnings", []) if "entrance is not mapped" in w]
        caveats += [r[k] for k in ("crossing_note", "road_note") if r.get(k)]
        if r.get("access_metres", {}).get("likely_ok", 0) or r.get("status") == "likely_ok":
            caveats.append("Likely OK sections are estimated from map data, not checked on site.")
        if r.get("demo_evidence"):
            caveats.append("Segment facts are demo values, not yet surveyed.")
        ans = {
            "answer_status": "answered",
            "summary": f"There is a mapped route, about {round(r['distance_m'])} m.",
            "claims": [
                {
                    "text": "Route",
                    "status": "unverified",
                    "evidence_ids": (r["evidence_ids"] or [e["id"] for e in data["evidence"]])[:3],
                }
            ],
            "route_id": r["id"],
            "caveats": caveats,
        }
        return ModelResponse(parts=[ToolCallPart("final_answer", ans)])

    return model


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "from_id,to_id,profile,outside",
    [(SURAU_A, SURAU_B, "default", True), ("park-b", "playground", "stroller", False)],
)
async def test_outside_deep_spot_caveat_only_outside(monkeypatch, from_id, to_id, profile, outside):
    ctx = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(":memory:"))
    monkeypatch.setattr(
        A, "model_for", lambda *a, **k: FunctionModel(_route_model(from_id, to_id, profile))
    )
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(
                message=f"From {ctx.world.places[from_id].name} to {ctx.world.places[to_id].name}",
                profile=profile,
            ),
            AgentSettings(_env_file=None, llm_provider="mock", assistant_scope="access_flood"),
            record=rec,
            memory=SessionMemory(),
        )
    ]
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert rec.validator_errors == []  # the model's own answer was shown, not the template
    assert ("Outside the detailed study area" in text) is outside
    assert ("OpenStreetMap only" in text) is outside


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "lang,phrase",
    [
        ("en", "OpenStreetMap only"),
        ("ms", "hanya daripada OpenStreetMap"),
        ("zh", "仅来自 OpenStreetMap"),
    ],
)
def test_outside_note_follows_answer_language(lang, phrase):
    ctx = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(":memory:"))
    res = tools.plan_route(ctx, SURAU_A, SURAU_B, "default", file_vrs=False)
    r = res.data["routes"][0]
    rec = TurnRecord(routes={r["id"]: r})
    ans = FinalAnswer(answer_status="answered", summary="x", route_id=r["id"])
    assert phrase in outside_note(ans, rec, ctx.world, lang)
    # a place cited without a route counts too
    rec = TurnRecord(evidence={e.id: e for e in res.evidence})
    eid = next(e.id for e in res.evidence if e.element_id == SURAU_B)
    cited = FinalAnswer(
        answer_status="answered",
        summary="x",
        claims=[{"text": "Surau", "status": "unverified", "evidence_ids": [eid]}],
    )
    assert phrase in outside_note(cited, rec, ctx.world, lang)


def test_outside_note_absent_on_tiny_fixture_and_without_facts(ctx):
    ans = FinalAnswer(answer_status="cannot_answer", summary="x")
    assert outside_note(ans, TurnRecord(), ctx.world) is None


@pytest.mark.parametrize("scope", ["access_flood", "all"])
async def test_model_registration_uses_scope_allowlist(ctx, scope):
    seen = []

    def model(messages, info):
        seen.extend(t.name for t in info.function_tools)
        return ModelResponse(
            parts=[ToolCallPart("final_answer", scope_answer("hello").model_dump())]
        )

    await A.build_agent(FunctionModel(model), assistant_scope=scope).run(
        "hello", deps=A.Deps(ctx, TurnRecord(), ChatRequest(message="hello"))
    )
    every = set(tools.TOOLS)
    assert set(seen) == (ACCESS_FLOOD_TOOLS if scope == "access_flood" else every)


async def test_mcp_uses_the_same_scope_with_existing_write_opt_in(monkeypatch):
    monkeypatch.setenv("ASSISTANT_SCOPE", "access_flood")
    monkeypatch.delenv("MCP_ALLOW_VR", raising=False)
    async with Client(mcp_server.build_server()) as client:
        assert {t.name for t in await client.list_tools()} == ACCESS_FLOOD_TOOLS - {
            "create_verification_request"
        }
    monkeypatch.setenv("MCP_ALLOW_VR", "true")
    async with Client(mcp_server.build_server()) as client:
        assert {t.name for t in await client.list_tools()} == ACCESS_FLOOD_TOOLS


def test_scope_defaults_and_invalid_values(monkeypatch):
    monkeypatch.delenv("ASSISTANT_SCOPE", raising=False)
    assert AgentSettings(_env_file=None).assistant_scope == "access_flood"
    monkeypatch.setenv("ASSISTANT_SCOPE", "all")
    assert AgentSettings(_env_file=None).assistant_scope == "all"
    with pytest.raises(ValueError):
        AgentSettings(_env_file=None, assistant_scope="arbitrary")


async def test_in_scope_mock_still_executes_real_tools(ctx):
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(
                message="Can I push a stroller from Car Park B to the playground?",
                profile="stroller",
            ),
            AgentSettings(llm_provider="mock", assistant_scope="access_flood"),
        )
    ]
    assert any(e.type == "tool.call" and e.name == "plan_route" for e in evs)
    assert evs[-1].model == "mock-scripted"


# T-023: the management panel gets every tool and no topic refusal, whatever ASSISTANT_SCOPE is;
# the resident panel keeps scope B+.
STAFF = AgentSettings(
    _env_file=None, llm_provider="mock", assistant_scope="access_flood", turn_timeout_s=600
)


def test_chat_request_panel_defaults_to_resident():
    assert ChatRequest(message="hi").panel == "resident"
    assert ChatRequest(message="hi", panel="management").panel == "management"
    with pytest.raises(ValueError):
        ChatRequest(message="hi", panel="admin")


async def test_management_panel_registers_every_tool(ctx):
    seen = []

    def model(messages, info):
        seen.extend(t.name for t in info.function_tools)
        assert "panel=management" in info.instructions and "PANEL: management" in info.instructions
        return ModelResponse(
            parts=[ToolCallPart("final_answer", scope_answer("hello").model_dump())]
        )

    req = ChatRequest(message="hello", panel="management")
    await A.build_agent(
        FunctionModel(model), assistant_scope="access_flood", panel="management"
    ).run("hello", deps=A.Deps(ctx, TurnRecord(), req))
    assert set(seen) == set(tools.TOOLS)


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "question, tool",
    [
        ("What happens to residents as the river rises?", "rising_river_rollout"),
        ("Which facts should staff verify first?", "plan_verifications"),
        ("What if we build a ramp at the steps?", "simulate_what_if"),
    ],
)
async def test_management_questions_answer_with_tool_evidence(question, tool, tmp_path):
    world = load_world(SEED)
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=question, panel="management")
    evs = [e async for e in run_turn(ctx, req, STAFF, record=rec, memory=SessionMemory())]
    assert tool in rec.tool_calls
    assert evs[-1].answer_status in ("answered", "partial")
    assert evs[-1].model == "mock-scripted"  # the mock's answer passed the validator
    assert [e for e in evs if e.type == "citation"]
    # the resident panel keeps today's behaviour: no rollout, plan or what-if
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx, ChatRequest(message=question), STAFF, record=rec, memory=SessionMemory()
        )
    ]
    assert tool not in rec.tool_calls and evs[-1].answer_status == "cannot_answer"


@pytest.mark.parametrize(
    "question, head", [("hello", "Hello!"), ("terima kasih", "Sama-sama!"), ("你好", "你好！")]
)
async def test_management_greeting_says_what_staff_can_ask(ctx, monkeypatch, question, head):
    monkeypatch.setattr(A, "model_for", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    req = ChatRequest(message=question, panel="management")
    evs = [e async for e in run_turn(ctx, req, STAFF, memory=SessionMemory())]
    text = evs[0].delta
    assert text.startswith(head) and "Elmina" in text
    assert "outside" not in text and "Where would you like to go" not in text
    assert validate_answer(greeting_answer(question, "management"), TurnRecord()) == []


async def test_management_question_no_tool_answers_says_so_without_a_ticket(ctx):
    req = ChatRequest(message="What is the weather tomorrow?", panel="management")
    evs = [e async for e in run_turn(ctx, req, STAFF, memory=SessionMemory())]
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "I can't answer that from our data." in text
    assert evs[-1].answer_status == "cannot_answer" and ctx.vrs.list(status="all") == []


def test_validator_rejects_a_topic_refusal_on_the_management_panel():
    refusal = scope_answer("Which facts should staff verify first?")
    staff = TurnRecord()
    staff.panel = "management"
    assert validate_answer(refusal, staff)
    assert validate_answer(refusal, TurnRecord()) == []  # the resident panel may refuse
