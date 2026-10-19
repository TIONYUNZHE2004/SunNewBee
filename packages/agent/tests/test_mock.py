"""Self-contained: runs the mock through a throwaway Agent with stub tools (no spatial package)."""

import pytest
from pydantic_ai import Agent
from pydantic_ai.output import ToolOutput
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.mock import mock_model

PLACES = {
    "car park b": {"id": "carpark-b", "name": "Car Park B"},
    "playground": {"id": "park-b", "name": "Playground"},
}


def _agent(calls: list[str], plan_evidence: list[dict] | None = None) -> Agent:
    agent = Agent(mock_model(), output_type=ToolOutput(FinalAnswer, name="final_answer"))

    @agent.tool_plain
    def find_place(query: str) -> dict:
        calls.append("find_place")
        p = PLACES.get(query)
        return {
            "ok": True,
            "data": [p] if p else [],
            "evidence": [{"id": f"ev-place-{p['id']}"}] if p else [],
            "warnings": [],
        }

    @agent.tool_plain
    def plan_route(
        from_id: str, to_id: str, profile: str = "default", scenario_id: str | None = None
    ) -> dict:
        calls.append("plan_route")
        route = {
            "id": "rt-1",
            "distance_m": 120,
            "status": "partly_unverified",
            "unknowns": [
                {
                    "attribute": "step_count",
                    "element_id": "seg-bc",
                    "element_label": "Lakeside Walk",
                }
            ],
        }
        return {
            "ok": True,
            "data": {"status": "partly_unverified", "routes": [route]},
            "evidence": plan_evidence or [{"id": "ev-seg-ab.step_count"}],
            "warnings": [],
        }

    return agent


def test_mock_access_hero_script():
    calls: list[str] = []
    res = _agent(calls).run_sync(
        "Can I get from Car Park B to the playground with a stroller, no stairs?"
    )
    assert calls == ["find_place", "find_place", "plan_route"]
    ans = res.output
    assert ans.answer_status == "partial" and ans.route_id == "rt-1"
    assert ans.claims[0].evidence_ids == [
        "ev-place-carpark-b",
        "ev-place-park-b",
        "ev-seg-ab.step_count",
    ]
    assert ans.caveats[0] == "Not checked yet: Steps on Lakeside Walk"
    assert not any("seg-" in c or "_" in c for c in ans.caveats)
    assert ans.scene_intents[0].kind == "route.highlight"


def test_mock_unknown_place_cannot_answer():
    calls: list[str] = []
    agent = _agent(calls)

    @agent.tool_plain
    def create_verification_request(
        target_id: str, attribute: str, reason: str, question_summary: str
    ) -> dict:
        calls.append("create_verification_request")
        assert reason == "missing_place"
        return {"ok": True, "data": {}, "evidence": [], "warnings": []}

    res = agent.run_sync("take me to the moon")
    assert calls == ["find_place", "create_verification_request"]
    assert res.output.answer_status == "cannot_answer"


FAIL = {"ok": False, "data": None, "evidence": [], "warnings": ["x"]}


def _failing_agent() -> Agent:
    agent = Agent(mock_model(), output_type=ToolOutput(FinalAnswer, name="final_answer"))
    for name in [
        "find_place",
        "plan_route",
        "list_flood_scenarios",
        "affected_places",
        "list_evacuation_centres",
        "create_verification_request",
    ]:

        def make(n):
            def f(**kw) -> dict:
                return FAIL

            f.__name__ = n
            return f

        agent.tool_plain(make(name))
    return agent


@pytest.mark.parametrize(
    "q",
    [
        "Can I get from Car Park B to the playground with a stroller?",
        "If the river rises 3 m, which places are cut off?",
        "The river rises, where can I go?",
        "take me to the moon",
    ],
)
def test_mock_survives_failed_tools(q):
    res = _failing_agent().run_sync(q)
    assert res.output.answer_status == "cannot_answer"


def test_mock_malformed_ok_payload_raises_not_swallowed():
    agent = Agent(mock_model(), output_type=ToolOutput(FinalAnswer, name="final_answer"))

    @agent.tool_plain
    def list_flood_scenarios() -> dict:
        return {"ok": True, "data": [], "evidence": [{"id": "ev-scn-1"}], "warnings": []}

    @agent.tool_plain
    def affected_places(**kw) -> dict:
        return {"ok": True, "data": {"likely": 5, "possible": []}, "evidence": [], "warnings": []}

    with pytest.raises(TypeError):
        agent.run_sync("If the river rises 3 m, which places are cut off?")


@pytest.mark.parametrize(
    "q,dest",
    [
        ("Can I push a stroller from Car Park B to the kiosk without stairs?", "kiosk"),
        ("Stroller from Car Park B to the toilet, no stairs?", "toilet"),
        ("Can I push a stroller from Car Park B to the playground?", "playground"),
        ("Can I push a stroller from Car Park B without stairs?", None),
    ],
)
def test_mock_access_destination_from_prompt(q, dest):
    queries: list[str] = []
    agent = Agent(mock_model(), output_type=ToolOutput(FinalAnswer, name="final_answer"))

    @agent.tool_plain
    def find_place(query: str) -> dict:
        queries.append(query)
        return {"ok": True, "data": [], "evidence": [], "warnings": []}

    res = agent.run_sync(q)
    assert queries == (["car park b", dest] if dest else [])
    assert res.output.answer_status == "cannot_answer"


def test_mock_adds_placeholder_caveat():
    ev = [{"id": "ev-seg-ab.step_count", "source_type": "team_survey_placeholder"}]
    res = _agent([], plan_evidence=ev).run_sync(
        "Can I get from Car Park B to the playground with a stroller?"
    )
    assert any("demo values, not yet surveyed" in c for c in res.output.caveats)


def test_mock_weak_place_match_files_no_missing_place_vr(monkeypatch):
    """Review #3 minor 5: a weak fuzzy match may be a real place: no VR."""
    q = "How deep is the water at the urban park at +3 m?"
    monkeypatch.setitem(PLACES, q.lower()[:80], {"id": "p1", "name": "Elmina Park", "score": 0.1})
    calls: list[str] = []
    agent = _agent(calls)

    res = agent.run_sync(q)
    assert "create_verification_request" not in calls
    assert res.output.answer_status == "cannot_answer"
    assert "don't have that place" not in res.output.summary
