"""Every Elmina demo-cache entry is what the current mock would say today (final-review-2 Minor 5).

A stale entry keeps showing old wording in DEMO_MODE. When this fails, re-record with
`LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<question>" --profile <p>`.
"""

import json

import pytest
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
DEMO = ROOT / "data/demo"
MOCK = AgentSettings(_env_file=None, llm_provider="mock", assistant_scope="all")
# Differ between runs by design: replay mints ids and the VR store decides created/demand.
IGNORED = {"message_id", "request_id", "created", "demand"}
pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")


def _entries():
    out = []
    for path in sorted(DEMO.glob("*.jsonl")):
        rows = [
            json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()
        ]
        if rows[0]["meta"].get("world") == "elmina":
            out.append(pytest.param(path.name, rows, id=path.stem))
    return out


def _norm(row: dict) -> dict:
    out = {k: v for k, v in row.items() if k not in IGNORED}
    if isinstance(out.get("intent"), dict):  # an optional intent field added later is null
        out["intent"] = {k: v for k, v in out["intent"].items() if v is not None}
    return out


def test_there_are_elmina_entries():
    assert len(_entries()) >= 12


@pytest.fixture(scope="module")
def world():
    return load_world(SEED)


@pytest.mark.parametrize("name,rows", _entries())
async def test_cache_entry_matches_the_current_mock(world, tmp_path, name, rows):
    meta = rows[0]["meta"]
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    req = ChatRequest(
        message=meta["message"], profile=meta["profile"], scenario_id=meta.get("scenario_id")
    )
    fresh = [e.model_dump(mode="json") async for e in run_turn(ctx, req, MOCK)]
    assert [_norm(r) for r in rows[1:]] == [_norm(r) for r in fresh], (
        f"{name} is stale: re-record it with the mock"
    )


@pytest.fixture(autouse=True)
def _legacy_scope(monkeypatch):
    # Retain legacy recorded flows and synthetic pipeline prompts explicitly.
    monkeypatch.setenv("ASSISTANT_SCOPE", "all")
