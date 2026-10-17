"""What the model is sent for list_evacuation_centres: smaller, with nothing it needs removed."""

import asyncio
import json

import pytest
from tests_support import TINY
from townshiplens_agent import agent as agent_mod
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

ROWS = [
    {
        "centre": {
            "id": f"evc-{i}",
            "place_id": f"p-{i}",
            "name": f"Hall {i}",
            "coord": [101.5, 3.18],
            "node_id": "n-1_2",
            "source": "osm_candidate",
            "capacity": None,
        },
        "reachable": i == 0,
        "route_status": "confirmed" if i == 0 else "no_data",
        "route_id": None,
        "disclaimer": "Indicative scenario, not a forecast.",
    }
    for i in range(3)
]


def test_one_shared_disclaimer_and_no_map_positions():
    rows, shared = agent_mod._compact_centres(json.loads(json.dumps(ROWS)))
    assert shared == "Indicative scenario, not a forecast."
    for r in rows:
        assert "disclaimer" not in r and "route_id" not in r
        assert "coord" not in r["centre"] and "node_id" not in r["centre"]
        assert "capacity" not in r["centre"]
        assert {"id", "place_id", "name", "source"} <= set(r["centre"])
        assert "reachable" in r and "route_status" in r
    assert rows[1]["reachable"] is False  # a False value is kept, only None is dropped


def test_different_disclaimers_stay_on_their_rows():
    data = json.loads(json.dumps(ROWS))
    data[1]["disclaimer"] = "Other."
    rows, shared = agent_mod._compact_centres(data)
    assert shared is None and all("disclaimer" in r for r in rows)


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


def test_the_turn_record_keeps_the_full_rows(ctx):
    rec = TurnRecord()
    deps = agent_mod.Deps(ctx=ctx, rec=rec, request=ChatRequest(message="x", profile="wheelchair"))
    sent = asyncio.run(
        agent_mod.call_tool(deps, "list_evacuation_centres", scenario_id="stage_p3m")
    )
    assert sent["ok"] and sent["data"]
    assert "disclaimer" in sent  # hoisted once
    assert all("coord" not in r["centre"] for r in sent["data"])
    # every evidence id the model may cite is still recorded for the validator
    assert {e["id"] for e in sent["evidence"]} <= set(rec.evidence)
