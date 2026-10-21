import json
from pathlib import Path

from townshiplens_spatial.devsim_models import DevelopmentPlan

WEB = Path(__file__).resolve().parents[3] / "apps/web/src/features/devsim/fixtures"


def test_elmina_fixture_validates():
    plan = DevelopmentPlan.model_validate_json((WEB / "plan.elmina.json").read_text("utf-8"))
    assert plan.provisional is False
    assert plan.world == "elmina"
    assert plan.total_s == 45
    assert [a.name for a in plan.acts] == ["Brief", "Construction", "Handover", "Daily Life"]
    assert [b.n for b in plan.bubbles] == list(range(1, 8))
    assert plan.facts.detour is not None and plan.facts.detour.detour_side_switch
    assert {b.who for b in plan.bubbles} <= {c.id for c in plan.cast}


def test_provisional_fixture_is_the_legacy_66s_web_fixture():
    """Ruling (C7): `plan.provisional.json` is the prototype-derived 66 s fixture the old web
    overlay's unit tests still use; it predates the 45 s contract and is not a DevelopmentPlan
    any more. The fe lane (C11) replaces it when it rewires the overlay."""
    raw = json.loads((WEB / "plan.provisional.json").read_text("utf-8"))
    assert raw["provisional"] is True and raw["total_s"] == 66
