# ruff: noqa: E501
"""T-021 review: a route with maneuvers is published from its checked fields, not model prose."""

import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from townshiplens_agent import agent as A
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
MAHDI, TAQWA = "osm-way-910405528", "osm-way-910378231"
pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")


def _model(summary: str, profile="default", scenario=None):
    """Plans Surau Al Mahdi -> Surau At Taqwa, then answers with `summary` and honest caveats."""

    def model(messages, info):
        rets = [
            p
            for m in messages
            for p in getattr(m, "parts", [])
            if getattr(p, "part_kind", "") == "tool-return"
        ]
        if not rets:
            args = {"from_id": MAHDI, "to_id": TAQWA, "profile": profile}
            if scenario:
                args["scenario_id"] = scenario
            return ModelResponse(parts=[ToolCallPart("plan_route", args)])
        data = rets[-1].content
        r = data["data"]["routes"][0]
        caveats = [w for w in data.get("warnings", [])]
        caveats += [r[k] for k in ("crossing_note", "road_note") if r.get(k)]
        caveats.append("Estimated from map data, not checked on site.")
        if any(e.get("source_type") == "team_survey_placeholder" for e in data["evidence"]):
            # the demo corridor (B5) runs along this route
            caveats.append("Some segment facts are demo values, not yet surveyed.")
        ev = (r.get("evidence_ids") or [e["id"] for e in data["evidence"]])[:3]
        ans = {
            "answer_status": "partial",
            "summary": summary,
            "claims": [{"text": "Route", "status": "unverified", "evidence_ids": ev}],
            "route_id": r["id"],
            "caveats": caveats,
            "scenario_id": scenario,
        }
        return ModelResponse(parts=[ToolCallPart("final_answer", ans)])

    return model


async def _text(monkeypatch, summary, question, **kw):
    ctx = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(":memory:"))
    monkeypatch.setattr(A, "model_for", lambda *a, **k: FunctionModel(_model(summary, **kw)))
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(message=question, profile=kw.get("profile", "default")),
            AgentSettings(_env_file=None, llm_provider="mock"),
            record=rec,
            memory=SessionMemory(),
        )
    ]
    return "".join(e.delta for e in evs if e.type == "text.delta"), rec, evs


Q = "I am in Surau Al Mahdi, how can I walk to Surau At Taqwa?"


@pytest.mark.parametrize(
    "bypass",
    [
        "Rotate clockwise onto Jalan Metafasa U16/3, about 364 m, estimated from map data.",
        "Follow Jalan Metafasa U16/3 in the opposite direction, about 364 m, estimated from map data.",
    ],
)
async def test_model_route_prose_is_never_published(monkeypatch, bypass):
    text, rec, _ = await _text(monkeypatch, bypass, Q)
    assert "clockwise" not in text and "opposite" not in text
    assert "Surau Al Mahdi to Surau At Taqwa: route likely OK (estimated" in text
    assert "1. Start" in text  # steps rendered from the maneuvers


async def test_every_route_warning_is_published(monkeypatch):
    text, rec, _ = await _text(monkeypatch, "Estimated from map data, 364 m.", Q)
    rid = next(iter(rec.routes))
    for w in rec.route_warnings[rid]:
        if w.startswith("Likely OK sections"):  # said by the estimate line
            assert "Estimated from map data" in text
        elif not w.startswith("Demo value"):  # said by the demo-values line
            assert w.rstrip(".")[:40] in text, w


async def test_canonical_answer_follows_the_answer_language(monkeypatch):
    bm = (
        "Laluan dari Surau Al Mahdi ke Surau At Taqwa kira-kira 364 m, anggaran daripada data peta."
    )
    text, _, _ = await _text(
        monkeypatch, bm, "Macam mana nak jalan kaki dari Surau Al Mahdi ke Surau At Taqwa?"
    )
    assert "Surau Al Mahdi ke Surau At Taqwa: laluan kemungkinan OK" in text
    assert "Status laluan:" in text
